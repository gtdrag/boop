/**
 * CLI program definition for Boop.
 *
 * Uses Commander to define the command structure.
 * Derived from OpenClaw's CLI framework (MIT license).
 */
import { Command } from "commander";
import { VERSION } from "../version.js";
import { PipelineOrchestrator, PlanningPhaseError } from "../pipeline/orchestrator.js";
import {
  editProfile,
  initGlobalConfig,
  loadProfileFromDisk,
  runOnboarding,
} from "../config/index.js";
import type { DeveloperProfile } from "../shared/types.js";
import { registerBenchmarkCommands } from "../benchmark/commands.js";
import { registerGauntletCommands } from "../gauntlet/commands.js";

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
    .option("--sandbox", "run build agents inside Docker containers for isolation")
    .action(async (idea: string | undefined, opts: CliOptions) => {
      await handleCli(idea, opts);
    });

  registerBenchmarkCommands(program);
  registerGauntletCommands(program);

  return program;
}

export interface CliOptions {
  profile?: boolean;
  status?: boolean;
  review?: boolean;
  resume?: boolean;
  autonomous?: boolean;
  sandbox?: boolean;
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
    const dir = projectDir ?? process.cwd();
    const { loadState } = await import("../pipeline/state.js");
    const state = loadState(dir);

    if (!state || state.phase !== "REVIEWING" || state.epicNumber === 0) {
      console.log("[boop] No active epic in REVIEWING phase. Nothing to review.");
      return;
    }

    const { runAdversarialLoop } = await import("../review/adversarial/loop.js");
    const { generateAdversarialSummary, toReviewPhaseResult } =
      await import("../review/adversarial/summary.js");
    const { runEpicSignOff } = await import("../pipeline/epic-loop.js");
    const { execSync } = await import("node:child_process");

    console.log(`[boop] Running adversarial review for Epic ${state.epicNumber}...`);

    const testSuiteRunner = async () => {
      try {
        const output = execSync("pnpm test", {
          cwd: dir,
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

    const loopResult = await runAdversarialLoop({
      projectDir: dir,
      epicNumber: state.epicNumber,
      testSuiteRunner,
      onProgress: (iter, phase, msg) => console.log(`[boop] [iter ${iter}] ${phase}: ${msg}`),
    });

    const summary = generateAdversarialSummary(dir, state.epicNumber, loopResult);
    const reviewResult = toReviewPhaseResult(state.epicNumber, loopResult);

    const signOffResult = await runEpicSignOff({
      projectDir: dir,
      epicNumber: state.epicNumber,
      reviewResult,
    });

    console.log(summary.markdown);
    console.log();
    console.log(
      signOffResult.approved
        ? `[boop] Epic ${state.epicNumber} review approved.`
        : `[boop] Epic ${state.epicNumber} review not approved. Blocking issues remain.`,
    );
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
    await startPipeline(idea, profile, projectDir ?? process.cwd(), opts.autonomous, opts.sandbox);
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
 * Start the pipeline: run the planning chain (viability → PRD → architecture → stories).
 */
async function startPipeline(
  idea: string,
  profile: DeveloperProfile,
  projectDir: string,
  autonomous?: boolean,
  sandboxed?: boolean,
): Promise<void> {
  console.log(`[boop] Starting pipeline with idea: "${idea}"`);
  if (autonomous) {
    console.log("[boop] Running in autonomous mode.");
  }

  const orch = new PipelineOrchestrator(projectDir, profile);

  if (autonomous) {
    // Run the full planning chain without user interaction
    try {
      const result = await orch.runPlanning(idea, {
        autonomous: true,
        onProgress: (phase, status) => {
          if (status === "starting") console.log(`[boop] Running ${phase}...`);
          if (status === "completed") console.log(`[boop] ${phase} completed.`);
          if (status === "retrying") console.log(`[boop] Retrying ${phase}...`);
          if (status === "warning")
            console.log(`[boop] WARNING: ${phase} recommends reconsideration — continuing anyway.`);
        },
      });

      console.log();
      console.log(`[boop] Recommendation: ${result.viability.recommendation}`);
      console.log("[boop] Planning complete. All outputs saved to .boop/planning/");

      // Continue into the full pipeline
      const { runFullPipeline } = await import("../pipeline/runner.js");
      await runFullPipeline({
        orchestrator: orch,
        projectDir,
        profile,
        storiesMarkdown: result.stories.stories,
        autonomous: true,
        sandboxed,
        onProgress: (phase, msg) => console.log(`[boop] [${phase}] ${msg}`),
      });
    } catch (error: unknown) {
      if (error instanceof PlanningPhaseError) {
        console.error(`[boop] Planning failed at "${error.phase}": ${error.message}`);
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[boop] Pipeline failed: ${msg}`);
      }
    }
    return;
  }

  // Interactive mode: run viability first, then ask user
  const { assessViability } = await import("../planning/viability.js");
  console.log("[boop] Running viability assessment...");

  let viabilityResult: Awaited<ReturnType<typeof assessViability>>;
  try {
    viabilityResult = await assessViability(idea, profile, { projectDir });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[boop] Viability assessment failed: ${msg}`);
    return;
  }

  console.log();
  console.log(viabilityResult.assessment);
  console.log();
  console.log(`[boop] Recommendation: ${viabilityResult.recommendation}`);
  console.log(`[boop] Assessment saved to .boop/planning/viability.md`);

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
    await startPipeline(revised as string, profile, projectDir, autonomous, sandboxed);
    return;
  }

  // action === "proceed" — run remaining planning phases via orchestrator
  try {
    // Transition to PLANNING and set viability as completed
    if (orch.getState().phase === "IDLE") {
      orch.transition("PLANNING");
    }
    orch.setLastCompletedStep("viability");

    // Run remaining phases (PRD → architecture → stories)
    const { generatePrd } = await import("../planning/prd.js");
    const { generateArchitecture } = await import("../planning/architecture.js");
    const { generateStories } = await import("../planning/stories.js");

    console.log("[boop] Generating PRD...");
    const prdResult = await generatePrd(idea, profile, viabilityResult.assessment, { projectDir });
    orch.setLastCompletedStep("prd");
    console.log("[boop] PRD saved to .boop/planning/prd.md");

    console.log("[boop] Generating architecture...");
    const archResult = await generateArchitecture(idea, profile, prdResult.prd, { projectDir });
    orch.setLastCompletedStep("architecture");
    console.log("[boop] Architecture saved to .boop/planning/architecture.md");

    console.log("[boop] Generating epics & stories...");
    const storiesResult = await generateStories(
      idea,
      profile,
      prdResult.prd,
      archResult.architecture,
      { projectDir },
    );
    orch.setLastCompletedStep("stories");
    console.log("[boop] Epics & stories saved to .boop/planning/epics.md");

    console.log("[boop] Planning complete. All outputs saved to .boop/planning/");

    // Continue into the full pipeline
    const { runFullPipeline } = await import("../pipeline/runner.js");
    await runFullPipeline({
      orchestrator: orch,
      projectDir,
      profile,
      storiesMarkdown: storiesResult.stories,
      autonomous: false,
      sandboxed,
      onProgress: (phase, msg) => console.log(`[boop] [${phase}] ${msg}`),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[boop] Pipeline failed: ${msg}`);
  }
}
