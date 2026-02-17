import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runReviewPipeline,
  ReviewPhaseError,
} from "./team-orchestrator.js";
import type {
  ReviewOrchestratorOptions,
  ReviewAgentFn,
  RefactoringAgentFn,
  TestSuiteRunnerFn,
  AgentResult,
  ReviewContext,
  ReviewFinding,
  ReviewProgressCallback,
} from "./team-orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers: create mock agent results
// ---------------------------------------------------------------------------

function makeAgentResult(
  agent: AgentResult["agent"],
  overrides: Partial<AgentResult> = {},
): AgentResult {
  return {
    agent,
    success: true,
    report: `# ${agent} Report\nNo issues found.`,
    findings: [],
    blockingIssues: [],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    title: "Test finding",
    severity: "low",
    description: "A test finding",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runReviewPipeline", () => {
  let tmpDir: string;

  // Default mock implementations
  let mockCodeReviewer: ReturnType<typeof vi.fn<ReviewAgentFn>>;
  let mockGapAnalyst: ReturnType<typeof vi.fn<ReviewAgentFn>>;
  let mockTechDebtAuditor: ReturnType<typeof vi.fn<ReviewAgentFn>>;
  let mockRefactoringAgent: ReturnType<typeof vi.fn<RefactoringAgentFn>>;
  let mockTestHardener: ReturnType<typeof vi.fn<ReviewAgentFn>>;
  let mockTestSuiteRunner: ReturnType<typeof vi.fn<TestSuiteRunnerFn>>;
  let mockSecurityScanner: ReturnType<typeof vi.fn<ReviewAgentFn>>;
  let mockQaSmokeTester: ReturnType<typeof vi.fn<ReviewAgentFn>>;

  function buildOptions(overrides: Partial<ReviewOrchestratorOptions> = {}): ReviewOrchestratorOptions {
    return {
      projectDir: tmpDir,
      epicNumber: 1,
      codeReviewer: mockCodeReviewer,
      gapAnalyst: mockGapAnalyst,
      techDebtAuditor: mockTechDebtAuditor,
      refactoringAgent: mockRefactoringAgent,
      testHardener: mockTestHardener,
      testSuiteRunner: mockTestSuiteRunner,
      securityScanner: mockSecurityScanner,
      qaSmokeTester: mockQaSmokeTester,
      ...overrides,
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-review-test-"));

    mockCodeReviewer = vi.fn<ReviewAgentFn>().mockResolvedValue(makeAgentResult("code-review"));
    mockGapAnalyst = vi.fn<ReviewAgentFn>().mockResolvedValue(makeAgentResult("gap-analysis"));
    mockTechDebtAuditor = vi.fn<ReviewAgentFn>().mockResolvedValue(makeAgentResult("tech-debt"));
    mockRefactoringAgent = vi.fn<RefactoringAgentFn>().mockResolvedValue(makeAgentResult("refactoring"));
    mockTestHardener = vi.fn<ReviewAgentFn>().mockResolvedValue(makeAgentResult("test-hardening"));
    mockTestSuiteRunner = vi.fn<TestSuiteRunnerFn>().mockResolvedValue({ passed: true, output: "All tests passed" });
    mockSecurityScanner = vi.fn<ReviewAgentFn>().mockResolvedValue(makeAgentResult("security-scan"));
    mockQaSmokeTester = vi.fn<ReviewAgentFn>().mockResolvedValue(makeAgentResult("qa-smoke-test"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("runs all agents in the correct sequence and returns canAdvance=true", async () => {
    const result = await runReviewPipeline(buildOptions());

    expect(result.canAdvance).toBe(true);
    expect(result.blockingIssues).toEqual([]);
    expect(result.parallelResults).toHaveLength(3);
    expect(result.refactoringResult).not.toBeNull();
    expect(result.testHardeningResult).not.toBeNull();
    expect(result.testSuiteResult?.passed).toBe(true);
    expect(result.securityResult).not.toBeNull();
    expect(result.qaResult).not.toBeNull();
    expect(result.lastCompletedPhase).toBe("qa-smoke-test");
  });

  it("sets the correct epicNumber on the result", async () => {
    const result = await runReviewPipeline(buildOptions({ epicNumber: 3 }));
    expect(result.epicNumber).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Parallel phase
  // -------------------------------------------------------------------------

  it("runs code-reviewer, gap-analyst, and tech-debt-auditor in parallel", async () => {
    const callOrder: string[] = [];

    mockCodeReviewer.mockImplementation(async () => {
      callOrder.push("code-review-start");
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push("code-review-end");
      return makeAgentResult("code-review");
    });
    mockGapAnalyst.mockImplementation(async () => {
      callOrder.push("gap-analysis-start");
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push("gap-analysis-end");
      return makeAgentResult("gap-analysis");
    });
    mockTechDebtAuditor.mockImplementation(async () => {
      callOrder.push("tech-debt-start");
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push("tech-debt-end");
      return makeAgentResult("tech-debt");
    });

    await runReviewPipeline(buildOptions());

    // All three should start before any finish (parallel execution)
    const startIndices = [
      callOrder.indexOf("code-review-start"),
      callOrder.indexOf("gap-analysis-start"),
      callOrder.indexOf("tech-debt-start"),
    ];
    const endIndices = [
      callOrder.indexOf("code-review-end"),
      callOrder.indexOf("gap-analysis-end"),
      callOrder.indexOf("tech-debt-end"),
    ];

    // All starts should come before all ends
    for (const start of startIndices) {
      for (const end of endIndices) {
        expect(start).toBeLessThan(end);
      }
    }
  });

  it("passes ReviewContext to parallel agents", async () => {
    await runReviewPipeline(buildOptions({ epicNumber: 5 }));

    const expectedContext: ReviewContext = {
      projectDir: tmpDir,
      epicNumber: 5,
      reviewDir: path.join(tmpDir, ".boop", "reviews", "epic-5"),
    };

    expect(mockCodeReviewer).toHaveBeenCalledWith(expectedContext);
    expect(mockGapAnalyst).toHaveBeenCalledWith(expectedContext);
    expect(mockTechDebtAuditor).toHaveBeenCalledWith(expectedContext);
  });

  // -------------------------------------------------------------------------
  // Sequential phase ordering
  // -------------------------------------------------------------------------

  it("runs refactoring after parallel phase completes", async () => {
    const callOrder: string[] = [];

    mockCodeReviewer.mockImplementation(async () => {
      callOrder.push("parallel");
      return makeAgentResult("code-review");
    });
    mockRefactoringAgent.mockImplementation(async () => {
      callOrder.push("refactoring");
      return makeAgentResult("refactoring");
    });

    await runReviewPipeline(buildOptions());

    expect(callOrder.indexOf("parallel")).toBeLessThan(callOrder.indexOf("refactoring"));
  });

  it("passes combined findings from parallel phase to refactoring agent", async () => {
    const finding1 = makeFinding({ title: "Bug in auth", severity: "high" });
    const finding2 = makeFinding({ title: "Missing check", severity: "medium" });

    mockCodeReviewer.mockResolvedValue(
      makeAgentResult("code-review", { findings: [finding1] }),
    );
    mockGapAnalyst.mockResolvedValue(
      makeAgentResult("gap-analysis", { findings: [finding2] }),
    );

    await runReviewPipeline(buildOptions());

    expect(mockRefactoringAgent).toHaveBeenCalledWith(
      expect.objectContaining({ epicNumber: 1 }),
      expect.arrayContaining([finding1, finding2]),
    );
  });

  it("runs test hardener after refactoring", async () => {
    const callOrder: string[] = [];

    mockRefactoringAgent.mockImplementation(async () => {
      callOrder.push("refactoring");
      return makeAgentResult("refactoring");
    });
    mockTestHardener.mockImplementation(async () => {
      callOrder.push("test-hardening");
      return makeAgentResult("test-hardening");
    });

    await runReviewPipeline(buildOptions());

    expect(callOrder.indexOf("refactoring")).toBeLessThan(callOrder.indexOf("test-hardening"));
  });

  it("runs test suite after test hardener", async () => {
    const callOrder: string[] = [];

    mockTestHardener.mockImplementation(async () => {
      callOrder.push("test-hardening");
      return makeAgentResult("test-hardening");
    });
    mockTestSuiteRunner.mockImplementation(async () => {
      callOrder.push("test-suite");
      return { passed: true, output: "ok" };
    });

    await runReviewPipeline(buildOptions());

    expect(callOrder.indexOf("test-hardening")).toBeLessThan(callOrder.indexOf("test-suite"));
  });

  it("runs security scanner after test suite passes", async () => {
    const callOrder: string[] = [];

    mockTestSuiteRunner.mockImplementation(async () => {
      callOrder.push("test-suite");
      return { passed: true, output: "ok" };
    });
    mockSecurityScanner.mockImplementation(async () => {
      callOrder.push("security-scan");
      return makeAgentResult("security-scan");
    });

    await runReviewPipeline(buildOptions());

    expect(callOrder.indexOf("test-suite")).toBeLessThan(callOrder.indexOf("security-scan"));
  });

  it("runs QA smoke test after security scanner", async () => {
    const callOrder: string[] = [];

    mockSecurityScanner.mockImplementation(async () => {
      callOrder.push("security-scan");
      return makeAgentResult("security-scan");
    });
    mockQaSmokeTester.mockImplementation(async () => {
      callOrder.push("qa-smoke-test");
      return makeAgentResult("qa-smoke-test");
    });

    await runReviewPipeline(buildOptions());

    expect(callOrder.indexOf("security-scan")).toBeLessThan(callOrder.indexOf("qa-smoke-test"));
  });

  // -------------------------------------------------------------------------
  // Blocking conditions
  // -------------------------------------------------------------------------

  it("blocks advancement when gap analyst reports blocking issues", async () => {
    mockGapAnalyst.mockResolvedValue(
      makeAgentResult("gap-analysis", {
        blockingIssues: ["Acceptance criterion 1.1 not met: uses mock data"],
      }),
    );

    const result = await runReviewPipeline(buildOptions());

    expect(result.canAdvance).toBe(false);
    expect(result.blockingIssues).toContain("Acceptance criterion 1.1 not met: uses mock data");
  });

  it("blocks advancement when security scanner finds critical vulnerabilities", async () => {
    mockSecurityScanner.mockResolvedValue(
      makeAgentResult("security-scan", {
        findings: [
          makeFinding({ title: "SQL Injection in query.ts", severity: "critical" }),
        ],
      }),
    );

    const result = await runReviewPipeline(buildOptions());

    expect(result.canAdvance).toBe(false);
    expect(result.blockingIssues).toContainEqual(
      expect.stringContaining("SQL Injection"),
    );
  });

  it("blocks advancement when security scanner finds high vulnerabilities", async () => {
    mockSecurityScanner.mockResolvedValue(
      makeAgentResult("security-scan", {
        findings: [
          makeFinding({ title: "XSS in template", severity: "high" }),
        ],
      }),
    );

    const result = await runReviewPipeline(buildOptions());

    expect(result.canAdvance).toBe(false);
  });

  it("does NOT block advancement for medium/low security findings", async () => {
    mockSecurityScanner.mockResolvedValue(
      makeAgentResult("security-scan", {
        findings: [
          makeFinding({ title: "Minor issue", severity: "medium" }),
          makeFinding({ title: "Info only", severity: "low" }),
        ],
      }),
    );

    const result = await runReviewPipeline(buildOptions());

    expect(result.canAdvance).toBe(true);
  });

  it("blocks advancement when QA smoke test fails", async () => {
    mockQaSmokeTester.mockResolvedValue(
      makeAgentResult("qa-smoke-test", { success: false }),
    );

    const result = await runReviewPipeline(buildOptions());

    expect(result.canAdvance).toBe(false);
    expect(result.blockingIssues).toContainEqual(
      expect.stringContaining("QA smoke test failed"),
    );
  });

  it("blocks advancement when test suite fails", async () => {
    mockTestSuiteRunner.mockResolvedValue({ passed: false, output: "3 tests failed" });

    const result = await runReviewPipeline(buildOptions());

    expect(result.canAdvance).toBe(false);
    expect(result.blockingIssues).toContainEqual(
      expect.stringContaining("Test suite failed"),
    );
  });

  it("stops pipeline after test suite failure (skips security + QA)", async () => {
    mockTestSuiteRunner.mockResolvedValue({ passed: false, output: "fail" });

    const result = await runReviewPipeline(buildOptions());

    expect(result.securityResult).toBeNull();
    expect(result.qaResult).toBeNull();
    expect(result.lastCompletedPhase).toBe("test-suite");
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it("throws ReviewPhaseError when parallel phase fails", async () => {
    mockCodeReviewer.mockRejectedValue(new Error("API timeout"));

    await expect(runReviewPipeline(buildOptions())).rejects.toThrow(ReviewPhaseError);
    await expect(runReviewPipeline(buildOptions())).rejects.toThrow("parallel");
  });

  it("throws ReviewPhaseError when refactoring fails", async () => {
    mockRefactoringAgent.mockRejectedValue(new Error("Refactor crash"));

    await expect(runReviewPipeline(buildOptions())).rejects.toThrow(ReviewPhaseError);
    await expect(runReviewPipeline(buildOptions())).rejects.toThrow("refactoring");
  });

  it("throws ReviewPhaseError when test hardener fails", async () => {
    mockTestHardener.mockRejectedValue(new Error("crash"));

    await expect(runReviewPipeline(buildOptions())).rejects.toThrow(ReviewPhaseError);
    await expect(runReviewPipeline(buildOptions())).rejects.toThrow("test-hardening");
  });

  it("throws ReviewPhaseError when test suite runner throws", async () => {
    mockTestSuiteRunner.mockRejectedValue(new Error("process killed"));

    await expect(runReviewPipeline(buildOptions())).rejects.toThrow(ReviewPhaseError);
    await expect(runReviewPipeline(buildOptions())).rejects.toThrow("test-suite");
  });

  it("throws ReviewPhaseError when security scanner fails", async () => {
    mockSecurityScanner.mockRejectedValue(new Error("semgrep not found"));

    await expect(runReviewPipeline(buildOptions())).rejects.toThrow(ReviewPhaseError);
    await expect(runReviewPipeline(buildOptions())).rejects.toThrow("security-scan");
  });

  it("throws ReviewPhaseError when QA smoke test fails", async () => {
    mockQaSmokeTester.mockRejectedValue(new Error("playwright crash"));

    await expect(runReviewPipeline(buildOptions())).rejects.toThrow(ReviewPhaseError);
    await expect(runReviewPipeline(buildOptions())).rejects.toThrow("qa-smoke-test");
  });

  // -------------------------------------------------------------------------
  // Artifact persistence
  // -------------------------------------------------------------------------

  it("creates the review directory structure", async () => {
    await runReviewPipeline(buildOptions({ epicNumber: 2 }));

    const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-2");
    expect(fs.existsSync(reviewDir)).toBe(true);
  });

  it("saves parallel agent reports to disk", async () => {
    mockCodeReviewer.mockResolvedValue(
      makeAgentResult("code-review", { report: "# Code Review\nAll good" }),
    );
    mockGapAnalyst.mockResolvedValue(
      makeAgentResult("gap-analysis", { report: "# Gap Analysis\nNo gaps" }),
    );
    mockTechDebtAuditor.mockResolvedValue(
      makeAgentResult("tech-debt", { report: "# Tech Debt\nClean" }),
    );

    await runReviewPipeline(buildOptions());

    const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-1");
    expect(fs.readFileSync(path.join(reviewDir, "code-review.md"), "utf-8")).toBe(
      "# Code Review\nAll good",
    );
    expect(fs.readFileSync(path.join(reviewDir, "gap-analysis.md"), "utf-8")).toBe(
      "# Gap Analysis\nNo gaps",
    );
    expect(fs.readFileSync(path.join(reviewDir, "tech-debt.md"), "utf-8")).toBe(
      "# Tech Debt\nClean",
    );
  });

  it("saves refactoring report to disk", async () => {
    mockRefactoringAgent.mockResolvedValue(
      makeAgentResult("refactoring", { report: "# Refactoring\nApplied 3 fixes" }),
    );

    await runReviewPipeline(buildOptions());

    const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-1");
    expect(fs.readFileSync(path.join(reviewDir, "refactoring.md"), "utf-8")).toBe(
      "# Refactoring\nApplied 3 fixes",
    );
  });

  it("saves security report to disk", async () => {
    await runReviewPipeline(buildOptions());

    const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-1");
    expect(fs.existsSync(path.join(reviewDir, "security-scan.md"))).toBe(true);
  });

  it("saves QA smoke test results to subdirectory", async () => {
    mockQaSmokeTester.mockResolvedValue(
      makeAgentResult("qa-smoke-test", { report: "# QA\nAll routes OK" }),
    );

    await runReviewPipeline(buildOptions());

    const qaDir = path.join(tmpDir, ".boop", "reviews", "epic-1", "qa-smoke-test");
    expect(fs.existsSync(qaDir)).toBe(true);
    expect(fs.readFileSync(path.join(qaDir, "results.md"), "utf-8")).toBe(
      "# QA\nAll routes OK",
    );
  });

  it("saves test hardening report to disk", async () => {
    mockTestHardener.mockResolvedValue(
      makeAgentResult("test-hardening", { report: "# Tests\nAdded 5 tests" }),
    );

    await runReviewPipeline(buildOptions());

    const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-1");
    expect(fs.readFileSync(path.join(reviewDir, "test-hardening.md"), "utf-8")).toBe(
      "# Tests\nAdded 5 tests",
    );
  });

  // -------------------------------------------------------------------------
  // Progress callback
  // -------------------------------------------------------------------------

  it("calls onProgress for each phase", async () => {
    const events: Array<{ phase: string; status: string }> = [];
    const onProgress: ReviewProgressCallback = (phase, status) => {
      events.push({ phase, status });
    };

    await runReviewPipeline(buildOptions({ onProgress }));

    expect(events).toContainEqual({ phase: "parallel", status: "starting" });
    expect(events).toContainEqual({ phase: "parallel", status: "completed" });
    expect(events).toContainEqual({ phase: "refactoring", status: "starting" });
    expect(events).toContainEqual({ phase: "refactoring", status: "completed" });
    expect(events).toContainEqual({ phase: "test-hardening", status: "starting" });
    expect(events).toContainEqual({ phase: "test-hardening", status: "completed" });
    expect(events).toContainEqual({ phase: "test-suite", status: "starting" });
    expect(events).toContainEqual({ phase: "test-suite", status: "completed" });
    expect(events).toContainEqual({ phase: "security-scan", status: "starting" });
    expect(events).toContainEqual({ phase: "security-scan", status: "completed" });
    expect(events).toContainEqual({ phase: "qa-smoke-test", status: "starting" });
    expect(events).toContainEqual({ phase: "qa-smoke-test", status: "completed" });
  });

  it("calls onProgress with 'failed' when a phase fails", async () => {
    const events: Array<{ phase: string; status: string }> = [];
    const onProgress: ReviewProgressCallback = (phase, status) => {
      events.push({ phase, status });
    };

    mockRefactoringAgent.mockRejectedValue(new Error("crash"));

    await expect(
      runReviewPipeline(buildOptions({ onProgress })),
    ).rejects.toThrow();

    expect(events).toContainEqual({ phase: "refactoring", status: "failed" });
  });

  // -------------------------------------------------------------------------
  // ReviewPhaseError
  // -------------------------------------------------------------------------

  describe("ReviewPhaseError", () => {
    it("includes phase name in message", () => {
      const err = new ReviewPhaseError("security-scan", new Error("semgrep failed"));
      expect(err.message).toContain("security-scan");
      expect(err.message).toContain("semgrep failed");
    });

    it("stores the phase and cause", () => {
      const cause = new Error("root cause");
      const err = new ReviewPhaseError("code-review", cause);
      expect(err.phase).toBe("code-review");
      expect(err.cause).toBe(cause);
    });

    it("handles non-Error causes", () => {
      const err = new ReviewPhaseError("parallel", "string error");
      expect(err.message).toContain("string error");
    });

    it("has correct name property", () => {
      const err = new ReviewPhaseError("refactoring", new Error("x"));
      expect(err.name).toBe("ReviewPhaseError");
    });
  });
});
