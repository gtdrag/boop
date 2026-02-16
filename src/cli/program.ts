/**
 * CLI program definition for Boop.
 *
 * Uses Commander to define the command structure.
 * Derived from OpenClaw's CLI framework (MIT license).
 */
import { Command } from "commander";
import { VERSION } from "../version.js";

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
): Promise<void> {
  if (opts.profile) {
    console.log("[boop] Profile management — not yet implemented.");
    return;
  }

  if (opts.status) {
    console.log("[boop] No active pipeline. Run 'boop <idea>' to start.");
    return;
  }

  if (opts.review) {
    console.log("[boop] Review phase — not yet implemented.");
    return;
  }

  if (opts.resume) {
    console.log("[boop] No interrupted pipeline to resume.");
    return;
  }

  if (idea) {
    console.log(`[boop] Starting pipeline with idea: "${idea}"`);
    if (opts.autonomous) {
      console.log("[boop] Running in autonomous mode.");
    }
    // Pipeline orchestrator will be wired here in Story 1.4
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
  // Pipeline orchestrator will be wired here in Story 1.4
}
