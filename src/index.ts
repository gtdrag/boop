#!/usr/bin/env node
/**
 * Boop — automated development workflow CLI.
 *
 * This is the main entry point. It bootstraps the CLI program,
 * installs error handlers, and delegates to Commander.
 *
 * Derived from OpenClaw (MIT license).
 */
import process from "node:process";
import { buildProgram } from "./cli/program.js";

const program = buildProgram();

process.on("uncaughtException", (error) => {
  console.error(
    "[boop] Uncaught exception:",
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(
    "[boop] Unhandled rejection:",
    reason instanceof Error ? (reason.stack ?? reason.message) : reason,
  );
  process.exit(1);
});

void program.parseAsync(process.argv).catch((err) => {
  console.error("[boop] CLI failed:", err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
