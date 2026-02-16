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
    .description("Automated development workflow — plan, build, review in one pipeline")
    .version(VERSION)
    .argument("[idea]", "describe your project idea to start the pipeline")
    .action(async (idea?: string) => {
      if (idea) {
        console.log(`[boop] Starting pipeline with idea: "${idea}"`);
        // Pipeline orchestrator will be wired here in Story 1.4
      } else {
        console.log("[boop] Interactive mode — describe your project idea:");
        // Interactive mode will be wired here in Story 1.2
      }
    });

  program
    .command("status")
    .description("Show current pipeline state")
    .action(async () => {
      console.log("[boop] No active pipeline. Run 'boop <idea>' to start.");
      // Pipeline state display will be wired here in Story 1.4
    });

  program
    .command("resume")
    .description("Resume an interrupted pipeline")
    .action(async () => {
      console.log("[boop] No interrupted pipeline to resume.");
      // Resume logic will be wired here in Story 1.4
    });

  program
    .command("review")
    .description("Run the review phase on the current project")
    .action(async () => {
      console.log("[boop] Review phase — not yet implemented.");
    });

  program
    .command("profile")
    .description("Manage developer profile")
    .action(async () => {
      console.log("[boop] Profile management — not yet implemented.");
    });

  return program;
}
