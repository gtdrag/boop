import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGapAnalyst,
  readPrdStories,
  collectSourceFiles,
  scanFileForPlaceholders,
  parseCriterionResults,
} from "./gap-analyst.js";
import type { ReviewContext } from "./team-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock the claude-client module
// ---------------------------------------------------------------------------

const mockSendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: '{"storyId":"1.1","criterion":"Given X, when Y, then Z","status":"verified","evidence":"Code handles this in src/foo.ts"}\n\n## Summary\nAll criteria verified.',
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

function writePrd(
  projectDir: string,
  stories: Array<{
    id: string;
    title: string;
    acceptanceCriteria: string[];
    passes?: boolean;
  }>,
): void {
  const prdDir = path.join(projectDir, ".boop");
  fs.mkdirSync(prdDir, { recursive: true });
  fs.writeFileSync(
    path.join(prdDir, "prd.json"),
    JSON.stringify({ userStories: stories }),
  );
}

function writeSourceFile(projectDir: string, relPath: string, content: string): void {
  const fullPath = path.join(projectDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readPrdStories", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-gap-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads stories from .boop/prd.json", () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story One", acceptanceCriteria: ["AC-1", "AC-2"] },
    ]);

    const stories = readPrdStories(tmpDir);

    expect(stories).toHaveLength(1);
    expect(stories[0].id).toBe("1.1");
    expect(stories[0].acceptanceCriteria).toEqual(["AC-1", "AC-2"]);
  });

  it("returns empty array when PRD file does not exist", () => {
    const stories = readPrdStories(tmpDir);
    expect(stories).toEqual([]);
  });

  it("returns empty array when PRD has invalid JSON", () => {
    const prdDir = path.join(tmpDir, ".boop");
    fs.mkdirSync(prdDir, { recursive: true });
    fs.writeFileSync(path.join(prdDir, "prd.json"), "not json");

    const stories = readPrdStories(tmpDir);
    expect(stories).toEqual([]);
  });

  it("returns empty array when userStories is missing", () => {
    const prdDir = path.join(tmpDir, ".boop");
    fs.mkdirSync(prdDir, { recursive: true });
    fs.writeFileSync(path.join(prdDir, "prd.json"), "{}");

    const stories = readPrdStories(tmpDir);
    expect(stories).toEqual([]);
  });
});

describe("collectSourceFiles", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-gap-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("collects .ts files from src directory", () => {
    writeSourceFile(tmpDir, "src/foo.ts", "export const x = 1;");
    writeSourceFile(tmpDir, "src/bar.ts", "export const y = 2;");

    const files = collectSourceFiles(path.join(tmpDir, "src"), tmpDir);

    expect(files).toContain("src/foo.ts");
    expect(files).toContain("src/bar.ts");
    expect(files).toHaveLength(2);
  });

  it("collects files from subdirectories", () => {
    writeSourceFile(tmpDir, "src/shared/utils.ts", "export {}");
    writeSourceFile(tmpDir, "src/review/agent.ts", "export {}");

    const files = collectSourceFiles(path.join(tmpDir, "src"), tmpDir);

    expect(files).toContain("src/shared/utils.ts");
    expect(files).toContain("src/review/agent.ts");
  });

  it("skips node_modules directory", () => {
    writeSourceFile(tmpDir, "src/node_modules/pkg/index.ts", "export {}");
    writeSourceFile(tmpDir, "src/real.ts", "export {}");

    const files = collectSourceFiles(path.join(tmpDir, "src"), tmpDir);

    expect(files).toEqual(["src/real.ts"]);
  });

  it("skips non-source extensions", () => {
    writeSourceFile(tmpDir, "src/readme.md", "# Readme");
    writeSourceFile(tmpDir, "src/styles.css", "body {}");
    writeSourceFile(tmpDir, "src/code.ts", "export {}");

    const files = collectSourceFiles(path.join(tmpDir, "src"), tmpDir);

    expect(files).toEqual(["src/code.ts"]);
  });

  it("includes .tsx, .js, and .jsx files", () => {
    writeSourceFile(tmpDir, "src/component.tsx", "export {}");
    writeSourceFile(tmpDir, "src/legacy.js", "module.exports = {}");
    writeSourceFile(tmpDir, "src/legacy.jsx", "export {}");

    const files = collectSourceFiles(path.join(tmpDir, "src"), tmpDir);

    expect(files).toHaveLength(3);
  });

  it("returns empty array for non-existent directory", () => {
    const files = collectSourceFiles(path.join(tmpDir, "nonexistent"), tmpDir);
    expect(files).toEqual([]);
  });
});

