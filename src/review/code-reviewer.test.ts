import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCodeReviewer,
  getChangedFiles,
  getFileDiff,
  parseFindings,
  extractSummary,
} from "./code-reviewer.js";
import type { ReviewContext } from "./team-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock the claude-client module
// ---------------------------------------------------------------------------

const mockSendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: '{"title":"No issues found","severity":"info","file":"","description":"Code review passed."}\n\n## Summary\nNo issues found.',
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "claude-opus-4-6-20250929",
  }),
);

vi.mock("../shared/claude-client.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: (error: unknown) => {
    if (error instanceof Error && "status" in error) {
      const status = (error as Error & { status: number }).status;
      return status === 429 || status >= 500;
    }
    return false;
  },
}));

// ---------------------------------------------------------------------------
// Mock child_process.execFile for git commands
// ---------------------------------------------------------------------------

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

// Promisify wrapper returns a function that calls execFile and wraps in a promise
vi.mock("node:util", async () => {
  const actual = await vi.importActual<typeof import("node:util")>("node:util");
  return {
    ...actual,
    promisify: (fn: unknown) => {
      if (fn === mockExecFile) {
        return (...args: unknown[]) =>
          new Promise((resolve, reject) => {
            mockExecFile(...args, (err: Error | null, result: unknown) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
      }
      return actual.promisify(fn as (...args: unknown[]) => unknown);
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupGitDiffMock(files: string[], diffs: Record<string, string> = {}): void {
  mockExecFile.mockImplementation(
    (
      cmd: string,
      args: string[],
      _opts: unknown,
      callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      if (cmd === "git" && args[0] === "diff" && args[1] === "--name-only") {
        callback(null, { stdout: files.join("\n") + "\n", stderr: "" });
      } else if (cmd === "git" && args[0] === "diff" && args.length > 3) {
        // File-specific diff
        const filePath = args[args.length - 1];
        const diff = diffs[filePath] ?? `diff --git a/${filePath} b/${filePath}\n+new content`;
        callback(null, { stdout: diff, stderr: "" });
      } else if (cmd === "git" && args[0] === "ls-files") {
        callback(null, { stdout: files.join("\n") + "\n", stderr: "" });
      } else {
        callback(null, { stdout: "", stderr: "" });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseFindings", () => {
  it("parses valid JSON finding lines", () => {
    const text = `Some preamble
{"title":"Bug found","severity":"high","file":"src/foo.ts","description":"Null check missing"}
Some other text
{"title":"Style issue","severity":"low","file":"src/bar.ts","description":"Use const instead of let"}
## Summary
Found 2 issues.`;

    const findings = parseFindings(text);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      title: "Bug found",
      severity: "high",
      file: "src/foo.ts",
      description: "Null check missing",
    });
    expect(findings[1]).toEqual({
      title: "Style issue",
      severity: "low",
      file: "src/bar.ts",
      description: "Use const instead of let",
    });
  });

  it("skips invalid JSON lines", () => {
    const text = `{not valid json}
{"title":"Valid","severity":"medium","file":"x.ts","description":"desc"}`;

    const findings = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("Valid");
  });

  it("skips findings with invalid severity", () => {
    const text = `{"title":"Bad","severity":"extreme","file":"x.ts","description":"desc"}
{"title":"Good","severity":"info","file":"x.ts","description":"desc"}`;

    const findings = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
  });

  it("returns empty array for text with no JSON", () => {
    expect(parseFindings("No findings here")).toEqual([]);
  });

  it("handles finding without file field", () => {
    const text = '{"title":"General","severity":"info","description":"All good"}';
    const findings = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBeUndefined();
  });

  it("accepts all valid severities", () => {
    const severities = ["critical", "high", "medium", "low", "info"];
    for (const sev of severities) {
      const text = `{"title":"Test","severity":"${sev}","description":"d"}`;
      const findings = parseFindings(text);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe(sev);
    }
  });
});

describe("extractSummary", () => {
  it("extracts text starting from ## Summary", () => {
    const text = 'Some findings\n{"title":"x","severity":"low","description":"d"}\n## Summary\nAll good.';
    expect(extractSummary(text)).toBe("## Summary\nAll good.");
  });

  it("returns full text when no ## Summary marker exists", () => {
    const text = "No summary marker here";
    expect(extractSummary(text)).toBe(text);
  });
});

describe("getChangedFiles", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("returns files from git diff", async () => {
    setupGitDiffMock(["src/foo.ts", "src/bar.ts"]);

    const files = await getChangedFiles("/tmp/project");

    expect(files).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("filters out empty lines", async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (args[0] === "diff") {
          callback(null, { stdout: "src/foo.ts\n\nsrc/bar.ts\n\n", stderr: "" });
        }
      },
    );

    const files = await getChangedFiles("/tmp/project");
    expect(files).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("falls back to git ls-files when diff fails", async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (args[0] === "diff" && args[1] === "--name-only") {
          callback(new Error("not a git repo"), { stdout: "", stderr: "" });
        } else if (args[0] === "ls-files") {
          callback(null, { stdout: "src/index.ts\n", stderr: "" });
        }
      },
    );

    const files = await getChangedFiles("/tmp/project");
    expect(files).toEqual(["src/index.ts"]);
  });

  it("uses custom base branch", async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        // args: ["diff", "--name-only", "--diff-filter=ACMR", "develop", "HEAD"]
        if (args[0] === "diff" && args.includes("develop")) {
          callback(null, { stdout: "src/a.ts\n", stderr: "" });
        } else {
          callback(null, { stdout: "", stderr: "" });
        }
      },
    );

    const files = await getChangedFiles("/tmp/project", "develop");
    expect(files).toEqual(["src/a.ts"]);
  });
});

describe("getFileDiff", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("returns diff content for a file", async () => {
    const diffContent = "diff --git a/src/foo.ts b/src/foo.ts\n+new line";
    setupGitDiffMock([], { "src/foo.ts": diffContent });

    const diff = await getFileDiff("/tmp/project", "src/foo.ts");
    expect(diff).toBe(diffContent);
  });

  it("returns empty string when diff fails", async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(new Error("fail"), { stdout: "", stderr: "" });
      },
    );

    const diff = await getFileDiff("/tmp/project", "src/foo.ts");
    expect(diff).toBe("");
  });
});

