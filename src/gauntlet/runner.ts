/**
 * Gauntlet runner — core orchestrator.
 *
 * Runs tiers sequentially, collects notes, tags checkpoints,
 * and presents approval gates between tiers for evolution.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type {
  GauntletRunOptions,
  GauntletTierResult,
  GauntletTier,
  EvolutionStepResult,
  EvolutionLogEntry,
  GauntletSummary,
  GauntletResult,
} from "./types.js";
import type { DeveloperProfile } from "../shared/types.js";
import { PIPELINE_PHASES } from "../shared/types.js";
import { loadGauntletDefinition } from "./tier-loader.js";
import { createTag, commitFiles, tagExists, deleteTag, getDiffStats, getCurrentCommit } from "./git-tagger.js";
import { collectNotes, generateTierReport } from "./note-collector.js";
import { generateRunId } from "./history.js";

const EVOLUTION_LOG_FILE = "evolution-log.yaml";

/**
 * Run a full gauntlet.
 *
 * Loads the definition, runs tiers sequentially, pauses for approval
 * between tiers, and produces a full result.
 */
export async function runGauntlet(options: GauntletRunOptions): Promise<GauntletResult> {
  const {
    definitionPath,
    workspaceDir,
    baseProfile,
    projectRoot,
    maxTier,
    startTier,
    approvalCallback,
    onProgress,
  } = options;

  const definition = loadGauntletDefinition(definitionPath);
  const startedAt = new Date().toISOString();
  const runId = generateRunId(definition.id, startedAt);
  const gitCommit = getCurrentCommit(projectRoot);

  // Filter tiers by range
  let tiers = definition.tiers;
  if (startTier) {
    tiers = tiers.filter((t) => t.level >= startTier);
  }
  if (maxTier) {
    tiers = tiers.filter((t) => t.level <= maxTier);
  }

  // Tag baseline (if not already tagged)
  const baselineTag = `gauntlet/${definition.id}-baseline`;
  if (!tagExists(baselineTag, projectRoot)) {
    createTag(baselineTag, projectRoot);
    onProgress?.("setup", `Tagged baseline: ${baselineTag}`);
  }

  const tierResults: GauntletTierResult[] = [];
  const evolutionSteps: EvolutionStepResult[] = [];

  for (const tier of tiers) {
    onProgress?.(tier.id, `Starting tier ${tier.level}: ${tier.label}`);

    // Run the tier
    const tierResult = await runTier(tier, baseProfile, workspaceDir, projectRoot, onProgress);
    tierResults.push(tierResult);

    onProgress?.(tier.id, `Tier ${tier.level} ${tierResult.success ? "passed" : "failed"} — reached ${tierResult.phaseReached}`);

    // Log errors so they're visible in console output
    for (const err of tierResult.errors) {
      onProgress?.(tier.id, `ERROR: ${err}`);
    }

    // Approval gate
    if (approvalCallback) {
      const report = generateTierReport(tierResult);
      const driftStats = tagExists(baselineTag, projectRoot)
        ? getDiffStats(baselineTag, "HEAD", projectRoot)
        : { filesChanged: 0, insertions: 0, deletions: 0 };

      const action = await approvalCallback(tierResult, report, driftStats);

      if (action === "approve") {
        onProgress?.(tier.id, "Evolution approved — applying changes");
        const evolutionResult = await runEvolutionStep(tierResult, projectRoot, definition.id);
        evolutionSteps.push(evolutionResult);
      } else if (action === "skip") {
        onProgress?.(tier.id, "Evolution skipped — continuing to next tier");
        evolutionSteps.push({
          tierId: tier.id,
          promptsChanged: [],
          heuristicsAdded: 0,
          archDecisionsAdded: 0,
          filesChanged: [],
          approved: false,
          skipped: true,
        });
      } else {
        // "stop"
        onProgress?.(tier.id, "Gauntlet stopped by user");
        break;
      }
    }
  }

  const completedAt = new Date().toISOString();

  const summary: GauntletSummary = {
    totalTiers: tierResults.length,
    passed: tierResults.filter((t) => t.success).length,
    failed: tierResults.filter((t) => !t.success).length,
    totalDurationMs: tierResults.reduce((sum, t) => sum + t.durationMs, 0),
    evolutionSteps: evolutionSteps.filter((e) => e.approved).length,
  };

  return {
    gauntletId: definition.id,
    runId,
    startedAt,
    completedAt,
    gitCommit,
    tiers: tierResults,
    evolutionSteps,
    summary,
  };
}

/**
 * Run a single tier.
 *
 * Creates an isolated project directory, merges profile overrides,
 * runs the pipeline, collects notes, and tags the result.
 */
