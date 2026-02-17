import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRefactoringAgent, parseFindings, extractSummary } from "./refactoring-agent.js";
import type { ReviewContext, ReviewFinding } from "./team-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock the claude-client module
// ---------------------------------------------------------------------------

const mockSendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: '{"title":"No fixes needed","severity":"info","file":"","description":"All findings are informational."}\n\n## Summary\nNo fixes needed.',
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

function makeFindings(items: Array<Partial<ReviewFinding>>): ReviewFinding[] {
  return items.map((item) => ({
    title: item.title ?? "Test finding",
    severity: item.severity ?? "medium",
    file: item.file,
    description: item.description ?? "Test description",
  }));
}

// ---------------------------------------------------------------------------
// Tests: parseFindings
// ---------------------------------------------------------------------------

describe("parseFindings", () => {
  it("parses valid JSON finding lines", () => {
    const text = `Some preamble
{"title":"Fix applied","severity":"medium","file":"src/foo.ts","description":"Extracted helper function"}
{"title":"Deferred","severity":"low","file":"src/bar.ts","description":"Minor naming issue deferred"}
## Summary
1 fix applied, 1 deferred.`;

    const findings = parseFindings(text);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      title: "Fix applied",
      severity: "medium",
      file: "src/foo.ts",
      description: "Extracted helper function",
    });
  });

  it("skips invalid JSON lines", () => {
    const text = `{not json}
{"title":"Valid","severity":"medium","file":"x.ts","description":"d"}`;

    const findings = parseFindings(text);
    expect(findings).toHaveLength(1);
  });

  it("skips findings with invalid severity", () => {
    const text = `{"title":"Bad","severity":"ultra","file":"x.ts","description":"d"}
{"title":"Good","severity":"info","file":"x.ts","description":"d"}`;

    const findings = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
  });

  it("returns empty array for text with no JSON", () => {
    expect(parseFindings("No JSON here")).toEqual([]);
  });

  it("handles finding without file field", () => {
    const text = '{"title":"General","severity":"info","description":"OK"}';
    const findings = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: extractSummary
// ---------------------------------------------------------------------------

describe("extractSummary", () => {
  it("extracts text starting from ## Summary", () => {
    const text = "Findings\n## Summary\nDone.";
    expect(extractSummary(text)).toBe("## Summary\nDone.");
  });

  it("returns full text when no ## Summary marker exists", () => {
    const text = "No summary";
    expect(extractSummary(text)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Tests: createRefactoringAgent
// ---------------------------------------------------------------------------

describe("createRefactoringAgent", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-refactoring-test-"));
    mockSendMessage.mockReset();

    mockSendMessage.mockResolvedValue({
      text: '{"title":"No fixes needed","severity":"info","file":"","description":"All findings are informational."}\n\n## Summary\nNo fixes needed.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns no-op result when no findings provided", async () => {
    const agent = createRefactoringAgent();
    const result = await agent(makeContext(), []);

    expect(result.agent).toBe("refactoring");
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.blockingIssues).toEqual([]);
    expect(result.report).toContain("No findings to address");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("sends findings and affected file content to Claude", async () => {
    writeSourceFile("src/foo.ts", "const x = 1;");

    const findings = makeFindings([
      {
        title: "Duplication",
        severity: "medium",
        file: "src/foo.ts",
        description: "Duplicated logic",
      },
    ]);

    const agent = createRefactoringAgent();
    await agent(makeContext(), findings);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[1]).toContain("refactoring agent");
    expect(callArgs[2][0].content).toContain("Duplication");
    expect(callArgs[2][0].content).toContain("src/foo.ts");
    expect(callArgs[2][0].content).toContain("const x = 1;");
  });

  it("groups findings by severity in the prompt", async () => {
    writeSourceFile("src/a.ts", "code");
    writeSourceFile("src/b.ts", "code");

    const findings = makeFindings([
      { title: "Critical bug", severity: "critical", file: "src/a.ts" },
      { title: "Minor issue", severity: "low", file: "src/b.ts" },
      { title: "Major issue", severity: "high", file: "src/a.ts" },
    ]);

    const agent = createRefactoringAgent();
    await agent(makeContext(), findings);

    const content = mockSendMessage.mock.calls[0][2][0].content;
    const criticalPos = content.indexOf("CRITICAL");
    const highPos = content.indexOf("HIGH");
    const lowPos = content.indexOf("LOW");
    expect(criticalPos).toBeLessThan(highPos);
    expect(highPos).toBeLessThan(lowPos);
  });

  it("returns fix suggestions from Claude's response", async () => {
    writeSourceFile("src/foo.ts", "code");

    const findings = makeFindings([{ title: "Bug", severity: "high", file: "src/foo.ts" }]);

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Fixed null check","severity":"high","file":"src/foo.ts","description":"Added null check before access"}\n\n## Summary\n1 fix applied.',
      usage: { inputTokens: 200, outputTokens: 80 },
      model: "claude-opus-4-6-20250929",
    });

    const agent = createRefactoringAgent();
    const result = await agent(makeContext(), findings);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual({
      title: "Fixed null check",
      severity: "high",
      file: "src/foo.ts",
      description: "Added null check before access",
    });
  });

  it("marks critical/high fix suggestions as blocking", async () => {
    writeSourceFile("src/foo.ts", "code");

    const findings = makeFindings([
      { title: "Critical", severity: "critical", file: "src/foo.ts" },
    ]);

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Unresolvable coupling","severity":"critical","file":"src/foo.ts","description":"Requires architectural change"}\n{"title":"Minor tweak","severity":"low","file":"src/foo.ts","description":"Renamed variable"}\n\n## Summary\n1 critical, 1 low.',
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6-20250929",
    });

    const agent = createRefactoringAgent();
    const result = await agent(makeContext(), findings);

    expect(result.findings).toHaveLength(2);
    expect(result.blockingIssues).toHaveLength(1);
    expect(result.blockingIssues[0]).toContain("Unresolvable coupling");
    expect(result.blockingIssues[0]).toContain("critical");
  });

  it("does not flag medium/low/info as blocking", async () => {
    writeSourceFile("src/foo.ts", "code");

    const findings = makeFindings([{ title: "Style", severity: "low", file: "src/foo.ts" }]);

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Improved naming","severity":"low","file":"src/foo.ts","description":"Renamed x to count"}\n\n## Summary\n1 fix.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const agent = createRefactoringAgent();
    const result = await agent(makeContext(), findings);

    expect(result.findings).toHaveLength(1);
    expect(result.blockingIssues).toEqual([]);
  });

  it("generates a markdown report with input findings and fix suggestions", async () => {
    writeSourceFile("src/foo.ts", "code");

    const findings = makeFindings([
      { title: "Duplication", severity: "medium", file: "src/foo.ts" },
    ]);

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Extracted helper","severity":"medium","file":"src/foo.ts","description":"Moved shared logic to helper"}\n\n## Summary\n1 fix applied.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const agent = createRefactoringAgent();
    const result = await agent(makeContext(), findings);

    expect(result.report).toContain("# Refactoring Report");
    expect(result.report).toContain("Input findings:");
    expect(result.report).toContain("Fix suggestions:");
    expect(result.report).toContain("[MEDIUM] Extracted helper");
    expect(result.report).toContain("## Summary");
  });

  it("always returns agent='refactoring'", async () => {
    const agent = createRefactoringAgent();
    const result = await agent(makeContext(), []);

    expect(result.agent).toBe("refactoring");
  });

  it("always returns success=true on completion", async () => {
    writeSourceFile("src/foo.ts", "code");

    const findings = makeFindings([{ title: "Issue", severity: "medium", file: "src/foo.ts" }]);

    const agent = createRefactoringAgent();
    const result = await agent(makeContext(), findings);

    expect(result.success).toBe(true);
  });

  it("only reads affected files referenced in findings", async () => {
    writeSourceFile("src/foo.ts", "foo code");
    writeSourceFile("src/bar.ts", "bar code");
    writeSourceFile("src/unrelated.ts", "unrelated code");

    const findings = makeFindings([
      { title: "Issue in foo", severity: "medium", file: "src/foo.ts" },
      { title: "Issue in bar", severity: "medium", file: "src/bar.ts" },
    ]);

    const agent = createRefactoringAgent();
    await agent(makeContext(), findings);

    const content = mockSendMessage.mock.calls[0][2][0].content;
    expect(content).toContain("src/foo.ts");
    expect(content).toContain("src/bar.ts");
    expect(content).not.toContain("src/unrelated.ts");
  });

  it("handles findings with no file gracefully", async () => {
    const findings = makeFindings([
      { title: "General issue", severity: "medium", description: "No file ref" },
    ]);

    const agent = createRefactoringAgent();
    await agent(makeContext(), findings);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const content = mockSendMessage.mock.calls[0][2][0].content;
    expect(content).toContain("General issue");
  });

  it("deduplicates affected files", async () => {
    writeSourceFile("src/foo.ts", "code");

    const findings = makeFindings([
      { title: "Issue 1", severity: "medium", file: "src/foo.ts" },
      { title: "Issue 2", severity: "low", file: "src/foo.ts" },
    ]);

    const agent = createRefactoringAgent();
    await agent(makeContext(), findings);

    const content = mockSendMessage.mock.calls[0][2][0].content;
    // File should appear once in Affected Source Files section
    const matches = content.match(/### src\/foo\.ts/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("respects maxTotalChars limit for file content", async () => {
    writeSourceFile("src/large.ts", "x".repeat(500));
    writeSourceFile("src/small.ts", "const y = 1;");

    const findings = makeFindings([
      { title: "Issue 1", severity: "medium", file: "src/large.ts" },
      { title: "Issue 2", severity: "medium", file: "src/small.ts" },
    ]);

    const agent = createRefactoringAgent({ maxTotalChars: 100 });
    await agent(makeContext(), findings);

    const content = mockSendMessage.mock.calls[0][2][0].content;
    // The small file should be included (under 100 chars)
    // but the large file should be skipped (500 chars > 100 limit)
    expect(content).toContain("src/small.ts");
    expect(content).not.toContain("### src/large.ts");
  });

  it("passes clientOptions to sendMessage", async () => {
    writeSourceFile("src/foo.ts", "code");

    const findings = makeFindings([{ title: "Issue", severity: "medium", file: "src/foo.ts" }]);

    const agent = createRefactoringAgent({
      clientOptions: { apiKey: "test-key", model: "test-model" },
    });
    await agent(makeContext(), findings);

    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[0]).toMatchObject({
      apiKey: "test-key",
      model: "test-model",
    });
  });

  it("requests 8192 maxTokens", async () => {
    writeSourceFile("src/foo.ts", "code");

    const findings = makeFindings([{ title: "Issue", severity: "medium", file: "src/foo.ts" }]);

    const agent = createRefactoringAgent();
    await agent(makeContext(), findings);

    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[0].maxTokens).toBe(8192);
  });

  it("skips non-code files in affected file reading", async () => {
    writeSourceFile("src/foo.ts", "code");
    writeSourceFile("README.md", "docs");

    const findings = makeFindings([
      { title: "Issue in code", severity: "medium", file: "src/foo.ts" },
      { title: "Issue in docs", severity: "low", file: "README.md" },
    ]);

    const agent = createRefactoringAgent();
    await agent(makeContext(), findings);

    const content = mockSendMessage.mock.calls[0][2][0].content;
    // Only .ts file should be in Affected Source Files
    expect(content).toContain("src/foo.ts");
    // README.md appears in findings section but not in source files
    const sourceFilesSection = content.split("## Affected Source Files")[1] ?? "";
    expect(sourceFilesSection).not.toContain("README.md");
  });

  it("includes blocking issue details with file path", async () => {
    writeSourceFile("src/auth.ts", "code");

    const findings = makeFindings([
      { title: "Security flaw", severity: "critical", file: "src/auth.ts" },
    ]);

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Auth bypass","severity":"critical","file":"src/auth.ts","description":"Missing auth check"}\n\n## Summary\n1 critical fix needed.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const agent = createRefactoringAgent();
    const result = await agent(makeContext(), findings);

    expect(result.blockingIssues[0]).toContain("Auth bypass");
    expect(result.blockingIssues[0]).toContain("src/auth.ts");
    expect(result.blockingIssues[0]).toContain("critical");
  });
});