describe("createCodeReviewer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-code-review-test-"));
    mockExecFile.mockReset();
    mockSendMessage.mockReset();

    // Default: return a clean review
    mockSendMessage.mockResolvedValue({
      text: '{"title":"No issues found","severity":"info","file":"","description":"Code review passed."}\n\n## Summary\nNo issues found.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
    const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-1");
    fs.mkdirSync(reviewDir, { recursive: true });
    return {
      projectDir: tmpDir,
      epicNumber: 1,
      reviewDir,
      ...overrides,
    };
  }

  it("returns no-op result when no files changed", async () => {
    setupGitDiffMock([]);

    const reviewer = createCodeReviewer();
    const result = await reviewer(makeContext());

    expect(result.agent).toBe("code-review");
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.blockingIssues).toEqual([]);
    expect(result.report).toContain("No files changed");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("filters files by extension", async () => {
    setupGitDiffMock(["src/foo.ts", "README.md", "src/bar.css", "src/baz.tsx"]);

    // Write files so readFileContent works
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/foo.ts"), "const x = 1;");
    fs.writeFileSync(path.join(tmpDir, "src/baz.tsx"), "export const Y = 2;");

    const reviewer = createCodeReviewer();
    await reviewer(makeContext());

    // Should call sendMessage (files were found)
    expect(mockSendMessage).toHaveBeenCalled();

    // The message should include foo.ts and baz.tsx but not README.md or bar.css
    const callArgs = mockSendMessage.mock.calls[0];
    const userMessage = callArgs[2][0].content;
    expect(userMessage).toContain("src/foo.ts");
    expect(userMessage).toContain("src/baz.tsx");
    expect(userMessage).not.toContain("README.md");
    expect(userMessage).not.toContain("bar.css");
  });

  it("sends file diffs to Claude for review", async () => {
    setupGitDiffMock(["src/foo.ts"], {
      "src/foo.ts": "diff --git a/src/foo.ts b/src/foo.ts\n+export const x = 1;",
    });
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/foo.ts"), "export const x = 1;");

    const reviewer = createCodeReviewer();
    await reviewer(makeContext());

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMessage.mock.calls[0];
    // System prompt
    expect(callArgs[1]).toContain("expert code reviewer");
    // User message includes diff
    expect(callArgs[2][0].content).toContain("src/foo.ts");
  });

  it("returns findings from Claude's response", async () => {
    setupGitDiffMock(["src/foo.ts"]);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/foo.ts"), "const x: any = 1;");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Avoid any type","severity":"medium","file":"src/foo.ts","description":"Use a specific type instead of any"}\n\n## Summary\nFound 1 issue.',
      usage: { inputTokens: 200, outputTokens: 80 },
      model: "claude-opus-4-6-20250929",
    });

    const reviewer = createCodeReviewer();
    const result = await reviewer(makeContext());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual({
      title: "Avoid any type",
      severity: "medium",
      file: "src/foo.ts",
      description: "Use a specific type instead of any",
    });
  });

  it("marks critical/high findings as blocking issues", async () => {
    setupGitDiffMock(["src/foo.ts"]);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/foo.ts"), "eval(input);");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Code injection","severity":"critical","file":"src/foo.ts","description":"eval() with user input"}\n{"title":"Minor style","severity":"low","file":"src/foo.ts","description":"Prefer const"}\n\n## Summary\n1 critical, 1 low.',
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6-20250929",
    });

    const reviewer = createCodeReviewer();
    const result = await reviewer(makeContext());

    expect(result.findings).toHaveLength(2);
    expect(result.blockingIssues).toHaveLength(1);
    expect(result.blockingIssues[0]).toContain("Code injection");
    expect(result.blockingIssues[0]).toContain("critical");
  });

  it("does not flag medium/low/info as blocking", async () => {
    setupGitDiffMock(["src/foo.ts"]);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/foo.ts"), "let x = 1;");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Use const","severity":"low","file":"src/foo.ts","description":"Prefer const"}\n{"title":"Consider extracting","severity":"medium","file":"src/foo.ts","description":"Function too long"}\n\n## Summary\n2 minor issues.',
      usage: { inputTokens: 150, outputTokens: 70 },
      model: "claude-opus-4-6-20250929",
    });

    const reviewer = createCodeReviewer();
    const result = await reviewer(makeContext());

    expect(result.findings).toHaveLength(2);
    expect(result.blockingIssues).toEqual([]);
  });

  it("generates a markdown report", async () => {
    setupGitDiffMock(["src/foo.ts"]);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/foo.ts"), "export {}");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Missing export","severity":"medium","file":"src/foo.ts","description":"Empty export"}\n\n## Summary\n1 issue found.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const reviewer = createCodeReviewer();
    const result = await reviewer(makeContext());

    expect(result.report).toContain("# Code Review Report");
    expect(result.report).toContain("Files reviewed:");
    expect(result.report).toContain("Findings:");
    expect(result.report).toContain("[MEDIUM] Missing export");
    expect(result.report).toContain("## Summary");
  });

  it("accepts custom base branch", async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (args[0] === "diff" && args[1] === "--name-only" && args.includes("develop")) {
          callback(null, { stdout: "src/foo.ts\n", stderr: "" });
        } else if (args[0] === "diff" && args.includes("develop")) {
          callback(null, { stdout: "+code", stderr: "" });
        } else {
          callback(null, { stdout: "", stderr: "" });
        }
      },
    );
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/foo.ts"), "code");

    const reviewer = createCodeReviewer({ baseBranch: "develop" });
    await reviewer(makeContext());

    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("accepts custom include extensions", async () => {
    setupGitDiffMock(["src/foo.ts", "src/bar.py"]);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/foo.ts"), "ts code");
    fs.writeFileSync(path.join(tmpDir, "src/bar.py"), "py code");

    const reviewer = createCodeReviewer({ includeExtensions: [".py"] });
    await reviewer(makeContext());

    const callArgs = mockSendMessage.mock.calls[0];
    const userMessage = callArgs[2][0].content;
    expect(userMessage).toContain("src/bar.py");
    expect(userMessage).not.toContain("src/foo.ts");
  });

  it("always returns agent='code-review'", async () => {
    setupGitDiffMock([]);

    const reviewer = createCodeReviewer();
    const result = await reviewer(makeContext());

    expect(result.agent).toBe("code-review");
  });

  it("always returns success=true on completion", async () => {
    setupGitDiffMock(["src/foo.ts"]);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/foo.ts"), "code");

    const reviewer = createCodeReviewer();
    const result = await reviewer(makeContext());

    expect(result.success).toBe(true);
  });

  it("includes blocking issue details with file path", async () => {
    setupGitDiffMock(["src/auth.ts"]);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/auth.ts"), "code");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"SQL Injection","severity":"high","file":"src/auth.ts","description":"Unsanitized input in query"}\n\n## Summary\n1 high severity issue.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const reviewer = createCodeReviewer();
    const result = await reviewer(makeContext());

    expect(result.blockingIssues[0]).toContain("SQL Injection");
    expect(result.blockingIssues[0]).toContain("src/auth.ts");
    expect(result.blockingIssues[0]).toContain("high");
  });
});