describe("scanFileForPlaceholders", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-gap-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds TODO comments", () => {
    writeSourceFile(tmpDir, "src/foo.ts", "// TODO: implement this\nexport const x = 1;");

    const matches = scanFileForPlaceholders(tmpDir, "src/foo.ts");

    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(1);
    expect(matches[0].text).toContain("TODO");
  });

  it("finds FIXME comments", () => {
    writeSourceFile(tmpDir, "src/foo.ts", "const x = 1;\n// FIXME: broken logic");

    const matches = scanFileForPlaceholders(tmpDir, "src/foo.ts");

    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(2);
  });

  it("finds placeholder and stub keywords", () => {
    writeSourceFile(
      tmpDir,
      "src/foo.ts",
      'const data = "placeholder";\nfunction stub() {}\nconst fake = true;',
    );

    const matches = scanFileForPlaceholders(tmpDir, "src/foo.ts");

    expect(matches).toHaveLength(3);
  });

  it("finds mock keyword", () => {
    writeSourceFile(tmpDir, "src/foo.ts", "const mockData = [1, 2, 3];");

    const matches = scanFileForPlaceholders(tmpDir, "src/foo.ts");

    expect(matches).toHaveLength(1);
    expect(matches[0].text).toContain("mock");
  });

  it("finds throw not implemented pattern", () => {
    writeSourceFile(
      tmpDir,
      "src/foo.ts",
      'function doStuff() {\n  throw new Error("not implemented");\n}',
    );

    const matches = scanFileForPlaceholders(tmpDir, "src/foo.ts");

    expect(matches).toHaveLength(1);
  });

  it("returns empty array for clean file", () => {
    writeSourceFile(tmpDir, "src/foo.ts", "export const x = 1;\nexport function add(a: number, b: number) { return a + b; }");

    const matches = scanFileForPlaceholders(tmpDir, "src/foo.ts");

    expect(matches).toEqual([]);
  });

  it("returns empty array for non-existent file", () => {
    const matches = scanFileForPlaceholders(tmpDir, "src/nonexistent.ts");
    expect(matches).toEqual([]);
  });

  it("reports only one match per line even if multiple patterns match", () => {
    writeSourceFile(tmpDir, "src/foo.ts", "// TODO: fix this fake stub placeholder");

    const matches = scanFileForPlaceholders(tmpDir, "src/foo.ts");

    expect(matches).toHaveLength(1);
  });
});

describe("parseCriterionResults", () => {
  it("parses valid criterion result lines", () => {
    const text = `Preamble text
{"storyId":"1.1","criterion":"Given X when Y then Z","status":"verified","evidence":"Found in src/foo.ts"}
{"storyId":"1.2","criterion":"Another criterion","status":"gap","evidence":"Not implemented"}
## Summary
Done.`;

    const results = parseCriterionResults(text);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      storyId: "1.1",
      criterion: "Given X when Y then Z",
      status: "verified",
      evidence: "Found in src/foo.ts",
    });
    expect(results[1].status).toBe("gap");
  });

  it("skips invalid JSON lines", () => {
    const text = `{not valid}
{"storyId":"1.1","criterion":"AC","status":"verified","evidence":"OK"}`;

    const results = parseCriterionResults(text);
    expect(results).toHaveLength(1);
  });

  it("skips results with invalid status", () => {
    const text = '{"storyId":"1.1","criterion":"AC","status":"unknown","evidence":"hmm"}';

    const results = parseCriterionResults(text);
    expect(results).toEqual([]);
  });

  it("returns empty array for text without JSON", () => {
    expect(parseCriterionResults("No JSON here")).toEqual([]);
  });

  it("handles results without required fields", () => {
    const text = '{"storyId":"1.1","status":"verified"}';
    const results = parseCriterionResults(text);
    expect(results).toEqual([]);
  });
});

