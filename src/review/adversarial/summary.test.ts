import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { generateAdversarialSummary, toReviewPhaseResult } from "./summary.js";
import type { AdversarialLoopResult } from "./loop.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-test-"));
  fs.mkdirSync(path.join(tmpDir, ".boop", "reviews", "epic-1"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeLoopResult(overrides: Partial<AdversarialLoopResult> = {}): AdversarialLoopResult {
  return {
    iterations: [
      {
        iteration: 1,
        agentResults: [
          { agent: "code-quality", findings: [], report: "Clean", success: true },
          { agent: "test-coverage", findings: [], report: "Clean", success: true },
          { agent: "security", findings: [], report: "Clean", success: true },
        ],
        verification: {
          verified: [],
          discarded: [],
          stats: { total: 0, verified: 0, discarded: 0 },
        },
        fixResult: null,
        testsPass: true,
        unresolvedIds: [],
      },
    ],
    converged: true,
    exitReason: "converged",
    totalFindings: 0,
    totalFixed: 0,
    totalDiscarded: 0,
    unresolvedFindings: [],
    allFixResults: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateAdversarialSummary
// ---------------------------------------------------------------------------

describe("generateAdversarialSummary", () => {
  it("generates a clean summary for converged result", () => {
    const summary = generateAdversarialSummary(tmpDir, 1, makeLoopResult());

    expect(summary.markdown).toContain("Epic 1 Adversarial Review Summary");
    expect(summary.markdown).toContain("Converged (zero findings)");
    expect(summary.markdown).toContain("All Resolved:** Yes");
    expect(summary.allResolved).toBe(true);
  });

  it("includes unresolved findings in summary", () => {
    const summary = generateAdversarialSummary(
      tmpDir,
      1,
      makeLoopResult({
        converged: false,
        exitReason: "max-iterations",
        unresolvedFindings: [
          {
            id: "cq-1",
            title: "Missing null check",
            severity: "high",
            source: "code-quality",
            description: "The function does not check for null",
            file: "src/foo.ts",
          },
        ],
        allFixResults: [
          {
            finding: {
              id: "cq-1",
              title: "Missing null check",
              severity: "high",
              source: "code-quality",
              description: "The function does not check for null",
              file: "src/foo.ts",
            },
            fixed: false,
            error: "Tests failed after fix attempt 3",
            attempts: 3,
          },
        ],
      }),
    );

    expect(summary.markdown).toContain("Unresolved Findings");
    expect(summary.markdown).toContain("[HIGH] Missing null check");
    expect(summary.markdown).toContain("Tests failed after fix attempt 3");
    expect(summary.markdown).toContain("`src/foo.ts`");
    expect(summary.allResolved).toBe(false);
  });

  it("includes auto-fixed findings with commit SHAs", () => {
    const summary = generateAdversarialSummary(
      tmpDir,
      1,
      makeLoopResult({
        totalFixed: 2,
        allFixResults: [
          {
            finding: {
              id: "cq-1",
              title: "Fix A",
              severity: "high",
              source: "code-quality",
              description: "Fixed issue A",
              file: "src/a.ts",
            },
            fixed: true,
            commitSha: "abc1234567890",
            attempts: 1,
          },
          {
            finding: {
              id: "sec-1",
              title: "Fix B",
              severity: "critical",
              source: "security",
              description: "Fixed issue B",
              file: "src/b.ts",
            },
            fixed: true,
            commitSha: "def9876543210",
            attempts: 2,
          },
        ],
      }),
    );

    expect(summary.markdown).toContain("Auto-Fixed Findings");
    expect(summary.markdown).toContain("**[HIGH]** Fix A");
    expect(summary.markdown).toContain("abc1234");
    expect(summary.markdown).toContain("**[CRITICAL]** Fix B");
    expect(summary.markdown).toContain("def9876");
  });

  it("includes per-iteration breakdown", () => {
    const summary = generateAdversarialSummary(
      tmpDir,
      1,
      makeLoopResult({
        iterations: [
          {
            iteration: 1,
            agentResults: [
              {
                agent: "code-quality",
                findings: [
                  {
                    id: "cq-1",
                    title: "A",
                    severity: "high",
                    source: "code-quality",
                    description: "X",
                  },
                ],
                report: "Found",
                success: true,
              },
              { agent: "test-coverage", findings: [], report: "Clean", success: true },
              { agent: "security", findings: [], report: "Clean", success: false },
            ],
            verification: {
              verified: [],
              discarded: [],
              stats: { total: 1, verified: 1, discarded: 0 },
            },
            fixResult: null,
            testsPass: true,
            unresolvedIds: [],
          },
        ],
      }),
    );

    expect(summary.markdown).toContain("Iteration 1");
    expect(summary.markdown).toContain("code-quality");
    expect(summary.markdown).toContain("test-coverage");
    expect(summary.markdown).toContain("security");
  });

  it("saves summary to disk", () => {
    const summary = generateAdversarialSummary(tmpDir, 1, makeLoopResult());

    expect(fs.existsSync(summary.savedPath)).toBe(true);
    const content = fs.readFileSync(summary.savedPath, "utf-8");
    expect(content).toBe(summary.markdown);
  });

  it("includes overview statistics table", () => {
    const summary = generateAdversarialSummary(
      tmpDir,
      1,
      makeLoopResult({
        totalFindings: 10,
        totalFixed: 7,
        totalDiscarded: 2,
        unresolvedFindings: [
          { id: "cq-1", title: "X", severity: "low", source: "code-quality", description: "Y" },
        ],
      }),
    );

    expect(summary.markdown).toContain("Total findings (all iterations) | 10");
    expect(summary.markdown).toContain("Auto-fixed | 7");
    expect(summary.markdown).toContain("Discarded (hallucinations) | 2");
    expect(summary.markdown).toContain("Unresolved | 1");
  });
});

// ---------------------------------------------------------------------------
// toReviewPhaseResult
// ---------------------------------------------------------------------------

describe("toReviewPhaseResult", () => {
  it("converts converged result to ReviewPhaseResult with canAdvance=true", () => {
    const result = toReviewPhaseResult(1, makeLoopResult());

    expect(result.epicNumber).toBe(1);
    expect(result.canAdvance).toBe(true);
    expect(result.blockingIssues).toHaveLength(0);
  });

  it("converts unresolved critical/high to blocking issues", () => {
    const result = toReviewPhaseResult(
      1,
      makeLoopResult({
        converged: false,
        unresolvedFindings: [
          {
            id: "cq-1",
            title: "Critical bug",
            severity: "critical",
            source: "code-quality",
            description: "Bad",
          },
          {
            id: "tc-1",
            title: "Low issue",
            severity: "low",
            source: "test-coverage",
            description: "Minor",
          },
        ],
      }),
    );

    expect(result.canAdvance).toBe(false);
    expect(result.blockingIssues).toHaveLength(1);
    expect(result.blockingIssues[0]).toContain("Critical bug");
  });

  it("adds test failure as blocking issue", () => {
    const result = toReviewPhaseResult(
      1,
      makeLoopResult({
        converged: false,
        iterations: [
          {
            iteration: 1,
            agentResults: [],
            verification: {
              verified: [],
              discarded: [],
              stats: { total: 0, verified: 0, discarded: 0 },
            },
            fixResult: null,
            testsPass: false,
            unresolvedIds: [],
          },
        ],
      }),
    );

    expect(result.canAdvance).toBe(false);
    expect(result.blockingIssues).toContain("Test suite failing after adversarial review fixes");
  });

  it("includes test suite result from last iteration", () => {
    const result = toReviewPhaseResult(1, makeLoopResult());

    expect(result.testSuiteResult).toBeDefined();
    expect(result.testSuiteResult!.passed).toBe(true);
  });
});
