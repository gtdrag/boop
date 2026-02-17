import { describe, expect, it, vi, beforeEach } from "vitest";

import { runAdversarialAgents, getChangedFiles, parseAdversarialFindings } from "./runner.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../shared/claude-client.js", () => ({
  sendMessage: vi.fn(),
  isRetryableApiError: () => false,
}));

vi.mock("../../shared/retry.js", () => ({
  retry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

/** Promise-based mock for the promisified execFile. */
const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: vi.fn(() => mockExecFileAsync),
}));

const mockSendMessage = vi.mocked((await import("../../shared/claude-client.js")).sendMessage);

// ---------------------------------------------------------------------------
// parseAdversarialFindings
// ---------------------------------------------------------------------------

describe("parseAdversarialFindings", () => {
  it("parses findings from response text", () => {
    const text = [
      '{"title":"Missing null check","severity":"high","file":"src/foo.ts","description":"No null check on return value"}',
      "Some commentary here",
      '{"title":"Unused import","severity":"low","file":"src/bar.ts","description":"Import is never used"}',
    ].join("\n");

    const findings = parseAdversarialFindings(text, "code-quality");

    expect(findings).toHaveLength(2);
    expect(findings[0]!.id).toBe("cod-1");
    expect(findings[0]!.source).toBe("code-quality");
    expect(findings[0]!.title).toBe("Missing null check");
    expect(findings[0]!.severity).toBe("high");
    expect(findings[1]!.id).toBe("cod-2");
  });

  it("assigns source from agent type", () => {
    const text = '{"title":"Test gap","severity":"medium","description":"No tests for error path"}';
    const findings = parseAdversarialFindings(text, "test-coverage");

    expect(findings[0]!.source).toBe("test-coverage");
    expect(findings[0]!.id).toBe("tes-1");
  });

  it("returns empty array for no findings", () => {
    const findings = parseAdversarialFindings("No issues found.", "security");
    expect(findings).toEqual([]);
  });

  it("caps findings at 5 per agent, keeping highest severity", () => {
    const lines = [
      '{"title":"Low 1","severity":"low","description":"A low issue"}',
      '{"title":"Low 2","severity":"low","description":"Another low issue"}',
      '{"title":"High 1","severity":"high","description":"A high issue"}',
      '{"title":"Critical 1","severity":"critical","description":"A critical issue"}',
      '{"title":"Low 3","severity":"low","description":"Yet another low"}',
      '{"title":"Medium 1","severity":"medium","description":"A medium issue"}',
      '{"title":"Low 4","severity":"low","description":"Low number 4"}',
    ].join("\n");

    const findings = parseAdversarialFindings(lines, "code-quality");

    expect(findings).toHaveLength(5);
    // Should be sorted by severity: critical first, then high, then medium, then low
    expect(findings[0]!.severity).toBe("critical");
    expect(findings[1]!.severity).toBe("high");
    expect(findings[2]!.severity).toBe("medium");
  });

  it("skips invalid JSON lines", () => {
    const text = [
      "{not valid json}",
      '{"title":"Real finding","severity":"medium","description":"A real issue"}',
    ].join("\n");

    const findings = parseAdversarialFindings(text, "security");
    expect(findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getChangedFiles
// ---------------------------------------------------------------------------

describe("getChangedFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns filtered TypeScript files from git diff", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: "src/foo.ts\nsrc/bar.tsx\nREADME.md\n" });

    const files = await getChangedFiles("/project");
    expect(files).toEqual(["src/foo.ts", "src/bar.tsx"]);
  });

  it("falls back to ls-files if diff fails", async () => {
    mockExecFileAsync
      .mockRejectedValueOnce(new Error("not a git repo"))
      .mockResolvedValueOnce({ stdout: "src/main.ts\nsrc/util.ts\n" });

    const files = await getChangedFiles("/project");
    expect(files).toEqual(["src/main.ts", "src/util.ts"]);
  });
});

// ---------------------------------------------------------------------------
// runAdversarialAgents
// ---------------------------------------------------------------------------

describe("runAdversarialAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs all three agents in parallel", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: "src/test.ts\n" });

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Finding","severity":"medium","description":"An issue"}\n\n## Summary\nDone.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6",
    });

    const results = await runAdversarialAgents({
      projectDir: "/project",
      epicNumber: 1,
    });

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.agent)).toEqual(["code-quality", "test-coverage", "security"]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(3);
  });

  it("handles agent failure gracefully", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: "src/test.ts\n" });

    let callCount = 0;
    mockSendMessage.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error("API timeout");
      return {
        text: '{"title":"Finding","severity":"low","description":"Minor issue"}\n\n## Summary\nOk.',
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-opus-4-6",
      };
    });

    const results = await runAdversarialAgents({
      projectDir: "/project",
      epicNumber: 1,
    });

    expect(results).toHaveLength(3);
    const failed = results.find((r) => !r.success);
    expect(failed).toBeDefined();
    expect(failed!.report).toContain("Agent failed");
    expect(failed!.findings).toEqual([]);
  });

  it("returns empty findings when no files changed", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: "\n" });

    const results = await runAdversarialAgents({
      projectDir: "/project",
      epicNumber: 1,
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.findings.length === 0)).toBe(true);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
