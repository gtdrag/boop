import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  analyze,
  countFindingsInReport,
  extractPatterns,
  hasBlockingFindings,
  parseProgressEntry,
  readEpicReviews,
  splitProgressEntries,
} from "./analyzer.js";

// ---------------------------------------------------------------------------
// parseProgressEntry
// ---------------------------------------------------------------------------

describe("parseProgressEntry", () => {
  it("parses a standard progress entry", () => {
    const block = `## 2026-02-16 20:40 CST - Story 3.1: Viability assessment
- Implemented viability assessment with Claude API
- Created src/planning/viability.ts
- Files changed: src/planning/viability.ts, src/planning/viability.test.ts
- **Learnings for future iterations:**
  - Use retry for API calls
  - Mock the SDK client
---`;

    const result = parseProgressEntry(block);
    expect(result).not.toBeNull();
    expect(result!.storyId).toBe("3.1");
    expect(result!.storyTitle).toBe("Viability assessment");
    expect(result!.summaryLines).toBe(2);
    expect(result!.filesChanged).toBe(2);
    expect(result!.learnings).toEqual([
      "Use retry for API calls",
      "Mock the SDK client",
    ]);
  });

  it("returns null for non-entry blocks", () => {
    expect(parseProgressEntry("## Codebase Patterns\n- some pattern")).toBeNull();
    expect(parseProgressEntry("random text")).toBeNull();
  });

  it("handles entry with no learnings", () => {
    const block = `## 2026-02-16 20:40 CST - Story 1.1: Bootstrap
- Set up project
---`;

    const result = parseProgressEntry(block);
    expect(result!.learnings).toEqual([]);
    expect(result!.summaryLines).toBe(1);
  });

  it("handles entry with no files changed line", () => {
    const block = `## 2026-02-16 20:40 CST - Story 2.1: Profile schema
- Defined DeveloperProfile interface
---`;

    const result = parseProgressEntry(block);
    expect(result!.filesChanged).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// splitProgressEntries
// ---------------------------------------------------------------------------

describe("splitProgressEntries", () => {
  it("splits multiple entries", () => {
    const content = `## 2026-02-16 20:40 CST - Story 1.1: First
- Did something
---
## 2026-02-16 20:50 CST - Story 1.2: Second
- Did another thing
---`;

    const entries = splitProgressEntries(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain("Story 1.1");
    expect(entries[1]).toContain("Story 1.2");
  });

  it("handles content with codebase patterns header", () => {
    const content = `## Codebase Patterns
- Pattern one
- Pattern two

## 2026-02-16 20:40 CST - Story 1.1: First
- Did something
---`;

    const entries = splitProgressEntries(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("Story 1.1");
  });

  it("returns empty array for empty content", () => {
    expect(splitProgressEntries("")).toEqual([]);
    expect(splitProgressEntries("no entries here")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractPatterns
// ---------------------------------------------------------------------------

describe("extractPatterns", () => {
  it("extracts patterns from progress.txt", () => {
    const content = `## Codebase Patterns
- **Mock pattern:** Use vi.hoisted()
- **API pattern:** Use retry wrapper

## 2026-02-16 20:40 CST - Story 1.1: First
- stuff`;

    const patterns = extractPatterns(content);
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).toContain("Mock pattern");
    expect(patterns[1]).toContain("API pattern");
  });

  it("returns empty for no patterns section", () => {
    expect(extractPatterns("## 2026-02-16 - Story 1.1: test")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// countFindingsInReport / hasBlockingFindings
// ---------------------------------------------------------------------------

describe("countFindingsInReport", () => {
  it("counts severity markers in report", () => {
    const report = `# Review
- [critical] SQL injection in user input
- [high] Missing auth check
- [medium] No error handling
- [low] Unused import
- [info] Consider using const`;

    expect(countFindingsInReport(report)).toBe(5);
  });

  it("returns 0 for no findings", () => {
    expect(countFindingsInReport("# Clean report\nAll good.")).toBe(0);
  });
});

describe("hasBlockingFindings", () => {
  it("returns true for critical findings", () => {
    expect(hasBlockingFindings("[critical] Issue found")).toBe(true);
  });

  it("returns true for high findings", () => {
    expect(hasBlockingFindings("[high] Issue found")).toBe(true);
  });

  it("returns false for medium/low/info only", () => {
    expect(hasBlockingFindings("[medium] Issue\n[low] Minor")).toBe(false);
  });

  it("returns false for no findings", () => {
    expect(hasBlockingFindings("No issues")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readEpicReviews
// ---------------------------------------------------------------------------

describe("readEpicReviews", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-retro-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads review reports from epic directory", () => {
    const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-1");
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(path.join(reviewDir, "code-review.md"), "[medium] Issue A", "utf-8");
    fs.writeFileSync(path.join(reviewDir, "security-scan.md"), "[critical] Vuln B", "utf-8");

    const reports = readEpicReviews(tmpDir, 1);
    expect(Object.keys(reports)).toHaveLength(2);
    expect(reports["code-review"]).toContain("Issue A");
    expect(reports["security-scan"]).toContain("Vuln B");
  });

  it("reads qa-smoke-test subdirectory", () => {
    const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-1");
    const qaDir = path.join(reviewDir, "qa-smoke-test");
    fs.mkdirSync(qaDir, { recursive: true });
    fs.writeFileSync(path.join(qaDir, "results.md"), "QA passed", "utf-8");

    const reports = readEpicReviews(tmpDir, 1);
    expect(reports["qa-smoke-test"]).toBe("QA passed");
  });

  it("returns empty object when review dir does not exist", () => {
    const reports = readEpicReviews(tmpDir, 99);
    expect(Object.keys(reports)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// analyze (integration)
// ---------------------------------------------------------------------------

describe("analyze", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-retro-analyze-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces empty data when no progress exists", () => {
    const result = analyze({ projectDir: tmpDir, projectName: "Test" });
    expect(result.totalStories).toBe(0);
    expect(result.totalEpics).toBe(0);
    expect(result.epics).toEqual([]);
    expect(result.mostComplexStory).toBeNull();
    expect(result.avgFilesPerStory).toBe(0);
  });

  it("parses stories from progress.txt", () => {
    const progressDir = path.join(tmpDir, ".boop");
    fs.mkdirSync(progressDir, { recursive: true });

    const progressContent = `## 2026-02-16 20:40 CST - Story 1.1: Bootstrap
- Set up project
- Files changed: package.json, tsconfig.json
---
## 2026-02-16 20:50 CST - Story 1.2: CLI
- Created CLI
- Files changed: src/cli/program.ts
- **Learnings for future iterations:**
  - Commander works with ESM
---`;

    fs.writeFileSync(path.join(progressDir, "progress.txt"), progressContent, "utf-8");

    const result = analyze({ projectDir: tmpDir, projectName: "Test" });
    expect(result.totalStories).toBe(2);
    expect(result.totalEpics).toBe(1);
    expect(result.epics).toHaveLength(1);
    expect(result.epics[0]!.stories).toHaveLength(2);
    expect(result.allLearnings).toContain("Commander works with ESM");
    expect(result.mostComplexStory!.storyId).toBe("1.1");
    expect(result.avgFilesPerStory).toBe(1.5);
  });

  it("integrates review data from .boop/reviews/", () => {
    const progressDir = path.join(tmpDir, ".boop");
    fs.mkdirSync(progressDir, { recursive: true });

    const progressContent = `## 2026-02-16 20:40 CST - Story 1.1: Bootstrap
- Set up project
---`;

    fs.writeFileSync(path.join(progressDir, "progress.txt"), progressContent, "utf-8");

    const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-1");
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(
      path.join(reviewDir, "security-scan.md"),
      "[critical] XSS vulnerability\n[medium] Missing CSP",
      "utf-8",
    );

    const result = analyze({ projectDir: tmpDir, totalEpics: 1 });
    expect(result.epics[0]!.reviewFindings["security-scan"]).toBe(2);
    expect(result.epics[0]!.hadBlockingSeverity).toBe(true);
    expect(result.topFindingPatterns).toHaveLength(1);
    expect(result.topFindingPatterns[0]!.category).toBe("security-scan");
    expect(result.topFindingPatterns[0]!.count).toBe(2);
  });

  it("extracts codebase patterns", () => {
    const progressDir = path.join(tmpDir, ".boop");
    fs.mkdirSync(progressDir, { recursive: true });

    const progressContent = `## Codebase Patterns
- **Mock pattern:** Use vi.hoisted()
- **API pattern:** Use retry wrapper

## 2026-02-16 20:40 CST - Story 1.1: Bootstrap
- Set up project
---`;

    fs.writeFileSync(path.join(progressDir, "progress.txt"), progressContent, "utf-8");

    const result = analyze({ projectDir: tmpDir });
    expect(result.codebasePatterns).toHaveLength(2);
  });

  it("uses totalEpics override when higher than detected", () => {
    const progressDir = path.join(tmpDir, ".boop");
    fs.mkdirSync(progressDir, { recursive: true });

    const progressContent = `## 2026-02-16 20:40 CST - Story 1.1: Bootstrap
- Set up project
---`;

    fs.writeFileSync(path.join(progressDir, "progress.txt"), progressContent, "utf-8");

    const result = analyze({ projectDir: tmpDir, totalEpics: 3 });
    expect(result.totalEpics).toBe(3);
    expect(result.epics).toHaveLength(3);
  });
});
