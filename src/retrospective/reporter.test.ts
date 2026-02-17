import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { RetrospectiveData } from "./analyzer.js";
import {
  buildMemoryEntries,
  formatSummary,
  generateReport,
  saveMemory,
  saveReport,
} from "./reporter.js";

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function makeTestData(overrides?: Partial<RetrospectiveData>): RetrospectiveData {
  return {
    projectName: "Test Project",
    totalEpics: 2,
    totalStories: 5,
    epics: [
      {
        epicNumber: 1,
        stories: [
          {
            storyId: "1.1",
            storyTitle: "Bootstrap",
            summaryLines: 3,
            filesChanged: 5,
            learnings: ["L1"],
          },
          {
            storyId: "1.2",
            storyTitle: "CLI",
            summaryLines: 2,
            filesChanged: 3,
            learnings: ["L2", "L3"],
          },
        ],
        reviewFindings: { "code-review": 3, "security-scan": 1 },
        blockingIssues: [],
        hadBlockingSeverity: false,
      },
      {
        epicNumber: 2,
        stories: [
          {
            storyId: "2.1",
            storyTitle: "Profile",
            summaryLines: 4,
            filesChanged: 7,
            learnings: [],
          },
          {
            storyId: "2.2",
            storyTitle: "Onboarding",
            summaryLines: 2,
            filesChanged: 4,
            learnings: ["L4"],
          },
          {
            storyId: "2.3",
            storyTitle: "Defaults",
            summaryLines: 1,
            filesChanged: 2,
            learnings: [],
          },
        ],
        reviewFindings: { "security-scan": 2, "gap-analysis": 1 },
        blockingIssues: ["security-scan had critical/high findings"],
        hadBlockingSeverity: true,
      },
    ],
    topFindingPatterns: [
      { category: "security-scan", count: 3 },
      { category: "code-review", count: 3 },
      { category: "gap-analysis", count: 1 },
    ],
    codebasePatterns: ["**Mock pattern:** Use vi.hoisted()", "**API pattern:** Use retry"],
    allLearnings: ["L1", "L2", "L3", "L4"],
    mostComplexStory: {
      storyId: "2.1",
      storyTitle: "Profile",
      summaryLines: 4,
      filesChanged: 7,
      learnings: [],
    },
    avgFilesPerStory: 4.2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateReport
// ---------------------------------------------------------------------------

describe("generateReport", () => {
  it("includes project name in header", () => {
    const report = generateReport(makeTestData());
    expect(report).toContain("# Project Retrospective: Test Project");
  });

  it("includes build statistics table", () => {
    const report = generateReport(makeTestData());
    expect(report).toContain("## Build Statistics");
    expect(report).toContain("| Total Epics | 2 |");
    expect(report).toContain("| Total Stories | 5 |");
    expect(report).toContain("| Avg Files/Story | 4.2 |");
  });

  it("includes most complex story in statistics", () => {
    const report = generateReport(makeTestData());
    expect(report).toContain("2.1: Profile (7 files)");
  });

  it("includes per-epic breakdown", () => {
    const report = generateReport(makeTestData());
    expect(report).toContain("### Epic 1");
    expect(report).toContain("### Epic 2");
    expect(report).toContain("Stories completed: 2");
    expect(report).toContain("Stories completed: 3");
  });

  it("includes review finding patterns", () => {
    const report = generateReport(makeTestData());
    expect(report).toContain("## Review Finding Patterns");
    expect(report).toContain("| security-scan | 3 |");
    expect(report).toContain("| code-review | 3 |");
  });

  it("includes codebase patterns", () => {
    const report = generateReport(makeTestData());
    expect(report).toContain("## Codebase Patterns Discovered");
    expect(report).toContain("Mock pattern");
    expect(report).toContain("API pattern");
  });

  it("includes improvement suggestions", () => {
    const report = generateReport(makeTestData());
    expect(report).toContain("## Pipeline Improvement Suggestions");
  });

  it("suggests blocking severity mitigation when present", () => {
    const report = generateReport(makeTestData());
    expect(report).toContain("blocking severity findings");
  });

  it("handles empty data gracefully", () => {
    const report = generateReport(
      makeTestData({
        totalEpics: 0,
        totalStories: 0,
        epics: [],
        topFindingPatterns: [],
        codebasePatterns: [],
        allLearnings: [],
        mostComplexStory: null,
        avgFilesPerStory: 0,
      }),
    );
    expect(report).toContain("# Project Retrospective");
    expect(report).toContain("No review findings recorded");
    expect(report).toContain("No codebase patterns recorded");
  });
});

// ---------------------------------------------------------------------------
// buildMemoryEntries
// ---------------------------------------------------------------------------

describe("buildMemoryEntries", () => {
  it("creates coding-pattern entries from learnings", () => {
    const data = makeTestData();
    const entries = buildMemoryEntries(data);
    const codingPatterns = entries.filter((e) => e.type === "coding-pattern");
    expect(codingPatterns).toHaveLength(4);
    expect(codingPatterns[0]!.description).toBe("L1");
    expect(codingPatterns[0]!.project).toBe("Test Project");
  });

  it("creates review-finding entries from finding patterns", () => {
    const data = makeTestData();
    const entries = buildMemoryEntries(data);
    const reviewEntries = entries.filter((e) => e.type === "review-finding");
    expect(reviewEntries).toHaveLength(3);
    expect(reviewEntries[0]!.description).toContain("security-scan");
  });

  it("creates process-metric entry when stories exist", () => {
    const data = makeTestData();
    const entries = buildMemoryEntries(data);
    const metrics = entries.filter((e) => e.type === "process-metric");
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.description).toContain("4.2");
  });

  it("skips process-metric when no stories", () => {
    const data = makeTestData({ avgFilesPerStory: 0 });
    const entries = buildMemoryEntries(data);
    const metrics = entries.filter((e) => e.type === "process-metric");
    expect(metrics).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// saveMemory
// ---------------------------------------------------------------------------

describe("saveMemory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-retro-mem-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes YAML file to memory directory", () => {
    const entries = [
      { type: "coding-pattern", description: "test", project: "P", date: "2026-01-01" },
    ];
    const filePath = saveMemory(entries, tmpDir);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toContain("retrospective.yaml");

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parse(content) as Array<Record<string, string>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.type).toBe("coding-pattern");
  });

  it("creates memory directory if it does not exist", () => {
    const deepDir = path.join(tmpDir, "nested", "memory");
    saveMemory([], deepDir);
    expect(fs.existsSync(deepDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// saveReport
// ---------------------------------------------------------------------------

describe("saveReport", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-retro-report-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes report to .boop/retrospective.md", () => {
    const filePath = saveReport(tmpDir, "# Test Report");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toContain("retrospective.md");
    expect(fs.readFileSync(filePath, "utf-8")).toBe("# Test Report");
  });

  it("creates .boop directory if it does not exist", () => {
    saveReport(tmpDir, "content");
    expect(fs.existsSync(path.join(tmpDir, ".boop"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatSummary
// ---------------------------------------------------------------------------

describe("formatSummary", () => {
  it("includes key metrics", () => {
    const summary = formatSummary(makeTestData());
    expect(summary).toContain("Test Project");
    expect(summary).toContain("Epics completed:    2");
    expect(summary).toContain("Stories completed:   5");
    expect(summary).toContain("Avg files/story:     4.2");
    expect(summary).toContain("Patterns discovered: 2");
    expect(summary).toContain("Learnings captured:  4");
  });

  it("includes most complex story", () => {
    const summary = formatSummary(makeTestData());
    expect(summary).toContain("Most complex story:  2.1 (7 files)");
  });

  it("includes review findings count", () => {
    const summary = formatSummary(makeTestData());
    expect(summary).toContain("Review findings:     7");
  });

  it("omits most complex story when null", () => {
    const summary = formatSummary(makeTestData({ mostComplexStory: null }));
    expect(summary).not.toContain("Most complex story");
  });

  it("omits review findings when none exist", () => {
    const summary = formatSummary(makeTestData({ topFindingPatterns: [] }));
    expect(summary).not.toContain("Review findings");
  });
});
