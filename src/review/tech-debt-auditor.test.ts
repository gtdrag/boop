import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTechDebtAuditor,
  collectSourceFiles,
  parseFindings,
  extractSummary,
} from "./tech-debt-auditor.js";
import type { ReviewContext } from "./team-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock the claude-client module
// ---------------------------------------------------------------------------

const mockSendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: '{"title":"No tech debt found","severity":"info","file":"","description":"Codebase is clean."}\n\n## Summary\nNo tech debt found.',
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

function writeSourceFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// ---------------------------------------------------------------------------
// Tests: parseFindings
// ---------------------------------------------------------------------------

describe("parseFindings", () => {
  it("parses valid JSON finding lines", () => {
    const text = `Some preamble
{"title":"Duplication found","severity":"medium","file":"src/foo.ts","description":"Similar logic in two files"}
{"title":"Unused export","severity":"low","file":"src/bar.ts","description":"Export never imported"}
## Summary
Found 2 issues.`;

    const findings = parseFindings(text);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      title: "Duplication found",
      severity: "medium",
      file: "src/foo.ts",
      description: "Similar logic in two files",
    });
    expect(findings[1]).toEqual({
      title: "Unused export",
      severity: "low",
      file: "src/bar.ts",
      description: "Export never imported",
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

// ---------------------------------------------------------------------------
// Tests: extractSummary
// ---------------------------------------------------------------------------

describe("extractSummary", () => {
  it("extracts text starting from ## Summary", () => {
    const text =
      'Some findings\n{"title":"x","severity":"low","description":"d"}\n## Summary\nAll good.';
    expect(extractSummary(text)).toBe("## Summary\nAll good.");
  });

  it("returns full text when no ## Summary marker exists", () => {
    const text = "No summary marker here";
    expect(extractSummary(text)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Tests: collectSourceFiles
// ---------------------------------------------------------------------------

describe("collectSourceFiles", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-tech-debt-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("collects .ts files from src directory", () => {
    writeSourceFile("src/foo.ts", "const x = 1;");
    writeSourceFile("src/bar.tsx", "export default () => null;");
    writeSourceFile("src/sub/baz.ts", "export const y = 2;");

    const files = collectSourceFiles(path.join(tmpDir, "src"), tmpDir);

    expect(files).toContain("src/foo.ts");
    expect(files).toContain("src/bar.tsx");
    expect(files).toContain("src/sub/baz.ts");
  });

  it("skips node_modules and .git directories", () => {
    writeSourceFile("src/foo.ts", "code");
    writeSourceFile("src/node_modules/pkg/index.ts", "code");
    writeSourceFile("src/.git/hooks/pre-commit.ts", "code");

    const files = collectSourceFiles(path.join(tmpDir, "src"), tmpDir);

    expect(files).toEqual(["src/foo.ts"]);
  });

  it("skips non-code extensions", () => {
    writeSourceFile("src/foo.ts", "code");
    writeSourceFile("src/readme.md", "docs");
    writeSourceFile("src/styles.css", "styles");

    const files = collectSourceFiles(path.join(tmpDir, "src"), tmpDir);

    expect(files).toEqual(["src/foo.ts"]);
  });

  it("returns empty array for non-existent directory", () => {
    const files = collectSourceFiles(path.join(tmpDir, "nonexistent"), tmpDir);
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: createTechDebtAuditor
// ---------------------------------------------------------------------------

describe("createTechDebtAuditor", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-tech-debt-test-"));
    mockSendMessage.mockReset();

    mockSendMessage.mockResolvedValue({
      text: '{"title":"No tech debt found","severity":"info","file":"","description":"Codebase is clean."}\n\n## Summary\nNo tech debt found.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns no-op result when no source files exist", async () => {
    // No src directory
    const auditor = createTechDebtAuditor();
    const result = await auditor(makeContext());

    expect(result.agent).toBe("tech-debt");
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.blockingIssues).toEqual([]);
    expect(result.report).toContain("No source files found");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("sends source files to Claude for analysis", async () => {
    writeSourceFile("src/foo.ts", "const x = 1;");
    writeSourceFile("src/bar.ts", "const y = 2;");

    const auditor = createTechDebtAuditor();
    await auditor(makeContext());

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[1]).toContain("tech debt auditor");
    expect(callArgs[2][0].content).toContain("src/foo.ts");
    expect(callArgs[2][0].content).toContain("src/bar.ts");
  });

  it("returns findings from Claude's response", async () => {
    writeSourceFile("src/foo.ts", "const x = 1;\nconst x2 = 1;");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Code duplication","severity":"medium","file":"src/foo.ts","description":"Duplicated constant"}\n\n## Summary\n1 issue found.',
      usage: { inputTokens: 200, outputTokens: 80 },
      model: "claude-opus-4-6-20250929",
    });

    const auditor = createTechDebtAuditor();
    const result = await auditor(makeContext());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual({
      title: "Code duplication",
      severity: "medium",
      file: "src/foo.ts",
      description: "Duplicated constant",
    });
  });

  it("marks critical/high findings as blocking issues", async () => {
    writeSourceFile("src/foo.ts", "code");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Circular dependency","severity":"high","file":"src/foo.ts","description":"A imports B imports A"}\n{"title":"Minor naming","severity":"low","file":"src/foo.ts","description":"Use camelCase"}\n\n## Summary\n1 high, 1 low.',
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6-20250929",
    });

    const auditor = createTechDebtAuditor();
    const result = await auditor(makeContext());

    expect(result.findings).toHaveLength(2);
    expect(result.blockingIssues).toHaveLength(1);
    expect(result.blockingIssues[0]).toContain("Circular dependency");
    expect(result.blockingIssues[0]).toContain("high");
  });

  it("does not flag medium/low/info as blocking", async () => {
    writeSourceFile("src/foo.ts", "code");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Naming issue","severity":"medium","file":"src/foo.ts","description":"Inconsistent naming"}\n{"title":"Observation","severity":"info","file":"src/foo.ts","description":"Could be better"}\n\n## Summary\n2 minor issues.',
      usage: { inputTokens: 150, outputTokens: 70 },
      model: "claude-opus-4-6-20250929",
    });

    const auditor = createTechDebtAuditor();
    const result = await auditor(makeContext());

    expect(result.findings).toHaveLength(2);
    expect(result.blockingIssues).toEqual([]);
  });

  it("generates a markdown report", async () => {
    writeSourceFile("src/foo.ts", "code");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Extraction opportunity","severity":"medium","file":"src/foo.ts","description":"Extract helper function"}\n\n## Summary\n1 issue found.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const auditor = createTechDebtAuditor();
    const result = await auditor(makeContext());

    expect(result.report).toContain("# Tech Debt Audit Report");
    expect(result.report).toContain("Files analyzed:");
    expect(result.report).toContain("Findings:");
    expect(result.report).toContain("[MEDIUM] Extraction opportunity");
    expect(result.report).toContain("## Summary");
  });

  it("always returns agent='tech-debt'", async () => {
    const auditor = createTechDebtAuditor();
    const result = await auditor(makeContext());

    expect(result.agent).toBe("tech-debt");
  });

  it("always returns success=true on completion", async () => {
    writeSourceFile("src/foo.ts", "code");

    const auditor = createTechDebtAuditor();
    const result = await auditor(makeContext());

    expect(result.success).toBe(true);
  });

  it("respects maxFilesForApi limit", async () => {
    writeSourceFile("src/a.ts", "a");
    writeSourceFile("src/b.ts", "b");
    writeSourceFile("src/c.ts", "c");

    const auditor = createTechDebtAuditor({ maxFilesForApi: 2 });
    await auditor(makeContext());

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const content = mockSendMessage.mock.calls[0][2][0].content;
    // Should have at most 2 file sections
    const fileHeaders = content.match(/### src\//g) ?? [];
    expect(fileHeaders.length).toBeLessThanOrEqual(2);
  });

  it("respects maxTotalChars limit", async () => {
    // Create a large file that exceeds the limit
    const largeContent = "x".repeat(500);
    writeSourceFile("src/large.ts", largeContent);
    writeSourceFile("src/small.ts", "const x = 1;");

    const auditor = createTechDebtAuditor({ maxTotalChars: 100 });
    await auditor(makeContext());

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const content = mockSendMessage.mock.calls[0][2][0].content;
    // The small file should be included but the large one skipped
    expect(content).toContain("src/small.ts");
    expect(content).not.toContain("src/large.ts");
  });

  it("passes clientOptions to sendMessage", async () => {
    writeSourceFile("src/foo.ts", "code");

    const auditor = createTechDebtAuditor({
      clientOptions: { apiKey: "test-key", model: "test-model" },
    });
    await auditor(makeContext());

    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[0]).toMatchObject({
      apiKey: "test-key",
      model: "test-model",
    });
  });

  it("requests 8192 maxTokens", async () => {
    writeSourceFile("src/foo.ts", "code");

    const auditor = createTechDebtAuditor();
    await auditor(makeContext());

    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[0].maxTokens).toBe(8192);
  });

  it("includes blocking issue details with file path", async () => {
    writeSourceFile("src/core.ts", "code");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Tight coupling","severity":"critical","file":"src/core.ts","description":"God object pattern"}\n\n## Summary\n1 critical issue.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const auditor = createTechDebtAuditor();
    const result = await auditor(makeContext());

    expect(result.blockingIssues[0]).toContain("Tight coupling");
    expect(result.blockingIssues[0]).toContain("src/core.ts");
    expect(result.blockingIssues[0]).toContain("critical");
  });
});
