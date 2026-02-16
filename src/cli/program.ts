/**
 * CLI program definition for Boop.
 *
 * Uses Commander to define the command structure.
 * Derived from OpenClaw's CLI framework (MIT license).
 */
import { Command } from "commander";
import { VERSION } from "../version.js";
import { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import {
  editProfile,
  initGlobalConfig,
  loadProfileFromDisk,
  runOnboarding,
} from "../config/index.js";
import type { DeveloperProfile } from "../shared/types.js";
import { assessViability } from "../planning/viability.js";
import type { ViabilityResult } from "../planning/viability.js";
import { generatePrd } from "../planning/prd.js";
import type { PrdResult } from "../planning/prd.js";
import { generateArchitecture } from "../planning/architecture.js";
import type { ArchitectureResult } from "../planning/architecture.js";
import { generateStories } from "../planning/stories.js";
import type { StoriesResult } from "../planning/stories.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("boop")
    .description("Automated development workflow — plan, build, review in one pipeline")
    .version(VERSION)
    .argument("[idea]", "describe your project idea to start the pipeline")
    .option("--profile", "manage developer profile")
    .option("--status", "show current pipeline state")
    .option("--review", "run the review phase on the current project")
    .option("--resume", "resume an interrupted pipeline")
    .option("--autonomous", "run in fully autonomous mode (no prompts)")
    .action(async (idea: string | undefined, opts: CliOptions) => {
      await handleCli(idea, opts);
    });

  return program;
}

export interface CliOptions {
  profile?: boolean;
  status?: boolean;
  review?: boolean;
  resume?: boolean;
  autonomous?: boolean;
}

export async function handleCli(
  idea: string | undefined,
  opts: CliOptions,
  projectDir?: string,
  /** Override global config dir for testing. */
  globalConfigDir?: string,
): Promise<void> {
  // Initialize global ~/.boop/ directory structure on every run
  const { needsOnboarding, stateDir } = initGlobalConfig(globalConfigDir);

  if (opts.profile) {
    if (needsOnboarding) {
      await runOnboarding(stateDir);
    } else {
      await editProfile(stateDir);
    }
    return;
  }

  if (needsOnboarding) {
    await runOnboarding(stateDir);
  }

  // Load profile for pipeline operations
  const profile = loadProfileFromDisk(stateDir);

  if (opts.status) {
    const orch = new PipelineOrchestrator(projectDir ?? process.cwd(), profile ?? undefined);
    console.log(orch.formatStatus());
    return;
  }

  if (opts.review) {
    console.log("[boop] Review phase — not yet implemented.");
    return;
  }

  if (opts.resume) {
    const orch = new PipelineOrchestrator(projectDir ?? process.cwd(), profile ?? undefined);
    const context = orch.formatResumeContext();
    console.log(context);

    // If there's an active pipeline, ask user to confirm
    const state = orch.getState();
    if (state.phase !== "IDLE" || state.epicNumber !== 0) {
      const { confirm, isCancel } = await import("@clack/prompts");
      const shouldResume = await confirm({ message: "Resume pipeline?" });
      if (isCancel(shouldResume) || !shouldResume) {
        console.log("[boop] Resume cancelled.");
        return;
      }
      console.log("[boop] Resuming pipeline...");
    }
    return;
  }

  if (idea) {
    if (!profile) {
      console.log("[boop] No developer profile found. Please run onboarding first.");
      return;
    }
    await startPipeline(idea, profile, projectDir ?? process.cwd(), opts.autonomous);
    return;
  }

  // No args and no flags → interactive mode
  await enterInteractiveMode(opts);
}

async function enterInteractiveMode(opts: CliOptions): Promise<void> {
  const { text, isCancel } = await import("@clack/prompts");

  console.log();
  const ideaInput = await text({
    message: "Describe your project idea:",
    placeholder: "e.g. a task management API with PostgreSQL and Express",
    validate(value) {
      if (!value || !value.trim()) return "Please describe your idea.";
    },
  });

  if (isCancel(ideaInput)) {
    console.log("[boop] Cancelled.");
    return;
  }

  console.log(`[boop] Starting pipeline with idea: "${ideaInput}"`);
  if (opts.autonomous) {
    console.log("[boop] Running in autonomous mode.");
  }
}

/**
 * Start the pipeline: run viability assessment, then ask user to confirm.
 */
