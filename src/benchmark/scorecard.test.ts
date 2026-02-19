import { describe, it, expect } from "vitest";
import { toJson, toMarkdown, formatDuration, formatTokens } from "./scorecard.js";
import type { BenchmarkResult } from "./types.js";

function makeSampleResult(): BenchmarkResult {
  return {
    suiteId: "smoke",
    startedAt: "2026-02-18T14:30:00.000Z",
    completedAt: "2026-02-18T14:30:05.000Z",
    gitCommit: "abc1234",
    boopVersion: "0.1.0",
    mode: "dry-run",
    cases: [
      {
        caseId: "smoke-1",
        success: true,
        lastPhaseReached: "stories",
        mode: "dry-run",
        totalDurationMs: 120,
        phases: [
          {
            phase: "viability",
            success: true,
            durationMs: 30,
            tokenUsage: { inputTokens: 100, outputTokens: 200 },
            retryCount: 0,
          },
          {
            phase: "prd",
            success: true,
            durationMs: 35,
            tokenUsage: { inputTokens: 150, outputTokens: 300 },
            retryCount: 0,
          },
          {
            phase: "architecture",
            success: true,
            durationMs: 25,
            tokenUsage: { inputTokens: 120, outputTokens: 250 },
            retryCount: 0,
          },
          {
            phase: "stories",
            success: true,
            durationMs: 30,
            tokenUsage: { inputTokens: 130, outputTokens: 280 },
            retryCount: 0,
          },
        ],
        totalTokenUsage: { inputTokens: 500, outputTokens: 1030 },
        totalRetries: 0,
        expectationResults: [
          {
            expectation: { metric: "success", expected: true },
            passed: true,
            actual: true,
          },
          {
            expectation: { metric: "viability_recommendation", expected: "PROCEED" },
            passed: true,
            actual: "PROCEED",
          },
        ],
      },
    ],
    summary: {
      totalCases: 1,
      passed: 1,
      failed: 0,
      totalDurationMs: 120,
      totalTokenUsage: { inputTokens: 500, outputTokens: 1030 },
      totalRetries: 0,
    },
  };
}

describe("scorecard", () => {
  describe("toJson", () => {
    it("returns valid JSON", () => {
      const result = makeSampleResult();
      const json = toJson(result);
      const parsed = JSON.parse(json);
      expect(parsed.suiteId).toBe("smoke");
      expect(parsed.cases).toHaveLength(1);
    });

    it("is pretty-printed with 2-space indent", () => {
      const json = toJson(makeSampleResult());
      expect(json).toContain("  ");
      expect(json.split("\n").length).toBeGreaterThan(5);
    });
  });

  describe("toMarkdown", () => {
    it("contains the suite header", () => {
      const md = toMarkdown(makeSampleResult());
      expect(md).toContain("# Benchmark Scorecard: smoke");
      expect(md).toContain("**Mode:** dry-run");
      expect(md).toContain("**Git Commit:** abc1234");
    });

    it("contains the summary table", () => {
      const md = toMarkdown(makeSampleResult());
      expect(md).toContain("## Summary");
      expect(md).toContain("| Total Cases | 1 |");
      expect(md).toContain("| Passed | 1 |");
      expect(md).toContain("| Failed | 0 |");
    });

    it("contains per-case details", () => {
      const md = toMarkdown(makeSampleResult());
      expect(md).toContain("### [PASS] smoke-1");
      expect(md).toContain("**Last Phase:** stories");
    });

    it("contains phase breakdown table", () => {
      const md = toMarkdown(makeSampleResult());
      expect(md).toContain("| viability | ok |");
      expect(md).toContain("| prd | ok |");
    });

    it("contains expectation results", () => {
      const md = toMarkdown(makeSampleResult());
      expect(md).toContain("[PASS] success");
      expect(md).toContain("[PASS] viability_recommendation");
    });

    it("shows FAIL for failed cases", () => {
      const result = makeSampleResult();
      result.cases[0]!.success = false;
      result.cases[0]!.terminalError = "Something went wrong";

      const md = toMarkdown(result);
      expect(md).toContain("### [FAIL] smoke-1");
      expect(md).toContain("**Error:** Something went wrong");
    });
  });

  describe("formatDuration", () => {
    it("formats milliseconds", () => {
      expect(formatDuration(50)).toBe("50ms");
      expect(formatDuration(999)).toBe("999ms");
    });

    it("formats seconds", () => {
      expect(formatDuration(1500)).toBe("1.5s");
      expect(formatDuration(30000)).toBe("30.0s");
    });

    it("formats minutes", () => {
      expect(formatDuration(90000)).toBe("1m30s");
      expect(formatDuration(120000)).toBe("2m0s");
    });
  });

  describe("formatTokens", () => {
    it("formats numbers with locale separators", () => {
      expect(formatTokens(0)).toBe("0");
      expect(formatTokens(1000)).toBe("1,000");
      expect(formatTokens(1500000)).toBe("1,500,000");
    });
  });
});
