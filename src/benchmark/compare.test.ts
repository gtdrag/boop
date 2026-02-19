import { describe, it, expect } from "vitest";
import { compareRuns, comparisonToMarkdown } from "./compare.js";
import type { BenchmarkResult } from "./types.js";

function makeResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    suiteId: "smoke",
    startedAt: "2026-02-18T14:00:00.000Z",
    completedAt: "2026-02-18T14:00:05.000Z",
    gitCommit: "abc1234",
    boopVersion: "0.1.0",
    mode: "dry-run",
    cases: [
      {
        caseId: "case-1",
        success: true,
        lastPhaseReached: "stories",
        mode: "dry-run",
        totalDurationMs: 1000,
        phases: [],
        totalTokenUsage: { inputTokens: 500, outputTokens: 500 },
        totalRetries: 0,
        expectationResults: [],
      },
    ],
    summary: {
      totalCases: 1,
      passed: 1,
      failed: 0,
      totalDurationMs: 1000,
      totalTokenUsage: { inputTokens: 500, outputTokens: 500 },
      totalRetries: 0,
    },
    ...overrides,
  };
}

describe("compareRuns", () => {
  it("detects no regressions when runs are identical", () => {
    const baseline = makeResult();
    const current = makeResult({ startedAt: "2026-02-18T15:00:00.000Z" });

    const comparison = compareRuns(baseline, current);

    expect(comparison.regressions).toHaveLength(0);
    expect(comparison.cases).toHaveLength(1);
    expect(comparison.cases[0]!.durationDeltaMs).toBe(0);
    expect(comparison.cases[0]!.tokenDelta).toBe(0);
    expect(comparison.cases[0]!.statusChanged).toBe(false);
  });

  it("detects status regression (pass → fail)", () => {
    const baseline = makeResult();
    const current = makeResult({ startedAt: "2026-02-18T15:00:00.000Z" });
    current.cases[0]!.success = false;

    const comparison = compareRuns(baseline, current);

    expect(comparison.regressions).toHaveLength(1);
    expect(comparison.regressions[0]!.metric).toBe("status");
    expect(comparison.regressions[0]!.message).toContain("PASS to FAIL");
  });

  it("does not flag status improvement (fail → pass)", () => {
    const baseline = makeResult();
    baseline.cases[0]!.success = false;
    const current = makeResult({ startedAt: "2026-02-18T15:00:00.000Z" });

    const comparison = compareRuns(baseline, current);

    const statusRegressions = comparison.regressions.filter((r) => r.metric === "status");
    expect(statusRegressions).toHaveLength(0);
  });

  it("detects duration regression (>50% slower)", () => {
    const baseline = makeResult();
    const current = makeResult({ startedAt: "2026-02-18T15:00:00.000Z" });
    current.cases[0]!.totalDurationMs = 2000; // 100% slower

    const comparison = compareRuns(baseline, current);

    const durationRegressions = comparison.regressions.filter((r) => r.metric === "duration");
    expect(durationRegressions).toHaveLength(1);
    expect(durationRegressions[0]!.message).toContain("100%");
  });

  it("does not flag small duration increases (<50%)", () => {
    const baseline = makeResult();
    const current = makeResult({ startedAt: "2026-02-18T15:00:00.000Z" });
    current.cases[0]!.totalDurationMs = 1400; // 40% slower

    const comparison = compareRuns(baseline, current);

    const durationRegressions = comparison.regressions.filter((r) => r.metric === "duration");
    expect(durationRegressions).toHaveLength(0);
  });

  it("detects token regression (>30% more)", () => {
    const baseline = makeResult();
    const current = makeResult({ startedAt: "2026-02-18T15:00:00.000Z" });
    current.cases[0]!.totalTokenUsage = { inputTokens: 800, outputTokens: 800 }; // 60% more

    const comparison = compareRuns(baseline, current);

    const tokenRegressions = comparison.regressions.filter((r) => r.metric === "tokens");
    expect(tokenRegressions).toHaveLength(1);
    expect(tokenRegressions[0]!.message).toContain("60%");
  });

  it("skips cases not present in both runs", () => {
    const baseline = makeResult();
    const current = makeResult({ startedAt: "2026-02-18T15:00:00.000Z" });
    current.cases[0]!.caseId = "different-case";

    const comparison = compareRuns(baseline, current);

    expect(comparison.cases).toHaveLength(0);
    expect(comparison.regressions).toHaveLength(0);
  });

  it("handles multiple regressions in one case", () => {
    const baseline = makeResult();
    const current = makeResult({ startedAt: "2026-02-18T15:00:00.000Z" });
    current.cases[0]!.success = false;
    current.cases[0]!.totalDurationMs = 5000;
    current.cases[0]!.totalTokenUsage = { inputTokens: 2000, outputTokens: 2000 };

    const comparison = compareRuns(baseline, current);

    expect(comparison.regressions.length).toBeGreaterThanOrEqual(3);
  });
});

describe("comparisonToMarkdown", () => {
  it("formats comparison with no regressions", () => {
    const baseline = makeResult();
    const current = makeResult({ startedAt: "2026-02-18T15:00:00.000Z" });
    const comparison = compareRuns(baseline, current);

    const md = comparisonToMarkdown(comparison);

    expect(md).toContain("# Benchmark Comparison");
    expect(md).toContain("No regressions detected.");
    expect(md).toContain("## Case Details");
  });

  it("formats comparison with regressions", () => {
    const baseline = makeResult();
    const current = makeResult({ startedAt: "2026-02-18T15:00:00.000Z" });
    current.cases[0]!.success = false;

    const comparison = compareRuns(baseline, current);
    const md = comparisonToMarkdown(comparison);

    expect(md).toContain("## Regressions");
    expect(md).toContain("[STATUS]");
    expect(md).toContain("PASS -> FAIL");
  });
});
