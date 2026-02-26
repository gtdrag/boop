/**
 * Improve mode runner — iteratively analyzes and fixes an existing codebase.
 *
 * Per cycle:
 *   1. ANALYZING — scan codebase, run adversarial agents, verify findings
 *   2. Generate improvement PRD from findings
 *   3. BUILDING — execute stories via ralph-loop (reuse)
 *   4. REVIEWING — adversarial review loop (reuse)
 *   5. SIGN_OFF — epic sign-off (reuse)
 *   6. Check convergence — stop or continue
 *
 * After all cycles: RETROSPECTIVE (reuse).
 */
import path from "node:path";
import { execSync } from "node:child_process";

import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import type { DeveloperProfile } from "../shared/types.js";
import { resolveModel } from "../shared/model-router.js";
import { runLoopIteration } from "../build/ralph-loop.js";
import { runAdversarialLoop } from "../review/adversarial/loop.js";
import { generateAdversarialSummary, toReviewPhaseResult } from "../review/adversarial/summary.js";
import { runEpicSignOff } from "../pipeline/epic-loop.js";
import type { TestSuiteResult } from "../review/team-orchestrator.js";
import { analyzeCodebase } from "./analyzer.js";
import type { ImproveFocus } from "./analyzer.js";
import { generateImprovementPrd } from "./planner.js";
import {
  createConvergenceState,
  recordCycle,
  shouldStop,
  formatTrend,
  saveConvergenceState,
} from "./convergence.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImproveRunnerOptions {
  orchestrator: PipelineOrchestrator;
  projectDir: string;
  profile: DeveloperProfile;
  maxDepth: number;
  focus?: ImproveFocus;
  autonomous?: boolean;
  sandboxed?: boolean;
  convergenceThreshold?: number;
  onProgress?: (phase: string, message: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestSuiteRunner(projectDir: string) {
  return async (): Promise<TestSuiteResult> => {
    try {
      const output = execSync("pnpm test", {
        cwd: projectDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 300_000,
      });
      return { passed: true, output };
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string };
      const output = [execError.stdout ?? "", execError.stderr ?? ""].filter(Boolean).join("\n");
      return { passed: false, output };
    }
  };
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runImproveLoop(options: ImproveRunnerOptions): Promise<void> {
  const {
    orchestrator: orch,
    projectDir,
    profile,
    maxDepth,
    focus = "all",
    autonomous = false,
    sandboxed = false,
    convergenceThreshold,
    onProgress,
  } = options;

  const convergenceState = createConvergenceState(maxDepth, convergenceThreshold);
  const allAddressedFindingIds: string[] = [];

  for (let cycle = 1; cycle <= maxDepth; cycle++) {
    onProgress?.("IMPROVE", `Starting improvement cycle ${cycle}/${maxDepth}`);

    // Each cycle = one "epic"
    orch.startEpic(cycle);

    // --- 1. ANALYZING ---
    orch.transition("ANALYZING");
    onProgress?.("ANALYZING", `Analyzing codebase (focus: ${focus})...`);

    const analysis = await analyzeCodebase(projectDir, {
      focus,
      profile,
      onProgress: (phase, msg) => onProgress?.("ANALYZING", `[${phase}] ${msg}`),
    });

    if (analysis.verifiedFindings.length === 0) {
      onProgress?.("ANALYZING", "No findings — codebase is clean");
      recordCycle(convergenceState, {
        cycle,
        totalFindings: 0,
        fixed: 0,
        remaining: 0,
        timestamp: new Date().toISOString(),
      });
      saveConvergenceState(projectDir, convergenceState);
      // Skip to SIGN_OFF (no fixes needed)
      orch.transition("SIGN_OFF");
      break;
    }

    onProgress?.("ANALYZING", `${analysis.verifiedFindings.length} verified findings`);

    // Generate improvement PRD from findings
    onProgress?.("ANALYZING", "Generating improvement stories...");
    const plan = await generateImprovementPrd(
      projectDir,
      analysis.verifiedFindings,
      analysis.snapshot,
      profile,
      {
        focus,
        cycleNumber: cycle,
        previousFindingIds: allAddressedFindingIds,
      },
    );

    onProgress?.("ANALYZING", `Generated ${plan.prd.userStories.length} improvement stories`);

    // --- 2. BUILDING ---
    orch.transition("BUILDING");
    onProgress?.("BUILDING", `Building improvements for cycle ${cycle}...`);

    const prdPath = path.join(projectDir, ".boop", "prd.json");
    const maxIterations = plan.prd.userStories.length * 3;

    for (let i = 0; i < maxIterations; i++) {
      const result = await runLoopIteration({
        projectDir,
        prdPath,
        model: resolveModel("building", profile),
        epicNumber: cycle,
        sandboxed,
      });

      if (result.allComplete) {
        onProgress?.("BUILDING", `All improvement stories complete for cycle ${cycle}`);
        break;
      }

      if (result.outcome === "failed") {
        onProgress?.("BUILDING", `Build failed: ${result.error ?? "unknown error"}`);
        break;
      }

      if (result.outcome === "no-stories") {
        onProgress?.("BUILDING", "No more stories to process");
        break;
      }

      onProgress?.("BUILDING", `Story ${result.story?.id ?? "?"} passed`);
    }

    // --- 3. REVIEWING ---
    orch.transition("REVIEWING");
    onProgress?.("REVIEWING", `Running adversarial review for cycle ${cycle}...`);

    const loopResult = await runAdversarialLoop({
      projectDir,
      epicNumber: cycle,
      testSuiteRunner: createTestSuiteRunner(projectDir),
      model: resolveModel("review", profile),
      onProgress: (iter, phase, msg) =>
        onProgress?.("REVIEWING", `[iter ${iter}] ${phase}: ${msg}`),
    });

    generateAdversarialSummary(projectDir, cycle, loopResult);
    const reviewResult = toReviewPhaseResult(cycle, loopResult);

    onProgress?.("REVIEWING", `Review complete: ${loopResult.totalFixed} fixed, ${loopResult.unresolvedFindings.length} remaining`);

    // --- 4. SIGN_OFF ---
    orch.transition("SIGN_OFF");
    onProgress?.("SIGN_OFF", `Cycle ${cycle} sign-off`);

    await runEpicSignOff({
      projectDir,
      epicNumber: cycle,
      reviewResult,
      autonomous,
    });

    // Track addressed findings
    const fixedIds = analysis.verifiedFindings
      .filter((f) => !loopResult.unresolvedFindings.some((u) => u.id === f.id))
      .map((f) => f.id);
    allAddressedFindingIds.push(...fixedIds);

    // --- 5. Convergence check ---
    const remaining = loopResult.unresolvedFindings.length;
    recordCycle(convergenceState, {
      cycle,
      totalFindings: analysis.verifiedFindings.length,
      fixed: fixedIds.length,
      remaining,
      timestamp: new Date().toISOString(),
    });

    saveConvergenceState(projectDir, convergenceState);

    const decision = shouldStop(convergenceState);
    onProgress?.("IMPROVE", `Cycle ${cycle} done. ${decision.reason}`);
    onProgress?.("IMPROVE", formatTrend(convergenceState));

    if (decision.stop) {
      onProgress?.("IMPROVE", `Stopping: ${decision.reason}`);
      break;
    }
  }

  // --- RETROSPECTIVE ---
  orch.transition("RETROSPECTIVE");
  onProgress?.("RETROSPECTIVE", "Running retrospective...");

  try {
    const { analyze } = await import("../retrospective/analyzer.js");
    const { generateReport, saveReport, formatSummary } = await import(
      "../retrospective/reporter.js"
    );

    const retroData = analyze({
      projectDir,
      projectName: path.basename(projectDir),
      totalEpics: convergenceState.cycles.length,
    });

    const report = generateReport(retroData);
    saveReport(projectDir, report);

    const summary = formatSummary(retroData);
    onProgress?.("RETROSPECTIVE", summary);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    onProgress?.("RETROSPECTIVE", `Warning: retrospective failed: ${msg}`);
  }

  orch.transition("COMPLETE");
  onProgress?.("COMPLETE", "Improve mode finished");
}
