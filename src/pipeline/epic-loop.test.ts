import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateEpicSummary, runEpicSignOff, runFixCycle } from "./epic-loop.js";
import type { SignOffPromptFn, FixCycleAgents } from "./epic-loop.js";
import type {
  ReviewPhaseResult,
  AgentResult,
  ReviewFinding,
  ReviewContext,
  ReviewAgentFn,
  RefactoringAgentFn,
  TestSuiteRunnerFn,
} from "../review/team-orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
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

function makeReviewResult(overrides: Partial<ReviewPhaseResult> = {}): ReviewPhaseResult {
  return {
    epicNumber: 1,
    parallelResults: [
      makeAgentResult("code-review"),
      makeAgentResult("gap-analysis"),
      makeAgentResult("tech-debt"),
    ],
    refactoringResult: makeAgentResult("refactoring"),
    testHardeningResult: makeAgentResult("test-hardening"),
    testSuiteResult: { passed: true, output: "All tests passed" },
    securityResult: makeAgentResult("security-scan"),
    qaResult: makeAgentResult("qa-smoke-test"),
    canAdvance: true,
    blockingIssues: [],
    lastCompletedPhase: "qa-smoke-test",
    ...overrides,
  };
}

function makeFixCycleAgents(): FixCycleAgents & {
  mockRefactoring: ReturnType<typeof vi.fn<RefactoringAgentFn>>;
  mockTestHardener: ReturnType<typeof vi.fn<ReviewAgentFn>>;
  mockTestSuiteRunner: ReturnType<typeof vi.fn<TestSuiteRunnerFn>>;
  mockSecurityScanner: ReturnType<typeof vi.fn<ReviewAgentFn>>;
  mockQaSmokeTester: ReturnType<typeof vi.fn<ReviewAgentFn>>;
} {
  const mockRefactoring = vi
    .fn<RefactoringAgentFn>()
    .mockResolvedValue(makeAgentResult("refactoring"));
  const mockTestHardener = vi
    .fn<ReviewAgentFn>()
    .mockResolvedValue(makeAgentResult("test-hardening"));
  const mockTestSuiteRunner = vi.fn<TestSuiteRunnerFn>().mockResolvedValue({
    passed: true,
    output: "All tests passed",
  });
  const mockSecurityScanner = vi
    .fn<ReviewAgentFn>()
    .mockResolvedValue(makeAgentResult("security-scan"));
  const mockQaSmokeTester = vi
    .fn<ReviewAgentFn>()
    .mockResolvedValue(makeAgentResult("qa-smoke-test"));

  return {
    refactoringAgent: mockRefactoring,
    testHardener: mockTestHardener,
    testSuiteRunner: mockTestSuiteRunner,
    securityScanner: mockSecurityScanner,
    qaSmokeTester: mockQaSmokeTester,
    mockRefactoring,
    mockTestHardener,
    mockTestSuiteRunner,
    mockSecurityScanner,
    mockQaSmokeTester,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateEpicSummary", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-epic-loop-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates summary with all sections", () => {
    const reviewResult = makeReviewResult();
    const summary = generateEpicSummary(tmpDir, 1, reviewResult);

    expect(summary.epicNumber).toBe(1);
    expect(summary.canAdvance).toBe(true);
    expect(summary.blockingIssues).toEqual([]);
    expect(summary.markdown).toContain("# Epic 1 Review Summary");
    expect(summary.markdown).toContain("**Can Advance:** Yes");
    expect(summary.markdown).toContain("### Code Review");
    expect(summary.markdown).toContain("### Gap Analysis");
    expect(summary.markdown).toContain("### Tech Debt");
    expect(summary.markdown).toContain("### Refactoring");
    expect(summary.markdown).toContain("### Test Hardening");
    expect(summary.markdown).toContain("### Test Suite");
    expect(summary.markdown).toContain("### Security Scan");
    expect(summary.markdown).toContain("### QA Smoke Test");
  });

  it("saves summary to .boop/reviews/epic-N/summary.md", () => {
    const reviewResult = makeReviewResult();
    const summary = generateEpicSummary(tmpDir, 2, reviewResult);

    const expectedPath = path.join(tmpDir, ".boop", "reviews", "epic-2", "summary.md");
    expect(summary.summaryPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);

    const content = fs.readFileSync(expectedPath, "utf-8");
    expect(content).toContain("# Epic 2 Review Summary");
  });

  it("includes blocking issues when present", () => {
    const reviewResult = makeReviewResult({
      canAdvance: false,
      blockingIssues: ["Test suite failed", "Critical vulnerability found"],
    });

    const summary = generateEpicSummary(tmpDir, 1, reviewResult);

    expect(summary.canAdvance).toBe(false);
    expect(summary.markdown).toContain("**Can Advance:** No");
    expect(summary.markdown).toContain("## Blocking Issues");
    expect(summary.markdown).toContain("- Test suite failed");
    expect(summary.markdown).toContain("- Critical vulnerability found");
  });

  it("includes findings severity table for agents with findings", () => {
    const reviewResult = makeReviewResult({
      parallelResults: [
        makeAgentResult("code-review", {
          findings: [
            makeFinding({ severity: "high", title: "Bug found" }),
            makeFinding({ severity: "medium", title: "Style issue" }),
            makeFinding({ severity: "high", title: "Another bug" }),
          ],
        }),
        makeAgentResult("gap-analysis"),
        makeAgentResult("tech-debt"),
      ],
    });

    const summary = generateEpicSummary(tmpDir, 1, reviewResult);

    expect(summary.markdown).toContain("| high | 2 |");
    expect(summary.markdown).toContain("| medium | 1 |");
  });

  it("shows 'Skipped' for null agent results", () => {
    const reviewResult = makeReviewResult({
      securityResult: null,
      qaResult: null,
    });

    const summary = generateEpicSummary(tmpDir, 1, reviewResult);

    expect(summary.markdown).toContain("### Security Scan\n\nSkipped.");
    expect(summary.markdown).toContain("### QA Smoke Test\n\nSkipped.");
  });

  it("shows test suite as skipped when null", () => {
    const reviewResult = makeReviewResult({
      testSuiteResult: null,
    });

    const summary = generateEpicSummary(tmpDir, 1, reviewResult);
    expect(summary.markdown).toContain("### Test Suite\n\nSkipped.");
  });

  it("shows test suite as failed when tests failed", () => {
    const reviewResult = makeReviewResult({
      testSuiteResult: { passed: false, output: "2 tests failed" },
    });

    const summary = generateEpicSummary(tmpDir, 1, reviewResult);
    expect(summary.markdown).toContain("**Status:** Failed");
  });

  it("includes overall findings count", () => {
    const reviewResult = makeReviewResult({
      parallelResults: [
        makeAgentResult("code-review", {
          findings: [makeFinding(), makeFinding()],
        }),
        makeAgentResult("gap-analysis", {
          findings: [makeFinding()],
        }),
        makeAgentResult("tech-debt"),
      ],
      refactoringResult: makeAgentResult("refactoring", {
        findings: [makeFinding()],
      }),
    });

    const summary = generateEpicSummary(tmpDir, 1, reviewResult);
    expect(summary.markdown).toContain("**Total Findings:** 4");
  });

  it("includes screenshots section when QA screenshots exist", () => {
    // Create QA screenshot files
    const qaDir = path.join(tmpDir, ".boop", "reviews", "epic-1", "qa-smoke-test");
    fs.mkdirSync(qaDir, { recursive: true });
    fs.writeFileSync(path.join(qaDir, "index.png"), "fake-png");
    fs.writeFileSync(path.join(qaDir, "about.png"), "fake-png");

    const reviewResult = makeReviewResult();
    const summary = generateEpicSummary(tmpDir, 1, reviewResult);

    expect(summary.markdown).toContain("**Screenshots:**");
    expect(summary.markdown).toContain("index.png");
    expect(summary.markdown).toContain("about.png");
  });

  it("handles missing QA directory gracefully", () => {
    const reviewResult = makeReviewResult();
    // No QA directory exists — should not throw
    const summary = generateEpicSummary(tmpDir, 1, reviewResult);
    expect(summary.markdown).not.toContain("**Screenshots:**");
  });

  it("creates review directory if it does not exist", () => {
    const reviewResult = makeReviewResult();
    const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-3");
    expect(fs.existsSync(reviewDir)).toBe(false);

    generateEpicSummary(tmpDir, 3, reviewResult);

    expect(fs.existsSync(reviewDir)).toBe(true);
  });

  it("lists agent blocking issues in section", () => {
    const reviewResult = makeReviewResult({
      securityResult: makeAgentResult("security-scan", {
        blockingIssues: ["CVE-2024-1234: critical vulnerability"],
      }),
    });

    const summary = generateEpicSummary(tmpDir, 1, reviewResult);
    expect(summary.markdown).toContain("CVE-2024-1234: critical vulnerability");
  });
});

