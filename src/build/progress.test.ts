import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Story } from "../shared/types.js";
import {
  readProgress,
  formatProgressEntry,
  appendProgress,
  extractPatternsSection,
  addPattern,
  extractClaudeMdUpdates,
  appendToClaudeMd,
  buildProgressEntry,
  type ProgressEntry,
} from "./progress.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-progress-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<ProgressEntry> = {}): ProgressEntry {
  return {
    date: "2026-02-16 19:30",
    storyId: "4.4",
    storyTitle: "Progress tracking",
    summary: ["Implemented progress module", "Added pattern extraction"],
    filesChanged: ["src/build/progress.ts"],
    learnings: ["Append-only logs are easier to parse"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// readProgress
// ---------------------------------------------------------------------------

describe("readProgress", () => {
  it("returns file content when file exists", () => {
    const filePath = path.join(tmpDir, "progress.txt");
    fs.writeFileSync(filePath, "# Progress\nDone.\n", "utf-8");

    expect(readProgress(filePath)).toBe("# Progress\nDone.\n");
  });

  it("returns empty string when file does not exist", () => {
    expect(readProgress(path.join(tmpDir, "nope.txt"))).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatProgressEntry
// ---------------------------------------------------------------------------

describe("formatProgressEntry", () => {
  it("formats a complete entry with all fields", () => {
    const formatted = formatProgressEntry(makeEntry());

    expect(formatted).toContain("## 2026-02-16 19:30 - Story 4.4: Progress tracking");
    expect(formatted).toContain("- Implemented progress module");
    expect(formatted).toContain("- Added pattern extraction");
    expect(formatted).toContain("- Files changed: src/build/progress.ts");
    expect(formatted).toContain("- **Learnings for future iterations:**");
    expect(formatted).toContain("  - Append-only logs are easier to parse");
    expect(formatted).toContain("---");
  });

  it("omits files changed section when empty", () => {
    const formatted = formatProgressEntry(makeEntry({ filesChanged: [] }));
    expect(formatted).not.toContain("Files changed:");
  });

  it("omits learnings section when empty", () => {
    const formatted = formatProgressEntry(makeEntry({ learnings: [] }));
    expect(formatted).not.toContain("Learnings for future iterations");
  });

  it("includes multiple files in a comma-separated list", () => {
    const formatted = formatProgressEntry(makeEntry({ filesChanged: ["a.ts", "b.ts", "c.ts"] }));
    expect(formatted).toContain("Files changed: a.ts, b.ts, c.ts");
  });
});

// ---------------------------------------------------------------------------
// appendProgress
// ---------------------------------------------------------------------------

describe("appendProgress", () => {
  it("creates the file and parent directories if they do not exist", () => {
    const filePath = path.join(tmpDir, "sub", "dir", "progress.txt");
    appendProgress(filePath, makeEntry());

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("Story 4.4");
  });

  it("appends to an existing file", () => {
    const filePath = path.join(tmpDir, "progress.txt");
    fs.writeFileSync(filePath, "# Header\n\n", "utf-8");

    appendProgress(filePath, makeEntry({ storyId: "1.1", storyTitle: "First" }));
    appendProgress(filePath, makeEntry({ storyId: "1.2", storyTitle: "Second" }));

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("Story 1.1: First");
    expect(content).toContain("Story 1.2: Second");
    // Original header is preserved
    expect(content).toContain("# Header");
  });

  it("does not double-newline when existing file already ends with newline", () => {
    const filePath = path.join(tmpDir, "progress.txt");
    fs.writeFileSync(filePath, "existing\n\n", "utf-8");

    appendProgress(filePath, makeEntry());
    const content = fs.readFileSync(filePath, "utf-8");

    // Should not have triple newlines
    expect(content).not.toContain("\n\n\n\n");
  });
});

// ---------------------------------------------------------------------------
// extractPatternsSection
// ---------------------------------------------------------------------------

describe("extractPatternsSection", () => {
  it("extracts the patterns section from content", () => {
    const content = `## Codebase Patterns
- **Pattern A:** Description A
- **Pattern B:** Description B

## 2026-02-16 - Story 1.1
- Did stuff
---
`;
    const section = extractPatternsSection(content);
    expect(section).toContain("## Codebase Patterns");
    expect(section).toContain("Pattern A");
    expect(section).toContain("Pattern B");
    expect(section).not.toContain("Story 1.1");
  });

  it("returns empty string when no patterns section exists", () => {
    expect(extractPatternsSection("# Just a header\nStuff\n")).toBe("");
  });

  it("handles patterns section at the end of file", () => {
    const content = `## Some header\nStuff\n\n## Codebase Patterns\n- **P1:** D1\n`;
    const section = extractPatternsSection(content);
    expect(section).toContain("P1");
  });
});

// ---------------------------------------------------------------------------
// addPattern
// ---------------------------------------------------------------------------

describe("addPattern", () => {
  it("creates a patterns section when none exists", () => {
    const filePath = path.join(tmpDir, "progress.txt");
    fs.writeFileSync(filePath, "# Progress\n\n## Story 1\n- Done\n---\n", "utf-8");

    addPattern(filePath, { label: "New Pattern", description: "Works great" });

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("## Codebase Patterns");
    expect(content).toContain("- **New Pattern:** Works great");
    // Original content is preserved
    expect(content).toContain("## Story 1");
  });

  it("appends to an existing patterns section", () => {
    const filePath = path.join(tmpDir, "progress.txt");
    fs.writeFileSync(
      filePath,
      "## Codebase Patterns\n- **Old:** existing\n\n## Story 1\n- Done\n",
      "utf-8",
    );

    addPattern(filePath, { label: "New", description: "added" });

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("- **Old:** existing");
    expect(content).toContain("- **New:** added");
    // Story section preserved
    expect(content).toContain("## Story 1");
  });

  it("works on an empty file", () => {
    const filePath = path.join(tmpDir, "progress.txt");
    fs.writeFileSync(filePath, "", "utf-8");

    addPattern(filePath, { label: "First", description: "pattern" });

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("## Codebase Patterns");
    expect(content).toContain("- **First:** pattern");
  });
});

// ---------------------------------------------------------------------------
// extractClaudeMdUpdates
// ---------------------------------------------------------------------------

describe("extractClaudeMdUpdates", () => {
  it("extracts content between CLAUDE_MD_UPDATE markers", () => {
    const response = `Some text
<!-- CLAUDE_MD_UPDATE -->
New pattern here
Another pattern
<!-- CLAUDE_MD_UPDATE -->
More text`;

    const result = extractClaudeMdUpdates(response);
    expect(result).toBe("New pattern here\nAnother pattern");
  });

  it("extracts content after CLAUDE_MD_UPDATE marker without closing", () => {
    const response = `Text
<!-- CLAUDE_MD_UPDATE -->
Pattern with no close`;

    const result = extractClaudeMdUpdates(response);
    expect(result).toBe("Pattern with no close");
  });

  it("extracts from ## CLAUDE.md Updates heading", () => {
    const response = `## Implementation

Did stuff.

## CLAUDE.md Updates

- New API pattern discovered
- Config requires X

## Next Steps

Continue.`;

    const result = extractClaudeMdUpdates(response);
    expect(result).toBe("- New API pattern discovered\n- Config requires X");
  });

  it("returns null when no updates found", () => {
    expect(extractClaudeMdUpdates("Just regular text")).toBeNull();
  });

  it("returns null for empty marker content", () => {
    const response = "<!-- CLAUDE_MD_UPDATE --><!-- CLAUDE_MD_UPDATE -->";
    expect(extractClaudeMdUpdates(response)).toBeNull();
  });

  it("handles singular 'Update' heading", () => {
    const response = `## CLAUDE.md Update\n\n- Pattern X\n`;
    const result = extractClaudeMdUpdates(response);
    expect(result).toBe("- Pattern X");
  });
});

// ---------------------------------------------------------------------------
// appendToClaudeMd
// ---------------------------------------------------------------------------

describe("appendToClaudeMd", () => {
  it("creates Codebase Patterns section in existing CLAUDE.md", () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    fs.writeFileSync(filePath, "# Project\n\nExisting content.\n", "utf-8");

    appendToClaudeMd(filePath, "- New pattern discovered");

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("# Project");
    expect(content).toContain("## Codebase Patterns");
    expect(content).toContain("- New pattern discovered");
  });

  it("appends to existing Codebase Patterns section", () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    fs.writeFileSync(
      filePath,
      "# Project\n\n## Codebase Patterns\n\n- Existing pattern\n\n## Other Section\n\nStuff.\n",
      "utf-8",
    );

    appendToClaudeMd(filePath, "- Added pattern");

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("- Existing pattern");
    expect(content).toContain("- Added pattern");
    expect(content).toContain("## Other Section");
  });

  it("creates the file if it does not exist", () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");

    appendToClaudeMd(filePath, "- Brand new");

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("## Codebase Patterns");
    expect(content).toContain("- Brand new");
  });
});

// ---------------------------------------------------------------------------
// buildProgressEntry
// ---------------------------------------------------------------------------

describe("buildProgressEntry", () => {
  it("creates a ProgressEntry from story data", () => {
    const story: Story = {
      id: "4.4",
      title: "Progress tracking",
      description: "As a developer...",
      acceptanceCriteria: ["Typecheck passes"],
      priority: 4,
      passes: false,
    };

    const entry = buildProgressEntry(
      story,
      ["Did things"],
      ["src/build/progress.ts"],
      ["Learned stuff"],
    );

    expect(entry.storyId).toBe("4.4");
    expect(entry.storyTitle).toBe("Progress tracking");
    expect(entry.summary).toEqual(["Did things"]);
    expect(entry.filesChanged).toEqual(["src/build/progress.ts"]);
    expect(entry.learnings).toEqual(["Learned stuff"]);
    // Date should be in YYYY-MM-DD HH:MM format
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