async function startPipeline(
  idea: string,
  profile: DeveloperProfile,
  projectDir: string,
  autonomous?: boolean,
): Promise<void> {
  console.log(`[boop] Starting pipeline with idea: "${idea}"`);
  if (autonomous) {
    console.log("[boop] Running in autonomous mode.");
  }

  console.log("[boop] Running viability assessment...");

  let result: ViabilityResult;
  try {
    result = await assessViability(idea, profile, { projectDir });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[boop] Viability assessment failed: ${msg}`);
    return;
  }

  console.log();
  console.log(result.assessment);
  console.log();
  console.log(`[boop] Recommendation: ${result.recommendation}`);
  console.log(`[boop] Assessment saved to .boop/planning/viability.md`);

  if (autonomous) {
    if (result.recommendation === "RECONSIDER") {
      console.log("[boop] Recommendation is RECONSIDER — stopping pipeline.");
      return;
    }
    console.log("[boop] Proceeding to PRD generation...");
    await runPrdPhase(idea, profile, projectDir, result.assessment);
    return;
  }

  // Ask user to confirm, revise, or stop
  const { select, text, isCancel } = await import("@clack/prompts");

  const action = await select({
    message: "How would you like to proceed?",
    options: [
      { value: "proceed", label: "Proceed to PRD generation" },
      { value: "revise", label: "Revise the idea and re-assess" },
      { value: "stop", label: "Stop and reconsider" },
    ],
  });

  if (isCancel(action)) {
    console.log("[boop] Cancelled.");
    return;
  }

  if (action === "stop") {
    console.log("[boop] Pipeline stopped. You can resume later with 'boop --resume'.");
    return;
  }

  if (action === "revise") {
    const revised = await text({
      message: "Describe your revised idea:",
      placeholder: idea,
    });

    if (isCancel(revised) || !revised?.trim()) {
      console.log("[boop] Cancelled.");
      return;
    }

    // Recurse with revised idea
    await startPipeline(revised as string, profile, projectDir, autonomous);
    return;
  }

  // action === "proceed"
  console.log("[boop] Proceeding to PRD generation...");
  await runPrdPhase(idea, profile, projectDir, result.assessment);
}

/**
 * Run the PRD generation phase.
 */
async function runPrdPhase(
  idea: string,
  profile: DeveloperProfile,
  projectDir: string,
  viabilityAssessment: string,
): Promise<void> {
  console.log("[boop] Generating PRD...");

  let result: PrdResult;
  try {
    result = await generatePrd(idea, profile, viabilityAssessment, { projectDir });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[boop] PRD generation failed: ${msg}`);
    return;
  }

  console.log();
  console.log(result.prd);
  console.log();
  console.log("[boop] PRD saved to .boop/planning/prd.md");

  // Chain to architecture generation
  console.log("[boop] Proceeding to architecture generation...");
  await runArchitecturePhase(idea, profile, projectDir, result.prd);
}

/**
 * Run the architecture generation phase.
 */
async function runArchitecturePhase(
  idea: string,
  profile: DeveloperProfile,
  projectDir: string,
  prd: string,
): Promise<void> {
  console.log("[boop] Generating architecture...");

  let result: ArchitectureResult;
  try {
    result = await generateArchitecture(idea, profile, prd, { projectDir });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[boop] Architecture generation failed: ${msg}`);
    return;
  }

  console.log();
  console.log(result.architecture);
  console.log();
  console.log("[boop] Architecture saved to .boop/planning/architecture.md");

  // Chain to story breakdown
  console.log("[boop] Proceeding to epic & story breakdown...");
  await runStoriesPhase(idea, profile, projectDir, prd, result.architecture);
}

/**
 * Run the epic & story breakdown phase.
 */
async function runStoriesPhase(
  idea: string,
  profile: DeveloperProfile,
  projectDir: string,
  prd: string,
  architecture: string,
): Promise<void> {
  console.log("[boop] Generating epics & stories...");

  let result: StoriesResult;
  try {
    result = await generateStories(idea, profile, prd, architecture, { projectDir });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[boop] Story breakdown failed: ${msg}`);
    return;
  }

  console.log();
  console.log(result.stories);
  console.log();
  console.log("[boop] Epics & stories saved to .boop/planning/epics.md");
}
