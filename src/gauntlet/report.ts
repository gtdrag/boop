/**
 * Gauntlet report generation.
 *
 * Produces markdown reports for full gauntlet runs, including
 * per-tier details, evolution audit trail, and drift analysis.
 */
import fs from "node:fs";
import path from "node:path";
import type { GauntletResult, EvolutionStepResult } from "./types.js";
import { generateTierReport } from "./note-collector.js";

/**
 * Generate a full markdown report for a gauntlet run.
 *
 * @param result - The complete gauntlet result.
 * @returns Markdown string.
 */
export function generateGauntletReport(result: GauntletResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Gauntlet Report: ${result.gauntletId}`);
  lines.push("");
  lines.push(`- **Run ID:** ${result.runId}`);
  lines.push(`- **Started:** ${result.startedAt}`);
  lines.push(`- **Completed:** ${result.completedAt}`);
  lines.push(`- **Git commit:** ${result.gitCommit}`);
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Tiers attempted | ${result.summary.totalTiers} |`);
  lines.push(`| Passed | ${result.summary.passed} |`);
  lines.push(`| Failed | ${result.summary.failed} |`);
  lines.push(`| Total duration | ${(result.summary.totalDurationMs / 1000).toFixed(1)}s |`);
  lines.push(`| Evolution steps | ${result.summary.evolutionSteps} |`);
  lines.push("");

  // Tier results table
  lines.push("## Tier Results");
  lines.push("");
  lines.push("| Tier | Status | Phase Reached | Duration |");
  lines.push("|------|--------|---------------|----------|");
  for (const tier of result.tiers) {
    const status = tier.success ? "PASS" : "FAIL";
    const duration = `${(tier.durationMs / 1000).toFixed(1)}s`;
    lines.push(`| ${tier.tierId} | ${status} | ${tier.phaseReached} | ${duration} |`);
  }
  lines.push("");

  // Per-tier details
  lines.push("## Tier Details");
  lines.push("");
  for (const tier of result.tiers) {
    lines.push(generateTierReport(tier));
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Evolution audit trail
  if (result.evolutionSteps.length > 0) {
    lines.push("## Evolution Audit Trail");
    lines.push("");
    for (const step of result.evolutionSteps) {
      lines.push(formatEvolutionStep(step));
      lines.push("");
    }
  }

  // Git tag reference
  lines.push("## Git Tags");
  lines.push("");
  for (const tier of result.tiers) {
    lines.push(`- \`${tier.tags.post}\` — after ${tier.tierId} pipeline run`);
    if (tier.tags.evolved) {
      lines.push(`- \`${tier.tags.evolved}\` — after ${tier.tierId} evolution`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

/** Format a single evolution step. */
function formatEvolutionStep(step: EvolutionStepResult): string {
  const lines: string[] = [];
  lines.push(`### Evolution: ${step.tierId}`);
  lines.push("");
  lines.push(`- **Approved:** ${step.approved ? "yes" : "no"}`);
  lines.push(`- **Skipped:** ${step.skipped ? "yes" : "no"}`);

  if (step.promptsChanged.length > 0) {
    lines.push(`- **Prompts changed:** ${step.promptsChanged.join(", ")}`);
  }
  if (step.heuristicsAdded > 0) {
    lines.push(`- **Heuristics added:** ${step.heuristicsAdded}`);
  }
  if (step.archDecisionsAdded > 0) {
    lines.push(`- **Arch decisions added:** ${step.archDecisionsAdded}`);
  }
  if (step.filesChanged.length > 0) {
    lines.push(`- **Files changed:** ${step.filesChanged.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Save a gauntlet report to disk.
 *
 * @param result - The complete gauntlet result.
 * @param outputDir - Directory to write the report to.
 * @returns Path to the saved report file.
 */
export function saveGauntletReport(result: GauntletResult, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });

  const reportPath = path.join(outputDir, `${result.runId}.md`);
  fs.writeFileSync(reportPath, generateGauntletReport(result), "utf-8");

  return reportPath;
}
