/**
 * Scorecard generation from benchmark results.
 *
 * Produces both JSON (for machine consumption) and
 * markdown (for human-readable reporting) from a BenchmarkResult.
 */
import type { BenchmarkResult, BenchmarkCaseResult, PhaseMetrics } from "./types.js";

/**
 * Generate a JSON scorecard string from a benchmark result.
 */
export function toJson(result: BenchmarkResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Generate a human-readable markdown scorecard from a benchmark result.
 */
export function toMarkdown(result: BenchmarkResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Benchmark Scorecard: ${result.suiteId}`);
  lines.push("");
  lines.push(`- **Mode:** ${result.mode}`);
  lines.push(`- **Started:** ${result.startedAt}`);
  lines.push(`- **Completed:** ${result.completedAt}`);
  lines.push(`- **Git Commit:** ${result.gitCommit}`);
  lines.push(`- **Boop Version:** ${result.boopVersion}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Cases | ${result.summary.totalCases} |`);
  lines.push(`| Passed | ${result.summary.passed} |`);
  lines.push(`| Failed | ${result.summary.failed} |`);
  lines.push(`| Total Duration | ${formatDuration(result.summary.totalDurationMs)} |`);
  lines.push(
    `| Total Tokens | ${formatTokens(result.summary.totalTokenUsage.inputTokens + result.summary.totalTokenUsage.outputTokens)} |`,
  );
  lines.push(`| Total Retries | ${result.summary.totalRetries} |`);
  lines.push("");

  // Per-case details
  lines.push("## Cases");
  lines.push("");

  for (const caseResult of result.cases) {
    lines.push(...formatCaseSection(caseResult));
    lines.push("");
  }

  return lines.join("\n");
}

/** Format a single case result as markdown lines. */
function formatCaseSection(caseResult: BenchmarkCaseResult): string[] {
  const lines: string[] = [];
  const icon = caseResult.success ? "PASS" : "FAIL";

  lines.push(`### [${icon}] ${caseResult.caseId}`);
  lines.push("");
  lines.push(`- **Status:** ${caseResult.success ? "passed" : "failed"}`);
  lines.push(`- **Last Phase:** ${caseResult.lastPhaseReached}`);
  lines.push(`- **Duration:** ${formatDuration(caseResult.totalDurationMs)}`);
  lines.push(
    `- **Tokens:** ${formatTokens(caseResult.totalTokenUsage.inputTokens)} in / ${formatTokens(caseResult.totalTokenUsage.outputTokens)} out`,
  );
  lines.push(`- **Retries:** ${caseResult.totalRetries}`);

  if (caseResult.terminalError) {
    lines.push(`- **Error:** ${caseResult.terminalError}`);
  }

  // Phase breakdown table
  if (caseResult.phases.length > 0) {
    lines.push("");
    lines.push("| Phase | Status | Duration | Tokens (in/out) | Retries |");
    lines.push("|-------|--------|----------|-----------------|---------|");

    for (const phase of caseResult.phases) {
      lines.push(formatPhaseRow(phase));
    }
  }

  // Expectations
  if (caseResult.expectationResults.length > 0) {
    lines.push("");
    lines.push("**Expectations:**");
    for (const exp of caseResult.expectationResults) {
      const icon = exp.passed ? "PASS" : "FAIL";
      lines.push(
        `- [${icon}] ${exp.expectation.metric} = ${String(exp.actual)} (expected: ${String(exp.expectation.expected)})`,
      );
    }
  }

  return lines;
}

/** Format a phase metrics row for the table. */
function formatPhaseRow(phase: PhaseMetrics): string {
  const status = phase.success ? "ok" : "fail";
  const duration = formatDuration(phase.durationMs);
  const tokens = `${formatTokens(phase.tokenUsage.inputTokens)}/${formatTokens(phase.tokenUsage.outputTokens)}`;
  return `| ${phase.phase} | ${status} | ${duration} | ${tokens} | ${phase.retryCount} |`;
}

/** Format milliseconds as a human-readable duration. */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(0);
  return `${minutes}m${seconds}s`;
}

/** Format a token count with comma separators. */
export function formatTokens(count: number): string {
  return count.toLocaleString("en-US");
}
