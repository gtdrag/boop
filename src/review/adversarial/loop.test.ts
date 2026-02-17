import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { runAdversarialLoop } from "./loop.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./runner.js", () => ({
  runAdversarialAgents: vi.fn(),
}));

vi.mock("./verifier.js", () => ({
  verifyFindings: vi.fn(),
}));

vi.mock("./fixer.js", () => ({
  fixFindings: vi.fn(),
}));

const { runAdversarialAgents } = await import("./runner.js");
const { verifyFindings } = await import("./verifier.js");
const { fixFindings } = await import("./fixer.js");

const mockRunAgents = vi.mocked(runAdversarialAgents);
const mockVerify = vi.mocked(verifyFindings);
const mockFix = vi.mocked(fixFindings);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-test-"));
  fs.mkdirSync(path.join(tmpDir, ".boop", "reviews", "epic-1"), { recursive: true });
});

const passingTestRunner = vi.fn(async () => ({ passed: true, output: "All tests pass" }));

function makeFinding(id: string, severity = "medium") {
  return {
    id,
    title: `Finding ${id}`,
    severity: severity as "medium" | "high" | "critical" | "low",
    source: "code-quality" as const,
    description: `Description for ${id}`,
    file: "src/foo.ts",
  };
}

// ---------------------------------------------------------------------------
// runAdversarialLoop
// ---------------------------------------------------------------------------

