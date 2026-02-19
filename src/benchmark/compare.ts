/**
 * Benchmark comparison — diff two runs and detect regressions.
 *
 * Thresholds for regression detection:
 * - Duration: >50% slower
 * - Tokens: >30% more tokens
 * - Status: any pass→fail transition
 */
import type {
  BenchmarkResult,
  BenchmarkComparison,
  CaseComparison,
  Regression,
} from "./types.js";

/** Duration regression threshold (50% slower). */
const DURATION_REGRESSION_PCT = 50;

/** Token regression threshold (30% more). */
const TOKEN_REGRESSION_PCT = 30;

/**
 * Compare two benchmark runs and detect regressions.
 *
 * Cases are matched by caseId. Cases present in only one run
 * are silently skipped.
 *
 * @param baseline - The baseline (earlier) run.
 * @param current - The current (later) run.
 */
export function compareRuns(
  baseline: BenchmarkResult,
  current: BenchmarkResult,
): BenchmarkComparison {
  const caseComparisons: CaseComparison[] = [];
  const regressions: Regression[] = [];

  for (const currentCase of current.cases) {
    const baselineCase = baseline.cases.find((c) => c.caseId === currentCase.caseId);
    if (!baselineCase) continue;

    const baseTokens =
      baselineCase.totalTokenUsage.inputTokens + baselineCase.totalTokenUsage.outputTokens;
    const currTokens =
      currentCase.totalTokenUsage.inputTokens + currentCase.totalTokenUsage.outputTokens;

    const durationDeltaMs = currentCase.totalDurationMs - baselineCase.totalDurationMs;
    const durationDeltaPct =
      baselineCase.totalDurationMs > 0
        ? (durationDeltaMs / baselineCase.totalDurationMs) * 100
        : 0;

    const tokenDelta = currTokens - baseTokens;
    const tokenDeltaPct = baseTokens > 0 ? (tokenDelta / baseTokens) * 100 : 0;

    const statusChanged = baselineCase.success !== currentCase.success;

    const comparison: CaseComparison = {
      caseId: currentCase.caseId,
      durationDeltaMs,
      durationDeltaPct,
      tokenDelta,
      tokenDeltaPct,
      statusChanged,
      baselineSuccess: baselineCase.success,
      currentSuccess: currentCase.success,
    };

    caseComparisons.push(comparison);

    // Detect regressions
    if (statusChanged && baselineCase.success && !currentCase.success) {
      regressions.push({
        caseId: currentCase.caseId,
        metric: "status",
        message: `Case "${currentCase.caseId}" regressed from PASS to FAIL`,
      });
    }

    if (durationDeltaPct > DURATION_REGRESSION_PCT) {
      regressions.push({
        caseId: currentCase.caseId,
        metric: "duration",
        message: `Case "${currentCase.caseId}" is ${durationDeltaPct.toFixed(0)}% slower (${baselineCase.totalDurationMs.toFixed(0)}ms → ${currentCase.totalDurationMs.toFixed(0)}ms)`,
      });
    }

    if (tokenDeltaPct > TOKEN_REGRESSION_PCT) {
      regressions.push({
        caseId: currentCase.caseId,
        metric: "tokens",
        message: `Case "${currentCase.caseId}" uses ${tokenDeltaPct.toFixed(0)}% more tokens (${baseTokens} → ${currTokens})`,
      });
    }
  }

  return {
    baselineId: `${baseline.suiteId}@${baseline.startedAt}`,
    currentId: `${current.suiteId}@${current.startedAt}`,
    cases: caseComparisons,
    regressions,
  };
}

/**
 * Format a comparison as human-readable markdown.
 */
export function comparisonToMarkdown(comparison: BenchmarkComparison): string {
  const lines: string[] = [];

  lines.push("# Benchmark Comparison");
  lines.push("");
  lines.push(`- **Baseline:** ${comparison.baselineId}`);
  lines.push(`- **Current:** ${comparison.currentId}`);
  lines.push("");

  if (comparison.regressions.length === 0) {
    lines.push("No regressions detected.");
  } else {
    lines.push(`## Regressions (${comparison.regressions.length})`);
    lines.push("");
    for (const reg of comparison.regressions) {
      lines.push(`- [${reg.metric.toUpperCase()}] ${reg.message}`);
    }
  }

  if (comparison.cases.length > 0) {
    lines.push("");
    lines.push("## Case Details");
    lines.push("");
    lines.push("| Case | Duration Delta | Token Delta | Status |");
    lines.push("|------|--------------|-------------|--------|");

    for (const c of comparison.cases) {
      const dSign = c.durationDeltaMs >= 0 ? "+" : "";
      const tSign = c.tokenDelta >= 0 ? "+" : "";
      const status = c.statusChanged
        ? `${c.baselineSuccess ? "PASS" : "FAIL"} -> ${c.currentSuccess ? "PASS" : "FAIL"}`
        : c.currentSuccess
          ? "PASS"
          : "FAIL";

      lines.push(
        `| ${c.caseId} | ${dSign}${c.durationDeltaPct.toFixed(0)}% | ${tSign}${c.tokenDeltaPct.toFixed(0)}% | ${status} |`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}
