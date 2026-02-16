/**
 * CLI program definition for Boop.
 *
 * Uses Commander to define the command structure.
 * Derived from OpenClaw's CLI framework (MIT license).
 */
import { Command } from "commander";
import { VERSION } from "../version.js";
import { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { editProfile, initGlobalConfig, runOnboarding } from "../config/index.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("boop")
    .description(
      "Automated development workflow — plan, build, review in one pipeline",
    )
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

  if (opts.status) {
    const orch = new PipelineOrchestrator(projectDir ?? process.cwd());
    console.log(orch.formatStatus());
    return;
  }

  if (opts.review) {
    console.log("[boop] Review phase — not yet implemented.");
    return;
  }

  if (opts.resume) {
    const orch = new PipelineOrchestrator(projectDir ?? process.cwd());
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
    console.log(`[boop] Starting pipeline with idea: "${idea}"`);
    if (opts.autonomous) {
      console.log("[boop] Running in autonomous mode.");
    }
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