// ---------------------------------------------------------------------------
// runFixCycle
// ---------------------------------------------------------------------------

describe("runFixCycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-fix-cycle-"));
    fs.mkdirSync(path.join(tmpDir, ".boop", "reviews", "epic-1"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs the fix cycle: refactoring → test-hardener → tests → security → QA", async () => {
    const agents = makeFixCycleAgents();
    const context: ReviewContext = {
      projectDir: tmpDir,
      epicNumber: 1,
      reviewDir: path.join(tmpDir, ".boop", "reviews", "epic-1"),
    };

    const result = await runFixCycle(context, "Fix the bug", [], agents);

    expect(agents.mockRefactoring).toHaveBeenCalledOnce();
    expect(agents.mockTestHardener).toHaveBeenCalledOnce();
    expect(agents.mockTestSuiteRunner).toHaveBeenCalledOnce();
    expect(agents.mockSecurityScanner).toHaveBeenCalledOnce();
    expect(agents.mockQaSmokeTester).toHaveBeenCalledOnce();
    expect(result.canAdvance).toBe(true);
    expect(result.lastCompletedPhase).toBe("qa-smoke-test");
  });

  it("includes user feedback as a high-severity finding for refactoring agent", async () => {
    const agents = makeFixCycleAgents();
    const context: ReviewContext = {
      projectDir: tmpDir,
      epicNumber: 1,
      reviewDir: path.join(tmpDir, ".boop", "reviews", "epic-1"),
    };

    const previousFindings = [makeFinding({ title: "Old bug" })];
    await runFixCycle(context, "Please fix the layout", previousFindings, agents);

    const callArgs = agents.mockRefactoring.mock.calls[0]!;
    const findings = callArgs[1];
    expect(findings).toContainEqual(
      expect.objectContaining({
        title: "User feedback during sign-off",
        severity: "high",
        description: "Please fix the layout",
      }),
    );
    // Also includes previous findings
    expect(findings).toContainEqual(expect.objectContaining({ title: "Old bug" }));
  });

  it("stops early if test suite fails", async () => {
    const agents = makeFixCycleAgents();
    agents.mockTestSuiteRunner.mockResolvedValue({
      passed: false,
      output: "1 test failed",
    });

    const context: ReviewContext = {
      projectDir: tmpDir,
      epicNumber: 1,
      reviewDir: path.join(tmpDir, ".boop", "reviews", "epic-1"),
    };

    const result = await runFixCycle(context, "Fix it", [], agents);

    expect(result.canAdvance).toBe(false);
    expect(result.lastCompletedPhase).toBe("test-suite");
    expect(result.blockingIssues).toContain("Test suite failed after fix cycle");
    // Security and QA should not have been called
    expect(agents.mockSecurityScanner).not.toHaveBeenCalled();
    expect(agents.mockQaSmokeTester).not.toHaveBeenCalled();
  });

  it("blocks on critical security findings", async () => {
    const agents = makeFixCycleAgents();
    agents.mockSecurityScanner.mockResolvedValue(
      makeAgentResult("security-scan", {
        findings: [makeFinding({ severity: "critical", title: "SQL injection" })],
      }),
    );

    const context: ReviewContext = {
      projectDir: tmpDir,
      epicNumber: 1,
      reviewDir: path.join(tmpDir, ".boop", "reviews", "epic-1"),
    };

    const result = await runFixCycle(context, "Fix it", [], agents);

    expect(result.canAdvance).toBe(false);
    expect(result.blockingIssues).toContain("[critical] SQL injection");
  });

  it("blocks on QA failure", async () => {
    const agents = makeFixCycleAgents();
    agents.mockQaSmokeTester.mockResolvedValue(
      makeAgentResult("qa-smoke-test", { success: false }),
    );

    const context: ReviewContext = {
      projectDir: tmpDir,
      epicNumber: 1,
      reviewDir: path.join(tmpDir, ".boop", "reviews", "epic-1"),
    };

    const result = await runFixCycle(context, "Fix it", [], agents);

    expect(result.canAdvance).toBe(false);
    expect(result.blockingIssues).toContain("QA smoke test failed during fix cycle");
  });
});