describe("createGapAnalyst", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-gap-test-"));
    mockSendMessage.mockReset();

    mockSendMessage.mockResolvedValue({
      text: '{"storyId":"1.1","criterion":"Given X when Y then Z","status":"verified","evidence":"Implemented in src/foo.ts"}\n\n## Summary\nAll criteria verified.',
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6-20250929",
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns no-op result when PRD has no stories", async () => {
    const analyst = createGapAnalyst();
    const result = await analyst(makeContext());

    expect(result.agent).toBe("gap-analysis");
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.blockingIssues).toEqual([]);
    expect(result.report).toContain("No stories found");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("sends acceptance criteria and source code to Claude", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Test Story", acceptanceCriteria: ["AC-1", "AC-2"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "export const x = 1;");

    const analyst = createGapAnalyst();
    await analyst(makeContext());

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMessage.mock.calls[0];
    // System prompt
    expect(callArgs[1]).toContain("QA analyst");
    // User message includes criteria
    const userMessage = callArgs[2][0].content;
    expect(userMessage).toContain("AC-1");
    expect(userMessage).toContain("AC-2");
    expect(userMessage).toContain("Story 1.1");
    // Includes source file
    expect(userMessage).toContain("src/foo.ts");
  });

  it("returns verified results as non-blocking", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Test Story", acceptanceCriteria: ["AC-1"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "export const x = 1;");

    const analyst = createGapAnalyst();
    const result = await analyst(makeContext());

    expect(result.blockingIssues).toEqual([]);
    expect(result.findings).toEqual([]); // No gaps = no high-severity findings from criteria
  });

  it("returns gaps as blocking issues", async () => {
    writePrd(tmpDir, [
      { id: "2.1", title: "Profile Story", acceptanceCriteria: ["User can save profile"] },
    ]);
    writeSourceFile(tmpDir, "src/profile.ts", "export {}");

    mockSendMessage.mockResolvedValue({
      text: '{"storyId":"2.1","criterion":"User can save profile","status":"gap","evidence":"No file write logic found in profile.ts"}\n\n## Summary\n1 gap found.',
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6-20250929",
    });

    const analyst = createGapAnalyst();
    const result = await analyst(makeContext());

    expect(result.blockingIssues).toHaveLength(1);
    expect(result.blockingIssues[0]).toContain("Story 2.1");
    expect(result.blockingIssues[0]).toContain("User can save profile");
  });

  it("gap findings have high severity", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story", acceptanceCriteria: ["AC-1"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "export {}");

    mockSendMessage.mockResolvedValue({
      text: '{"storyId":"1.1","criterion":"AC-1","status":"gap","evidence":"Missing implementation"}\n\n## Summary\n1 gap.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const analyst = createGapAnalyst();
    const result = await analyst(makeContext());

    const gapFindings = result.findings.filter((f) => f.title.startsWith("Gap:"));
    expect(gapFindings).toHaveLength(1);
    expect(gapFindings[0].severity).toBe("high");
  });

  it("includes placeholder matches in findings", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story", acceptanceCriteria: ["AC-1"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "// TODO: implement this\nexport const x = 1;");

    const analyst = createGapAnalyst();
    const result = await analyst(makeContext());

    const placeholderFindings = result.findings.filter((f) => f.title.startsWith("Placeholder:"));
    expect(placeholderFindings.length).toBeGreaterThanOrEqual(1);
    expect(placeholderFindings[0].severity).toBe("medium");
    expect(placeholderFindings[0].file).toBe("src/foo.ts");
  });

  it("includes placeholder patterns in the API message", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story", acceptanceCriteria: ["AC-1"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "// TODO: finish this\nexport const x = 1;");

    const analyst = createGapAnalyst();
    await analyst(makeContext());

    const userMessage = mockSendMessage.mock.calls[0][2][0].content;
    expect(userMessage).toContain("Placeholder Patterns Found");
    expect(userMessage).toContain("TODO");
  });

  it("generates a markdown report", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story", acceptanceCriteria: ["AC-1"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "export const x = 1;");

    const analyst = createGapAnalyst();
    const result = await analyst(makeContext());

    expect(result.report).toContain("# Gap Analysis Report");
    expect(result.report).toContain("Criteria checked:");
    expect(result.report).toContain("## Summary");
  });

  it("always returns agent='gap-analysis'", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story", acceptanceCriteria: ["AC-1"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "export {}");

    const analyst = createGapAnalyst();
    const result = await analyst(makeContext());

    expect(result.agent).toBe("gap-analysis");
  });

  it("always returns success=true on completion", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story", acceptanceCriteria: ["AC-1"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "export {}");

    const analyst = createGapAnalyst();
    const result = await analyst(makeContext());

    expect(result.success).toBe(true);
  });

  it("requests higher max tokens for gap analysis", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story", acceptanceCriteria: ["AC-1"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "export {}");

    const analyst = createGapAnalyst();
    await analyst(makeContext());

    const clientOptions = mockSendMessage.mock.calls[0][0];
    expect(clientOptions.maxTokens).toBe(8192);
  });

  it("handles multiple stories with multiple criteria", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story One", acceptanceCriteria: ["AC-A", "AC-B"] },
      { id: "1.2", title: "Story Two", acceptanceCriteria: ["AC-C"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "export {}");

    mockSendMessage.mockResolvedValue({
      text: [
        '{"storyId":"1.1","criterion":"AC-A","status":"verified","evidence":"OK"}',
        '{"storyId":"1.1","criterion":"AC-B","status":"gap","evidence":"Missing"}',
        '{"storyId":"1.2","criterion":"AC-C","status":"verified","evidence":"OK"}',
        "",
        "## Summary",
        "1 gap found.",
      ].join("\n"),
      usage: { inputTokens: 300, outputTokens: 150 },
      model: "claude-opus-4-6-20250929",
    });

    const analyst = createGapAnalyst();
    const result = await analyst(makeContext());

    expect(result.blockingIssues).toHaveLength(1);
    expect(result.blockingIssues[0]).toContain("AC-B");
  });

  it("report includes gap details and verified criteria", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story", acceptanceCriteria: ["AC-1", "AC-2"] },
    ]);
    writeSourceFile(tmpDir, "src/foo.ts", "export {}");

    mockSendMessage.mockResolvedValue({
      text: [
        '{"storyId":"1.1","criterion":"AC-1","status":"verified","evidence":"Found in code"}',
        '{"storyId":"1.1","criterion":"AC-2","status":"gap","evidence":"Not implemented"}',
        "",
        "## Summary",
        "1 verified, 1 gap.",
      ].join("\n"),
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6-20250929",
    });

    const analyst = createGapAnalyst();
    const result = await analyst(makeContext());

    expect(result.report).toContain("Gaps Found");
    expect(result.report).toContain("[GAP]");
    expect(result.report).toContain("Verified Criteria");
    expect(result.report).toContain("Not implemented");
  });

  it("respects maxFilesForApi limit", async () => {
    writePrd(tmpDir, [
      { id: "1.1", title: "Story", acceptanceCriteria: ["AC-1"] },
    ]);
    // Create many files
    for (let i = 0; i < 10; i++) {
      writeSourceFile(tmpDir, `src/file${i}.ts`, `export const x${i} = ${i};`);
    }

    const analyst = createGapAnalyst({ maxFilesForApi: 3 });
    await analyst(makeContext());

    const userMessage = mockSendMessage.mock.calls[0][2][0].content;
    // Count "### src/" occurrences — should be at most 3
    const fileHeaders = userMessage.match(/### src\//g) || [];
    expect(fileHeaders.length).toBeLessThanOrEqual(3);
  });
});
