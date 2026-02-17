import { describe, expect, it, vi, beforeEach } from "vitest";
import { fixFindings } from "./fixer.js";
import type { AdversarialFinding } from "./runner.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSpawnSync = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

vi.mock("../shared.js", () => ({
  readFileContent: vi.fn(() => "export function foo() { return 42; }"),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<AdversarialFinding> = {}): AdversarialFinding {
  return {
    id: "cq-1",
    title: "Test finding",
    severity: "medium",
    source: "code-quality",
    description: "A test finding",
    file: "src/foo.ts",
    ...overrides,
  };
}

const passingTestRunner = vi.fn(async () => ({ passed: true, output: "All tests pass" }));
const failingTestRunner = vi.fn(async () => ({ passed: false, output: "1 test failed" }));

// ---------------------------------------------------------------------------
// fixFindings
// ---------------------------------------------------------------------------

describe("fixFindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: claude succeeds, git add succeeds, git diff --cached has changes, git commit succeeds, git rev-parse returns SHA
    mockSpawnSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "claude") {
        return { status: 0, stdout: "Fixed the issue.", stderr: "", error: null };
      }
      if (cmd === "git" && args[0] === "add") {
        return { status: 0 };
      }
      if (cmd === "git" && args[0] === "diff") {
        return { status: 1 }; // 1 = there are staged changes
      }
      if (cmd === "git" && args[0] === "commit") {
        return { status: 0 };
      }
      if (cmd === "git" && args[0] === "rev-parse") {
        return { status: 0, stdout: "abc1234def5678" };
      }
      return { status: 0, stdout: "" };
    });
  });

  it("fixes a single finding successfully", async () => {
    const result = await fixFindings([makeFinding()], {
      projectDir: "/project",
      testSuiteRunner: passingTestRunner,
    });

    expect(result.fixed).toHaveLength(1);
    expect(result.unfixed).toHaveLength(0);
    expect(result.results[0]!.fixed).toBe(true);
    expect(result.results[0]!.commitSha).toBe("abc1234def5678");
    expect(result.results[0]!.attempts).toBe(1);
  });

  it("sorts findings by severity (critical first)", async () => {
    const findings = [
      makeFinding({ id: "low-1", severity: "low", title: "Low issue" }),
      makeFinding({ id: "crit-1", severity: "critical", title: "Critical issue" }),
      makeFinding({ id: "high-1", severity: "high", title: "High issue" }),
    ];

    const result = await fixFindings(findings, {
      projectDir: "/project",
      testSuiteRunner: passingTestRunner,
    });

    // Should be fixed in severity order
    expect(result.results[0]!.finding.severity).toBe("critical");
    expect(result.results[1]!.finding.severity).toBe("high");
    expect(result.results[2]!.finding.severity).toBe("low");
  });

  it("retries when tests fail after fix", async () => {
    let testCallCount = 0;
    const eventuallyPassing = vi.fn(async () => {
      testCallCount++;
      if (testCallCount <= 1) {
        return { passed: false, output: "test failed" };
      }
      return { passed: true, output: "all pass" };
    });

    const result = await fixFindings([makeFinding()], {
      projectDir: "/project",
      testSuiteRunner: eventuallyPassing,
    });

    expect(result.fixed).toHaveLength(1);
    expect(result.results[0]!.attempts).toBe(2);
  });

  it("marks as unfixed after max attempts", async () => {
    const result = await fixFindings([makeFinding()], {
      projectDir: "/project",
      testSuiteRunner: failingTestRunner,
      maxAttempts: 2,
    });

    expect(result.fixed).toHaveLength(0);
    expect(result.unfixed).toHaveLength(1);
    expect(result.results[0]!.fixed).toBe(false);
    expect(result.results[0]!.attempts).toBe(2);
    expect(result.results[0]!.error).toContain("Tests failed");
  });

  it("handles Claude CLI failure", async () => {
    mockSpawnSync.mockImplementation((cmd: string) => {
      if (cmd === "claude") {
        return { status: null, error: new Error("ENOENT"), stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "" };
    });

    const result = await fixFindings([makeFinding()], {
      projectDir: "/project",
      testSuiteRunner: passingTestRunner,
      maxAttempts: 1,
    });

    expect(result.unfixed).toHaveLength(1);
    expect(result.results[0]!.error).toContain("ENOENT");
  });

  it("handles empty findings list", async () => {
    const result = await fixFindings([], {
      projectDir: "/project",
      testSuiteRunner: passingTestRunner,
    });

    expect(result.fixed).toHaveLength(0);
    expect(result.unfixed).toHaveLength(0);
    expect(result.results).toHaveLength(0);
  });

  it("runs final test suite", async () => {
    const result = await fixFindings([makeFinding()], {
      projectDir: "/project",
      testSuiteRunner: passingTestRunner,
    });

    expect(result.finalTestResult.passed).toBe(true);
  });

  it("handles git commit with no changes", async () => {
    mockSpawnSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "claude") {
        return { status: 0, stdout: "No changes needed.", stderr: "" };
      }
      if (cmd === "git" && args[0] === "add") {
        return { status: 0 };
      }
      if (cmd === "git" && args[0] === "diff") {
        return { status: 0 }; // 0 = no staged changes
      }
      return { status: 0, stdout: "" };
    });

    const result = await fixFindings([makeFinding()], {
      projectDir: "/project",
      testSuiteRunner: passingTestRunner,
    });

    // Still counts as fixed since tests pass (Claude may have fixed without git changes)
    expect(result.results[0]!.fixed).toBe(true);
    expect(result.results[0]!.commitSha).toBeUndefined();
  });
});