export async function runTier(
  tier: GauntletTier,
  baseProfile: DeveloperProfile,
  workspaceDir: string,
  projectRoot: string,
  onProgress?: (tierId: string, message: string) => void,
): Promise<GauntletTierResult> {
  const startTime = Date.now();
  const tierProjectDir = path.join(workspaceDir, `gauntlet-${tier.id}`);
  const errors: string[] = [];

  // Clean and create isolated project directory.
  // A previous crashed run may have left stale files that conflict
  // with branch checkouts and scaffolding.
  if (fs.existsSync(tierProjectDir)) {
    fs.rmSync(tierProjectDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tierProjectDir, { recursive: true });

  // Merge profile with tier overrides
  const profile: DeveloperProfile = {
    ...baseProfile,
    ...tier.profileOverrides,
  };

  let phaseReached: GauntletTierResult["phaseReached"] = "IDLE";

  try {
    // Dynamically import to avoid circular deps and allow mocking
    const { PipelineOrchestrator } = await import("../pipeline/orchestrator.js");

    const orch = new PipelineOrchestrator(tierProjectDir, profile);

    // Reset pipeline state so planning can start fresh.
    // A previous crashed run may have left state.yaml mid-build.
    orch.reset();

    onProgress?.(tier.id, "Running planning...");

    // Run planning
    const planningResult = await orch.runPlanning(tier.idea, {
      autonomous: true,
      onProgress: (phase, status) => {
        onProgress?.(tier.id, `[planning] ${phase}: ${status}`);
      },
    });

    phaseReached = "PLANNING";

    // Continue into full pipeline
    onProgress?.(tier.id, "Running full pipeline...");

    const { runFullPipeline } = await import("../pipeline/runner.js");
    await runFullPipeline({
      orchestrator: orch,
      projectDir: tierProjectDir,
      profile,
      storiesMarkdown: planningResult.stories.stories,
      autonomous: true,
      onProgress: (phase, msg) => {
        onProgress?.(tier.id, `[${phase}] ${msg}`);
        // Track the highest phase reached
        const phaseIdx = PIPELINE_PHASES.indexOf(phase as typeof PIPELINE_PHASES[number]);
        const currentIdx = PIPELINE_PHASES.indexOf(phaseReached);
        if (phaseIdx > currentIdx) {
          phaseReached = phase as typeof PIPELINE_PHASES[number];
        }
      },
    });

    // Check final state
    const finalState = orch.getState();
    phaseReached = finalState.phase;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(msg);
  }

  // Collect notes from artifacts
  const notes = collectNotes(tier.id, tierProjectDir);

  // Evaluate success
  const phaseIdx = PIPELINE_PHASES.indexOf(phaseReached);
  const minPhaseIdx = PIPELINE_PHASES.indexOf(tier.successCriteria.minPhaseReached);
  const success = phaseIdx >= minPhaseIdx && errors.length === 0;

  // Tag post-run
  const postTag = `gauntlet/${tier.id}-post`;
  if (tagExists(postTag, projectRoot)) {
    deleteTag(postTag, projectRoot);
  }
  try {
    createTag(postTag, projectRoot);
  } catch {
    // Tag may fail if working tree is dirty — non-fatal
  }

  const durationMs = Date.now() - startTime;

  return {
    tierId: tier.id,
    level: tier.level,
    success,
    phaseReached,
    durationMs,
    errors,
    notes,
    tags: { post: postTag },
  };
}

/**
 * Run an evolution step after a tier.
 *
 * Reads the tier's artifacts, proposes prompt improvements,
 * commits changes, and updates the evolution log.
 */
export async function runEvolutionStep(
  tierResult: GauntletTierResult,
  projectRoot: string,
  gauntletId: string,
): Promise<EvolutionStepResult> {
  const filesChanged: string[] = [];
  let heuristicsAdded = 0;
  let archDecisionsAdded = 0;
  const promptsChanged: string[] = [];

  // Update evolution log
  const logPath = path.join(projectRoot, EVOLUTION_LOG_FILE);
  const existingLog = loadEvolutionLog(logPath);

  const baselineTag = `gauntlet/${gauntletId}-baseline`;
  const driftStats = tagExists(baselineTag, projectRoot)
    ? getDiffStats(baselineTag, "HEAD", projectRoot)
    : { filesChanged: 0, insertions: 0, deletions: 0 };

  const logEntry: EvolutionLogEntry = {
    tier: tierResult.tierId,
    date: new Date().toISOString(),
    promptsChanged,
    heuristicsAdded,
    archDecisionsAdded,
    cumulativeDiffLines: driftStats.insertions + driftStats.deletions,
    regressions: [],
  };

  existingLog.push(logEntry);
  fs.writeFileSync(logPath, YAML.stringify(existingLog), "utf-8");
  filesChanged.push(EVOLUTION_LOG_FILE);

  // Commit and tag
  const evolvedTag = `gauntlet/${tierResult.tierId}-evolved`;
  try {
    commitFiles(filesChanged, `gauntlet: evolution after ${tierResult.tierId}`, projectRoot);
    if (tagExists(evolvedTag, projectRoot)) {
      deleteTag(evolvedTag, projectRoot);
    }
    createTag(evolvedTag, projectRoot);
  } catch {
    // Commit may fail if nothing to commit
  }

  return {
    tierId: tierResult.tierId,
    promptsChanged,
    heuristicsAdded,
    archDecisionsAdded,
    filesChanged,
    approved: true,
    skipped: false,
  };
}

/** Load the evolution log from disk. */
function loadEvolutionLog(logPath: string): EvolutionLogEntry[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(logPath, "utf-8");
    const parsed = YAML.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