// ---------------------------------------------------------------------------
// runEpicSignOff
// ---------------------------------------------------------------------------

describe("runEpicSignOff", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-signoff-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("auto-approves in autonomous mode", async () => {
    const result = await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 1,
      reviewResult: makeReviewResult(),
      autonomous: true,
    });

    expect(result.approved).toBe(true);
    expect(result.rejectionCycles).toBe(0);
    expect(result.summary.epicNumber).toBe(1);
  });

  it("auto-approves when no signOffPrompt is provided", async () => {
    const result = await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 1,
      reviewResult: makeReviewResult(),
      autonomous: false,
    });

    expect(result.approved).toBe(true);
    expect(result.rejectionCycles).toBe(0);
  });

  it("returns approved when user approves", async () => {
    const mockPrompt = vi.fn<SignOffPromptFn>().mockResolvedValue({ action: "approve" });

    const result = await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 1,
      reviewResult: makeReviewResult(),
      signOffPrompt: mockPrompt,
    });

    expect(result.approved).toBe(true);
    expect(result.rejectionCycles).toBe(0);
    expect(mockPrompt).toHaveBeenCalledOnce();
  });

  it("runs fix cycle on rejection and re-prompts", async () => {
    const agents = makeFixCycleAgents();
    const mockPrompt = vi
      .fn<SignOffPromptFn>()
      .mockResolvedValueOnce({ action: "reject", feedback: "Fix the button" })
      .mockResolvedValueOnce({ action: "approve" });

    const result = await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 1,
      reviewResult: makeReviewResult(),
      signOffPrompt: mockPrompt,
      fixCycleAgents: agents,
    });

    expect(result.approved).toBe(true);
    expect(result.rejectionCycles).toBe(1);
    expect(mockPrompt).toHaveBeenCalledTimes(2);
    expect(agents.mockRefactoring).toHaveBeenCalledOnce();
  });

  it("stops after maxRejectionCycles", async () => {
    const agents = makeFixCycleAgents();
    const mockPrompt = vi
      .fn<SignOffPromptFn>()
      .mockResolvedValue({ action: "reject", feedback: "Still broken" });

    const result = await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 1,
      reviewResult: makeReviewResult(),
      signOffPrompt: mockPrompt,
      fixCycleAgents: agents,
      maxRejectionCycles: 2,
    });

    expect(result.approved).toBe(false);
    expect(result.rejectionCycles).toBe(2);
    expect(mockPrompt).toHaveBeenCalledTimes(2);
    expect(agents.mockRefactoring).toHaveBeenCalledTimes(2);
  });

  it("returns unapproved when rejected without fix cycle agents", async () => {
    const mockPrompt = vi
      .fn<SignOffPromptFn>()
      .mockResolvedValue({ action: "reject", feedback: "Not good" });

    const result = await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 1,
      reviewResult: makeReviewResult(),
      signOffPrompt: mockPrompt,
      // No fixCycleAgents provided
    });

    expect(result.approved).toBe(false);
    expect(result.rejectionCycles).toBe(0);
  });

  it("saves summary to disk on every cycle", async () => {
    const agents = makeFixCycleAgents();
    const mockPrompt = vi
      .fn<SignOffPromptFn>()
      .mockResolvedValueOnce({ action: "reject", feedback: "Fix it" })
      .mockResolvedValueOnce({ action: "approve" });

    await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 1,
      reviewResult: makeReviewResult(),
      signOffPrompt: mockPrompt,
      fixCycleAgents: agents,
    });

    const summaryPath = path.join(tmpDir, ".boop", "reviews", "epic-1", "summary.md");
    expect(fs.existsSync(summaryPath)).toBe(true);
    // The summary was regenerated after the fix cycle
    const content = fs.readFileSync(summaryPath, "utf-8");
    expect(content).toContain("# Epic 1 Review Summary");
  });

  it("passes previous findings to fix cycle on rejection", async () => {
    const agents = makeFixCycleAgents();
    const reviewResult = makeReviewResult({
      parallelResults: [
        makeAgentResult("code-review", {
          findings: [makeFinding({ title: "Code bug" })],
        }),
        makeAgentResult("gap-analysis"),
        makeAgentResult("tech-debt"),
      ],
      securityResult: makeAgentResult("security-scan", {
        findings: [makeFinding({ title: "Security issue" })],
      }),
    });

    const mockPrompt = vi
      .fn<SignOffPromptFn>()
      .mockResolvedValueOnce({ action: "reject", feedback: "Fix bugs" })
      .mockResolvedValueOnce({ action: "approve" });

    await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 1,
      reviewResult,
      signOffPrompt: mockPrompt,
      fixCycleAgents: agents,
    });

    // Refactoring agent should have received the previous findings + feedback
    const callArgs = agents.mockRefactoring.mock.calls[0]!;
    const findings = callArgs[1];
    expect(findings).toContainEqual(expect.objectContaining({ title: "Code bug" }));
    expect(findings).toContainEqual(expect.objectContaining({ title: "Security issue" }));
    expect(findings).toContainEqual(
      expect.objectContaining({ title: "User feedback during sign-off" }),
    );
  });

  it("generates summary with correct epic number", async () => {
    const result = await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 3,
      reviewResult: makeReviewResult({ epicNumber: 3 }),
      autonomous: true,
    });

    expect(result.summary.epicNumber).toBe(3);
    expect(result.summary.markdown).toContain("# Epic 3 Review Summary");

    const summaryPath = path.join(tmpDir, ".boop", "reviews", "epic-3", "summary.md");
    expect(fs.existsSync(summaryPath)).toBe(true);
  });

  it("summary reflects blocking issues from review result", async () => {
    const result = await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 1,
      reviewResult: makeReviewResult({
        canAdvance: false,
        blockingIssues: ["Critical vuln found"],
      }),
      autonomous: true,
    });

    expect(result.summary.canAdvance).toBe(false);
    expect(result.summary.blockingIssues).toContain("Critical vuln found");
  });

  it("uses default maxRejectionCycles of 3", async () => {
    const agents = makeFixCycleAgents();
    const mockPrompt = vi
      .fn<SignOffPromptFn>()
      .mockResolvedValue({ action: "reject", feedback: "Still broken" });

    const result = await runEpicSignOff({
      projectDir: tmpDir,
      epicNumber: 1,
      reviewResult: makeReviewResult(),
      signOffPrompt: mockPrompt,
      fixCycleAgents: agents,
      // No maxRejectionCycles — should default to 3
    });

    expect(result.rejectionCycles).toBe(3);
    expect(mockPrompt).toHaveBeenCalledTimes(3);
  });
});
