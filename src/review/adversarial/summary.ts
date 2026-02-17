/**
 * Adversarial review summary — consolidates all iteration results
 * into a single markdown report for the sign-off gate.
 *
 * Replaces the existing review summary with a comprehensive view of
 * what was found, what was fixed, and what remains.
 */
import fs from "node:fs";
import path from "node:path";

import type { AdversarialLoopResult } from "./loop.js";
import type { ReviewPhaseResult, ReviewFinding } from "../team-orchestrator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdversarialSummary {
  /** Generated markdown report. */
  markdown: string;
  /** Whether all findings were resolved. */
  allResolved: boolean;
  /** Path where the summary was saved. */
  savedPath: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityTable(findings: Array<{ severity: string }>): string {
  const counts = new Map<string, number>();
  for (const f of findings) {
    counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  }

  if (counts.size === 0) return "No findings.\n";

  const lines = ["| Severity | Count |", "| -------- | ----- |"];
  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    const count = counts.get(sev);
    if (count) lines.push(`| ${sev} | ${count} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function exitReasonLabel(reason: string): string {
  switch (reason) {
    case "converged":
      return "Converged (zero findings)";
    case "max-iterations":
      return "Max iterations reached";
    case "stuck":
      return "Stuck (same findings repeated)";
    case "test-failure":
      return "Tests failing after fixes";
    case "diverging":
      return "Diverging (finding count increasing — stopped to prevent doom loop)";
    default:
      return reason;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a consolidated adversarial review summary.
 *
 * The summary includes:
 *   - Total findings by severity across all iterations
 *   - Findings auto-fixed (with commit references)
 *   - Findings unable to auto-fix (with error context)
 *   - Findings discarded by verifier (count only)
 *   - Iteration count and convergence status
 *   - Test suite status
 */
export function generateAdversarialSummary(
  projectDir: string,
  epicNumber: number,
  loopResult: AdversarialLoopResult,
): AdversarialSummary {
  const lines: string[] = [];

  // Header
  lines.push(`# Epic ${epicNumber} Adversarial Review Summary`);
  lines.push("");
  lines.push(`**Date:** ${new Date().toISOString()}`);
  lines.push(`**Iterations:** ${loopResult.iterations.length}`);
  lines.push(`**Status:** ${exitReasonLabel(loopResult.exitReason)}`);
  lines.push(`**All Resolved:** ${loopResult.converged ? "Yes" : "No"}`);
  lines.push("");

  // Overview stats
  lines.push("## Overview");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`| ------ | ----- |`);
  lines.push(`| Total findings (all iterations) | ${loopResult.totalFindings} |`);
  lines.push(`| Auto-fixed | ${loopResult.totalFixed} |`);
  lines.push(`| Deferred (medium/low — not auto-fixed) | ${loopResult.deferredFindings.length} |`);
  lines.push(`| Discarded (hallucinations) | ${loopResult.totalDiscarded} |`);
  lines.push(`| Unresolved | ${loopResult.unresolvedFindings.length} |`);
  lines.push("");

  // Per-iteration breakdown
  lines.push("## Iteration Breakdown");
  lines.push("");

  for (const iter of loopResult.iterations) {
    const allFindings = iter.agentResults.flatMap((a) => a.findings);
    lines.push(`### Iteration ${iter.iteration}`);
    lines.push("");
    lines.push(`- **Findings:** ${allFindings.length}`);
    lines.push(`- **Verified:** ${iter.verification.stats.verified}`);
    lines.push(`- **Discarded:** ${iter.verification.stats.discarded}`);
    if (iter.fixResult) {
      lines.push(`- **Fixed:** ${iter.fixResult.fixed.length}`);
      lines.push(`- **Unfixed:** ${iter.fixResult.unfixed.length}`);
    }
    lines.push(`- **Tests pass:** ${iter.testsPass ? "Yes" : "No"}`);
    lines.push("");

    // Agent breakdown
    for (const agent of iter.agentResults) {
      const status = agent.success ? "completed" : "failed";
      lines.push(`**${agent.agent}** (${status}): ${agent.findings.length} findings`);
    }
    lines.push("");
  }

  // Auto-fixed findings
  const fixedResults = loopResult.allFixResults.filter((r) => r.fixed);
  if (fixedResults.length > 0) {
    lines.push("## Auto-Fixed Findings");
    lines.push("");
    for (const result of fixedResults) {
      const sha = result.commitSha ? ` (${result.commitSha.slice(0, 7)})` : "";
      lines.push(`- **[${result.finding.severity.toUpperCase()}]** ${result.finding.title}${sha}`);
      if (result.finding.file) {
        lines.push(`  - File: \`${result.finding.file}\``);
      }
    }
    lines.push("");
  }

  // Unresolved findings
  if (loopResult.unresolvedFindings.length > 0) {
    lines.push("## Unresolved Findings");
    lines.push("");
    lines.push(
      `The following ${loopResult.unresolvedFindings.length} findings could not be auto-fixed after ${loopResult.iterations.length} iterations:`,
    );
    lines.push("");

    for (const finding of loopResult.unresolvedFindings) {
      lines.push(`### [${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push("");
      if (finding.file) lines.push(`**File:** \`${finding.file}\``);
      lines.push(`**Source:** ${finding.source}`);
      lines.push("");
      lines.push(finding.description);
      lines.push("");

      // Find the fix error for this finding
      const fixAttempt = loopResult.allFixResults.find(
        (r) => r.finding.id === finding.id && !r.fixed,
      );
      if (fixAttempt?.error) {
        lines.push(`**Fix error:** ${fixAttempt.error}`);
        lines.push(`**Attempts:** ${fixAttempt.attempts}`);
        lines.push("");
      }
    }
  }

  // Unresolved severity table
  if (loopResult.unresolvedFindings.length > 0) {
    lines.push("### Unresolved by Severity");
    lines.push("");
    lines.push(severityTable(loopResult.unresolvedFindings));
  }

  // Deferred findings (medium/low — captured for future reference, not auto-fixed)
  if (loopResult.deferredFindings.length > 0) {
    lines.push("## Deferred Findings (Future Improvements)");
    lines.push("");
    lines.push(
      "The following findings were below the auto-fix severity threshold. " +
        "They are captured here for future reference but were not auto-fixed.",
    );
    lines.push("");

    for (const finding of loopResult.deferredFindings) {
      lines.push(`- **[${finding.severity.toUpperCase()}]** ${finding.title}`);
      if (finding.file) lines.push(`  - File: \`${finding.file}\``);
      lines.push(`  - ${finding.description}`);
    }
    lines.push("");
  }

  const markdown = lines.join("\n");

  // Save summary
  const reviewDir = path.join(projectDir, ".boop", "reviews", `epic-${epicNumber}`);
  fs.mkdirSync(reviewDir, { recursive: true });
  const savedPath = path.join(reviewDir, "adversarial-summary.md");
  fs.writeFileSync(savedPath, markdown, "utf-8");

  return {
    markdown,
    allResolved: loopResult.converged,
    savedPath,
  };
}

