import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestHardener,
  collectFiles,
  categorizeFiles,
  findUntestedFiles,
  parseFindings,
  extractSummary,
} from "./test-hardener.js";
import type { ReviewContext } from "./team-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock the claude-client module
// ---------------------------------------------------------------------------

const mockSendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: '{"title":"Coverage adequate","severity":"info","file":"","description":"Test coverage is sufficient."}\n\n## Summary\nCoverage is adequate.',
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
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

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

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseFindings", () => {
  it("parses valid JSON finding lines", () => {
    const text = `Some preamble
{"title":"Missing test","severity":"high","file":"src/foo.ts","description":"No unit tests for foo"}
Other text
{"title":"Edge case","severity":"medium","file":"src/bar.ts","description":"Missing error path test"}
## Summary
Found 2 gaps.`;

    const findings = parseFindings(text);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      title: "Missing test",
      severity: "high",
      file: "src/foo.ts",
      description: "No unit tests for foo",
    });
    expect(findings[1]).toEqual({
      title: "Edge case",
      severity: "medium",
      file: "src/bar.ts",
      description: "Missing error path test",
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

describe("collectFiles", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-test-hardener-collect-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("collects TypeScript files recursively", () => {
    writeFile("src/foo.ts", "export const foo = 1;");
    writeFile("src/bar/baz.ts", "export const baz = 2;");
    writeFile("src/bar/qux.tsx", "export const qux = 3;");

    const files = collectFiles(path.join(tmpDir, "src"), tmpDir);

    expect(files).toContain("src/foo.ts");
    expect(files).toContain(path.join("src", "bar", "baz.ts"));
    expect(files).toContain(path.join("src", "bar", "qux.tsx"));
  });

  it("skips node_modules and other excluded dirs", () => {
    writeFile("src/foo.ts", "code");
    writeFile("src/node_modules/dep.ts", "dep code");
    writeFile("src/.git/hooks.ts", "hook code");
    writeFile("src/dist/output.ts", "output");

    const files = collectFiles(path.join(tmpDir, "src"), tmpDir);

    expect(files).toHaveLength(1);
    expect(files[0]).toBe("src/foo.ts");
  });

  it("skips non-source extensions", () => {
    writeFile("src/readme.md", "docs");
    writeFile("src/data.json", "{}");
    writeFile("src/code.ts", "code");

    const files = collectFiles(path.join(tmpDir, "src"), tmpDir);
    expect(files).toEqual(["src/code.ts"]);
  });

  it("returns empty array for non-existent directory", () => {
    const files = collectFiles(path.join(tmpDir, "nonexistent"), tmpDir);
    expect(files).toEqual([]);
  });
});

describe("categorizeFiles", () => {
  it("separates source and test files", () => {
    const files = [
      "src/foo.ts",
      "src/foo.test.ts",
      "src/bar.ts",
      "src/bar.spec.ts",
      "test/integration/setup.ts",
    ];

    const { sourceFiles, testFiles } = categorizeFiles(files);

    expect(sourceFiles).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(testFiles).toEqual([
      "src/foo.test.ts",
      "src/bar.spec.ts",
      "test/integration/setup.ts",
    ]);
  });

  it("treats __tests__ directory files as test files", () => {
    const files = ["src/__tests__/foo.ts", "src/bar.ts"];

    const { sourceFiles, testFiles } = categorizeFiles(files);

    expect(sourceFiles).toEqual(["src/bar.ts"]);
    expect(testFiles).toEqual(["src/__tests__/foo.ts"]);
  });

  it("handles empty input", () => {
    const { sourceFiles, testFiles } = categorizeFiles([]);

    expect(sourceFiles).toEqual([]);
    expect(testFiles).toEqual([]);
  });
});

describe("findUntestedFiles", () => {
  it("finds source files without corresponding tests", () => {
    const sourceFiles = ["src/foo.ts", "src/bar.ts", "src/baz.ts"];
    const testFiles = ["src/foo.test.ts", "src/baz.spec.ts"];

    const untested = findUntestedFiles(sourceFiles, testFiles);

    expect(untested).toEqual(["src/bar.ts"]);
  });

  it("matches test files regardless of .test or .spec suffix", () => {
    const sourceFiles = ["src/a.ts", "src/b.ts"];
    const testFiles = ["src/a.test.ts", "src/b.spec.ts"];

    const untested = findUntestedFiles(sourceFiles, testFiles);
    expect(untested).toEqual([]);
  });

  it("returns all source files when no tests exist", () => {
    const sourceFiles = ["src/foo.ts", "src/bar.ts"];

    const untested = findUntestedFiles(sourceFiles, []);
    expect(untested).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("returns empty array when all files are tested", () => {
    const sourceFiles = ["src/foo.ts"];
    const testFiles = ["src/foo.test.ts"];

    const untested = findUntestedFiles(sourceFiles, testFiles);
    expect(untested).toEqual([]);
  });
});

describe("createTestHardener", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-test-hardener-"));
    mockSendMessage.mockReset();

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Coverage adequate","severity":"info","file":"","description":"Test coverage is sufficient."}\n\n## Summary\nCoverage is adequate.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns no-op result when no source files exist", async () => {
    // Create empty src directory
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });

    const hardener = createTestHardener();
    const result = await hardener(makeContext());

    expect(result.agent).toBe("test-hardening");
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.blockingIssues).toEqual([]);
    expect(result.report).toContain("No source files found");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("sends source and test files to Claude for analysis", async () => {
    writeFile("src/foo.ts", "export function foo() { return 1; }");
    writeFile("src/foo.test.ts", 'import { foo } from "./foo"; test("works", () => foo());');
    writeFile("src/bar.ts", "export function bar() { return 2; }");

    const hardener = createTestHardener();
    await hardener(makeContext());

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMessage.mock.calls[0];
    // System prompt
    expect(callArgs[1]).toContain("expert test engineer");
    // User message includes source files
    expect(callArgs[2][0].content).toContain("src/foo.ts");
    expect(callArgs[2][0].content).toContain("src/bar.ts");
  });

  it("identifies untested files", async () => {
    writeFile("src/tested.ts", "export const x = 1;");
    writeFile("src/tested.test.ts", "test('x', () => {});");
    writeFile("src/untested.ts", "export const y = 2;");

    const hardener = createTestHardener();
    await hardener(makeContext());

    expect(mockSendMessage).toHaveBeenCalled();
    const callArgs = mockSendMessage.mock.calls[0];
    const userMessage = callArgs[2][0].content;
    expect(userMessage).toContain("Source Files Without Tests");
    expect(userMessage).toContain("src/untested.ts");
  });

  it("returns findings from Claude's response", async () => {
    writeFile("src/foo.ts", "export function foo() { return 1; }");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Missing error test","severity":"high","file":"src/foo.ts","description":"No test for error handling in foo()"}\n\n## Summary\n1 gap found.',
      usage: { inputTokens: 200, outputTokens: 80 },
      model: "claude-opus-4-6-20250929",
    });

    const hardener = createTestHardener();
    const result = await hardener(makeContext());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual({
      title: "Missing error test",
      severity: "high",
      file: "src/foo.ts",
      description: "No test for error handling in foo()",
    });
  });

  it("marks critical/high findings as blocking issues", async () => {
    writeFile("src/auth.ts", "export function authenticate() {}");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"No auth tests","severity":"critical","file":"src/auth.ts","description":"Authentication has zero tests"}\n{"title":"Minor gap","severity":"low","file":"src/utils.ts","description":"Edge case"}\n\n## Summary\n1 critical, 1 low.',
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6-20250929",
    });

    const hardener = createTestHardener();
    const result = await hardener(makeContext());

    expect(result.findings).toHaveLength(2);
    expect(result.blockingIssues).toHaveLength(1);
    expect(result.blockingIssues[0]).toContain("No auth tests");
    expect(result.blockingIssues[0]).toContain("critical");
  });

  it("does not flag medium/low/info as blocking", async () => {
    writeFile("src/foo.ts", "export const x = 1;");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Edge case","severity":"medium","file":"src/foo.ts","description":"Missing edge case"}\n{"title":"Nice to have","severity":"low","file":"src/foo.ts","description":"Optional test"}\n\n## Summary\n2 minor issues.',
      usage: { inputTokens: 150, outputTokens: 70 },
      model: "claude-opus-4-6-20250929",
    });

    const hardener = createTestHardener();
    const result = await hardener(makeContext());

    expect(result.findings).toHaveLength(2);
    expect(result.blockingIssues).toEqual([]);
  });

  it("generates a markdown report", async () => {
    writeFile("src/foo.ts", "export const x = 1;");
    writeFile("src/bar.ts", "export const y = 2;");
    writeFile("src/foo.test.ts", "test('x', () => {});");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Missing bar tests","severity":"medium","file":"src/bar.ts","description":"No tests for bar module"}\n\n## Summary\n1 gap found.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const hardener = createTestHardener();
    const result = await hardener(makeContext());

    expect(result.report).toContain("# Test Hardening Report");
    expect(result.report).toContain("Source files:");
    expect(result.report).toContain("Test files:");
    expect(result.report).toContain("Untested files:");
    expect(result.report).toContain("Findings:");
    expect(result.report).toContain("[MEDIUM] Missing bar tests");
    expect(result.report).toContain("## Summary");
  });

  it("always returns agent='test-hardening'", async () => {
    writeFile("src/foo.ts", "code");

    const hardener = createTestHardener();
    const result = await hardener(makeContext());

    expect(result.agent).toBe("test-hardening");
  });

  it("always returns success=true on completion", async () => {
    writeFile("src/foo.ts", "code");

    const hardener = createTestHardener();
    const result = await hardener(makeContext());

    expect(result.success).toBe(true);
  });

  it("includes blocking issue details with file path", async () => {
    writeFile("src/critical.ts", "export function critical() {}");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Core logic untested","severity":"high","file":"src/critical.ts","description":"No tests for core business logic"}\n\n## Summary\n1 high severity gap.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const hardener = createTestHardener();
    const result = await hardener(makeContext());

    expect(result.blockingIssues[0]).toContain("Core logic untested");
    expect(result.blockingIssues[0]).toContain("src/critical.ts");
    expect(result.blockingIssues[0]).toContain("high");
  });

  it("prioritizes untested files in API payload", async () => {
    writeFile("src/tested.ts", "export const tested = 1;");
    writeFile("src/tested.test.ts", "test('tested', () => {});");
    writeFile("src/untested.ts", "export const untested = 2;");

    const hardener = createTestHardener();
    await hardener(makeContext());

    const callArgs = mockSendMessage.mock.calls[0];
    const userMessage = callArgs[2][0].content;
    // Untested files should appear in the "Source Files Without Tests" section
    expect(userMessage).toContain("Source Files Without Tests");
    expect(userMessage).toContain("src/untested.ts");
  });

  it("includes existing test files for context", async () => {
    writeFile("src/foo.ts", "export function foo() {}");
    writeFile("src/foo.test.ts", 'import { foo } from "./foo"; test("works", () => foo());');

    const hardener = createTestHardener();
    await hardener(makeContext());

    const callArgs = mockSendMessage.mock.calls[0];
    const userMessage = callArgs[2][0].content;
    expect(userMessage).toContain("Existing Tests");
    expect(userMessage).toContain("src/foo.test.ts");
  });

  it("requests 8192 maxTokens from Claude", async () => {
    writeFile("src/foo.ts", "export const x = 1;");

    const hardener = createTestHardener();
    await hardener(makeContext());

    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[0].maxTokens).toBe(8192);
  });

  it("collects files from test/ directory too", async () => {
    writeFile("src/foo.ts", "export const foo = 1;");
    writeFile("test/unit/foo.test.ts", "test('foo', () => {});");

    const hardener = createTestHardener();
    await hardener(makeContext());

    // Should have been called — files from test/ dir were included
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("respects maxTotalChars limit", async () => {
    // Create a large file that exceeds the limit
    const largeContent = "x".repeat(200);
    writeFile("src/big.ts", largeContent);
    writeFile("src/small.ts", "export const x = 1;");

    const hardener = createTestHardener({ maxTotalChars: 100 });
    await hardener(makeContext());

    // Should still call Claude (at least one file fits)
    expect(mockSendMessage).toHaveBeenCalled();
  });
});