describe("runAdversarialLoop", () => {
  it("converges when no findings on first iteration", async () => {
    mockRunAgents.mockResolvedValue([
      { agent: "code-quality", findings: [], report: "Clean", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValue({
      verified: [],
      discarded: [],
      stats: { total: 0, verified: 0, discarded: 0 },
    });

    const result = await runAdversarialLoop({
      projectDir: tmpDir,
      epicNumber: 1,
      testSuiteRunner: passingTestRunner,
    });

    expect(result.converged).toBe(true);
    expect(result.exitReason).toBe("converged");
    expect(result.iterations).toHaveLength(1);
    expect(result.totalFindings).toBe(0);
    expect(result.deferredFindings).toEqual([]);
  });

  it("fixes findings and re-reviews", async () => {
    const finding = makeFinding("cq-1", "high");

    // Iteration 1: finds issues
    mockRunAgents.mockResolvedValueOnce([
      { agent: "code-quality", findings: [finding], report: "Found 1", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValueOnce({
      verified: [finding],
      discarded: [],
      stats: { total: 1, verified: 1, discarded: 0 },
    });

    mockFix.mockResolvedValueOnce({
      results: [{ finding, fixed: true, commitSha: "abc123", attempts: 1 }],
      fixed: [finding],
      unfixed: [],
      finalTestResult: { passed: true, output: "All pass" },
    });

    // Iteration 2: clean
    mockRunAgents.mockResolvedValueOnce([
      { agent: "code-quality", findings: [], report: "Clean", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValueOnce({
      verified: [],
      discarded: [],
      stats: { total: 0, verified: 0, discarded: 0 },
    });

    const result = await runAdversarialLoop({
      projectDir: tmpDir,
      epicNumber: 1,
      testSuiteRunner: passingTestRunner,
    });

    expect(result.converged).toBe(true);
    expect(result.iterations).toHaveLength(2);
    expect(result.totalFixed).toBe(1);
    expect(result.totalFindings).toBe(1);
  });

  it("exits on max iterations", async () => {
    const finding = makeFinding("cq-1", "high");

    // Every iteration finds the same thing and can't fix it
    mockRunAgents.mockResolvedValue([
      { agent: "code-quality", findings: [finding], report: "Found 1", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValue({
      verified: [finding],
      discarded: [],
      stats: { total: 1, verified: 1, discarded: 0 },
    });

    mockFix.mockResolvedValue({
      results: [{ finding, fixed: false, error: "Cannot fix", attempts: 3 }],
      fixed: [],
      unfixed: [finding],
      finalTestResult: { passed: true, output: "All pass" },
    });

    const result = await runAdversarialLoop({
      projectDir: tmpDir,
      epicNumber: 1,
      maxIterations: 2,
      testSuiteRunner: passingTestRunner,
    });

    // Should exit as stuck since same finding across iterations
    expect(result.converged).toBe(false);
    expect(result.exitReason).toBe("stuck");
    expect(result.iterations).toHaveLength(2);
    expect(result.unresolvedFindings).toHaveLength(1);
  });

  it("detects stuck state (same findings across iterations)", async () => {
    const finding = makeFinding("cq-1", "high");

    mockRunAgents.mockResolvedValue([
      { agent: "code-quality", findings: [finding], report: "Found 1", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValue({
      verified: [finding],
      discarded: [],
      stats: { total: 1, verified: 1, discarded: 0 },
    });

    mockFix.mockResolvedValue({
      results: [{ finding, fixed: false, error: "Cannot fix", attempts: 3 }],
      fixed: [],
      unfixed: [finding],
      finalTestResult: { passed: true, output: "All pass" },
    });

    const result = await runAdversarialLoop({
      projectDir: tmpDir,
      epicNumber: 1,
      maxIterations: 3,
      testSuiteRunner: passingTestRunner,
    });

    expect(result.exitReason).toBe("stuck");
    expect(result.iterations).toHaveLength(2); // Exits after 2, not 3
  });

  it("exits on test failure", async () => {
    const finding = makeFinding("cq-1", "high");

    mockRunAgents.mockResolvedValue([
      { agent: "code-quality", findings: [finding], report: "Found 1", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValue({
      verified: [finding],
      discarded: [],
      stats: { total: 1, verified: 1, discarded: 0 },
    });

    mockFix.mockResolvedValue({
      results: [{ finding, fixed: false, error: "Tests broken", attempts: 3 }],
      fixed: [],
      unfixed: [finding],
      finalTestResult: { passed: false, output: "Tests broken" },
    });

    const result = await runAdversarialLoop({
      projectDir: tmpDir,
      epicNumber: 1,
      testSuiteRunner: passingTestRunner,
    });

    expect(result.exitReason).toBe("test-failure");
    expect(result.iterations).toHaveLength(1);
  });

  it("discards hallucinated findings", async () => {
    const realFinding = makeFinding("cq-1", "high");
    const fakeFinding = makeFinding("cq-2", "high");

    mockRunAgents.mockResolvedValueOnce([
      {
        agent: "code-quality",
        findings: [realFinding, fakeFinding],
        report: "Found 2",
        success: true,
      },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValueOnce({
      verified: [realFinding],
      discarded: [{ finding: fakeFinding, reason: "File does not exist" }],
      stats: { total: 2, verified: 1, discarded: 1 },
    });

    mockFix.mockResolvedValueOnce({
      results: [{ finding: realFinding, fixed: true, commitSha: "abc", attempts: 1 }],
      fixed: [realFinding],
      unfixed: [],
      finalTestResult: { passed: true, output: "All pass" },
    });

    // Iteration 2: clean
    mockRunAgents.mockResolvedValueOnce([
      { agent: "code-quality", findings: [], report: "Clean", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValueOnce({
      verified: [],
      discarded: [],
      stats: { total: 0, verified: 0, discarded: 0 },
    });

    const result = await runAdversarialLoop({
      projectDir: tmpDir,
      epicNumber: 1,
      testSuiteRunner: passingTestRunner,
    });

    expect(result.totalDiscarded).toBe(1);
    expect(result.totalFixed).toBe(1);
    expect(result.converged).toBe(true);
  });

  it("saves iteration artifacts to disk", async () => {
    mockRunAgents.mockResolvedValue([
      { agent: "code-quality", findings: [], report: "Clean", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValue({
      verified: [],
      discarded: [],
      stats: { total: 0, verified: 0, discarded: 0 },
    });

    await runAdversarialLoop({
      projectDir: tmpDir,
      epicNumber: 1,
      testSuiteRunner: passingTestRunner,
    });

    const artifactPath = path.join(tmpDir, ".boop", "reviews", "epic-1", "iteration-1.json");
    expect(fs.existsSync(artifactPath)).toBe(true);

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    expect(artifact.iteration).toBe(1);
    expect(artifact.agents).toHaveLength(3);
  });

  it("defers medium/low findings instead of auto-fixing them", async () => {
    const highFinding = makeFinding("cq-1", "high");
    const lowFinding = makeFinding("tc-1", "low");
    const medFinding = makeFinding("tc-2", "medium");

    mockRunAgents.mockResolvedValueOnce([
      { agent: "code-quality", findings: [highFinding], report: "Found 1", success: true },
      {
        agent: "test-coverage",
        findings: [lowFinding, medFinding],
        report: "Found 2",
        success: true,
      },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    // Verifier passes all three through
    mockVerify.mockReturnValueOnce({
      verified: [highFinding, lowFinding, medFinding],
      discarded: [],
      stats: { total: 3, verified: 3, discarded: 0 },
    });

    // Fixer only gets the high finding (severity gate filters out low + medium)
    mockFix.mockResolvedValueOnce({
      results: [{ finding: highFinding, fixed: true, commitSha: "abc", attempts: 1 }],
      fixed: [highFinding],
      unfixed: [],
      finalTestResult: { passed: true, output: "All pass" },
    });

    // Iteration 2: clean
    mockRunAgents.mockResolvedValueOnce([
      { agent: "code-quality", findings: [], report: "Clean", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValueOnce({
      verified: [],
      discarded: [],
      stats: { total: 0, verified: 0, discarded: 0 },
    });

    const result = await runAdversarialLoop({
      projectDir: tmpDir,
      epicNumber: 1,
      testSuiteRunner: passingTestRunner,
    });

    // High finding was fixed, low + medium were deferred
    expect(result.totalFixed).toBe(1);
    expect(result.deferredFindings).toHaveLength(2);
    expect(result.deferredFindings.map((f) => f.severity)).toEqual(
      expect.arrayContaining(["low", "medium"]),
    );

    // Fixer was only called with the high finding
    expect(mockFix).toHaveBeenCalledWith(
      [highFinding],
      expect.objectContaining({ projectDir: tmpDir }),
    );
  });

  it("exits with 'diverging' when finding count increases", async () => {
    const finding1 = makeFinding("cq-1", "high");
    const finding2 = makeFinding("cq-2", "high");
    const finding3 = makeFinding("sec-1", "high");

    // Iteration 1: 1 finding
    mockRunAgents.mockResolvedValueOnce([
      { agent: "code-quality", findings: [finding1], report: "Found 1", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValueOnce({
      verified: [finding1],
      discarded: [],
      stats: { total: 1, verified: 1, discarded: 0 },
    });

    mockFix.mockResolvedValueOnce({
      results: [{ finding: finding1, fixed: true, commitSha: "abc", attempts: 1 }],
      fixed: [finding1],
      unfixed: [],
      finalTestResult: { passed: true, output: "All pass" },
    });

    // Iteration 2: MORE findings (2 > 1) → diverging
    mockRunAgents.mockResolvedValueOnce([
      { agent: "code-quality", findings: [finding2], report: "Found 1", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [finding3], report: "Found 1", success: true },
    ]);

    mockVerify.mockReturnValueOnce({
      verified: [finding2, finding3],
      discarded: [],
      stats: { total: 2, verified: 2, discarded: 0 },
    });

    const result = await runAdversarialLoop({
      projectDir: tmpDir,
      epicNumber: 1,
      testSuiteRunner: passingTestRunner,
    });

    expect(result.exitReason).toBe("diverging");
    expect(result.converged).toBe(false);
    expect(result.iterations).toHaveLength(2);
    // Fixer should NOT have been called for iteration 2
    expect(mockFix).toHaveBeenCalledTimes(1);
  });

  it("calls progress callback at each phase", async () => {
    const progress = vi.fn();

    mockRunAgents.mockResolvedValue([
      { agent: "code-quality", findings: [], report: "Clean", success: true },
      { agent: "test-coverage", findings: [], report: "Clean", success: true },
      { agent: "security", findings: [], report: "Clean", success: true },
    ]);

    mockVerify.mockReturnValue({
      verified: [],
      discarded: [],
      stats: { total: 0, verified: 0, discarded: 0 },
    });

    await runAdversarialLoop({
      projectDir: tmpDir,
      epicNumber: 1,
      testSuiteRunner: passingTestRunner,
      onProgress: progress,
    });

    expect(progress).toHaveBeenCalledWith(1, "review", expect.any(String));
    expect(progress).toHaveBeenCalledWith(1, "verify", expect.any(String));
    expect(progress).toHaveBeenCalledWith(1, "fix", expect.any(String));
    expect(progress).toHaveBeenCalledWith(1, "done", expect.any(String));
  });
});