/**
 * Convert an adversarial loop result into a ReviewPhaseResult
 * for compatibility with the existing sign-off flow.
 *
 * This bridges the adversarial system back to the existing pipeline
 * types so sign-off, messaging, and epic-loop continue to work unchanged.
 */
export function toReviewPhaseResult(
  epicNumber: number,
  loopResult: AdversarialLoopResult,
): ReviewPhaseResult {
  // Convert adversarial findings to ReviewFinding format
  const allFindings: ReviewFinding[] = loopResult.unresolvedFindings.map((f) => ({
    title: f.title,
    severity: f.severity,
    file: f.file,
    description: f.description,
  }));

  const blockingIssues = allFindings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .map((f) => `[${f.severity}] ${f.title}${f.file ? ` in ${f.file}` : ""}`);

  // Add test failure as blocking if applicable
  const lastIter = loopResult.iterations[loopResult.iterations.length - 1];
  if (lastIter && !lastIter.testsPass) {
    blockingIssues.push("Test suite failing after adversarial review fixes");
  }

  return {
    epicNumber,
    parallelResults: [],
    refactoringResult: null,
    testHardeningResult: null,
    testSuiteResult: lastIter
      ? { passed: lastIter.testsPass, output: "" }
      : { passed: true, output: "" },
    securityResult: null,
    qaResult: null,
    canAdvance: blockingIssues.length === 0,
    blockingIssues,
    lastCompletedPhase: null,
  };
}
