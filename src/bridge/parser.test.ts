import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseStoryMarkdown } from "./parser.js";
import type { ParsedBreakdown, ParsedEpic, ParsedStory } from "./parser.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "..", "test", "fixtures");

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8");
}

describe("parseStoryMarkdown", () => {
  describe("normal markdown", () => {
    let result: ParsedBreakdown;

    it("parses without throwing", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
    });

    it("extracts the correct number of epics", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
      expect(result.epics).toHaveLength(2);
    });

    it("extracts epic metadata", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
      const epic1 = result.epics[0]!;
      expect(epic1.number).toBe(1);
      expect(epic1.name).toBe("Project Setup & Foundation");
      expect(epic1.goal).toContain("project structure");
      expect(epic1.scope).toContain("Scaffolding");
    });

    it("extracts stories per epic", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
      expect(result.epics[0]!.stories).toHaveLength(2);
      expect(result.epics[1]!.stories).toHaveLength(1);
    });

    it("provides a flat allStories list", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
      expect(result.allStories).toHaveLength(3);
      expect(result.allStories.map((s) => s.id)).toEqual(["1.1", "1.2", "2.1"]);
    });

    it("extracts story ID and title", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
      const story = result.allStories[0]!;
      expect(story.id).toBe("1.1");
      expect(story.title).toBe("Project scaffolding");
    });

    it("extracts user story text", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
      const story = result.allStories[0]!;
      expect(story.userStory).toContain("As a");
      expect(story.userStory).toContain("I want");
      expect(story.userStory).toContain("so that");
    });

    it("extracts acceptance criteria without bold markers", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
      const story = result.allStories[0]!;
      expect(story.acceptanceCriteria).toHaveLength(4);
      expect(story.acceptanceCriteria[0]).toContain("Given a fresh checkout");
      expect(story.acceptanceCriteria[2]).toBe("Typecheck passes");
      expect(story.acceptanceCriteria[3]).toBe("All tests pass");
    });

    it("extracts prerequisites as story IDs", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
      expect(result.allStories[0]!.prerequisites).toEqual([]);
      expect(result.allStories[1]!.prerequisites).toEqual(["1.1"]);
    });

    it("extracts multiple prerequisites", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
      const story21 = result.allStories[2]!;
      expect(story21.prerequisites).toEqual(["1.1", "1.2"]);
    });

    it("extracts technical notes", () => {
      const md = loadFixture("stories-normal.md");
      result = parseStoryMarkdown(md);
      const story = result.allStories[0]!;
      expect(story.technicalNotes).toHaveLength(3);
      expect(story.technicalNotes[0]).toContain("Initialize Next.js");
    });
  });

  describe("edge cases", () => {
    it("handles minimal stories with only criteria", () => {
      const md = loadFixture("stories-edge-cases.md");
      const result = parseStoryMarkdown(md);
      const story = result.allStories[0]!;
      expect(story.id).toBe("1.1");
      expect(story.acceptanceCriteria).toHaveLength(2);
      expect(story.technicalNotes).toEqual([]);
      expect(story.prerequisites).toEqual([]);
    });

    it("strips bold markers from acceptance criteria", () => {
      const md = loadFixture("stories-edge-cases.md");
      const result = parseStoryMarkdown(md);
      const story = result.allStories[1]!;
      // Bold Given/When/Then should be stripped
      expect(story.acceptanceCriteria[0]).toContain("Given a malformed request");
      expect(story.acceptanceCriteria[0]).not.toContain("**");
    });

    it("handles stories without technical notes section", () => {
      const md = loadFixture("stories-edge-cases.md");
      const result = parseStoryMarkdown(md);
      const story = result.allStories[2]!;
      expect(story.technicalNotes).toEqual([]);
    });

    it("handles multi-line user stories", () => {
      const md = loadFixture("stories-edge-cases.md");
      const result = parseStoryMarkdown(md);
      const story = result.allStories[3]!;
      expect(story.userStory).toContain("As a developer");
      expect(story.userStory).toContain("I want structured logging");
      expect(story.userStory).toContain("so that error handling");
      // Should be joined into a single string (no newlines)
      expect(story.userStory).not.toContain("\n");
    });

    it("handles multiple prerequisites", () => {
      const md = loadFixture("stories-edge-cases.md");
      const result = parseStoryMarkdown(md);
      const story = result.allStories[3]!;
      expect(story.prerequisites).toEqual(["1.1", "1.2", "1.3"]);
    });
  });

  describe("real-world format (docs/epics.md)", () => {
    it("parses the actual project epics file", () => {
      const epicsPath = path.resolve(import.meta.dirname, "..", "..", "docs", "epics.md");
      if (!fs.existsSync(epicsPath)) return; // skip if file doesn't exist
      const md = fs.readFileSync(epicsPath, "utf-8");
      const result = parseStoryMarkdown(md);
      expect(result.epics.length).toBeGreaterThanOrEqual(3);
      expect(result.allStories.length).toBeGreaterThanOrEqual(10);
      // Every story should have an ID and title
      for (const story of result.allStories) {
        expect(story.id).toMatch(/^\d+\.\d+$/);
        expect(story.title.length).toBeGreaterThan(0);
        expect(story.acceptanceCriteria.length).toBeGreaterThan(0);
      }
    });
  });

  describe("error handling", () => {
    it("throws when no epics found", () => {
      expect(() => parseStoryMarkdown("# Just a heading\nSome text")).toThrow(
        "No epics found",
      );
    });

    it("throws when epics have no stories", () => {
      const md = `# Breakdown\n\n## Epic 1: Empty\n**Goal:** Nothing\n**Scope:** Nothing`;
      expect(() => parseStoryMarkdown(md)).toThrow("No stories found");
    });

    it("handles empty string", () => {
      expect(() => parseStoryMarkdown("")).toThrow("No epics found");
    });
  });

  describe("returned types", () => {
    it("returns correctly typed objects", () => {
      const md = loadFixture("stories-normal.md");
      const result: ParsedBreakdown = parseStoryMarkdown(md);

      const epic: ParsedEpic = result.epics[0]!;
      expect(typeof epic.number).toBe("number");
      expect(typeof epic.name).toBe("string");
      expect(typeof epic.goal).toBe("string");
      expect(typeof epic.scope).toBe("string");
      expect(Array.isArray(epic.stories)).toBe(true);

      const story: ParsedStory = epic.stories[0]!;
      expect(typeof story.id).toBe("string");
      expect(typeof story.title).toBe("string");
      expect(typeof story.userStory).toBe("string");
      expect(Array.isArray(story.acceptanceCriteria)).toBe(true);
      expect(Array.isArray(story.prerequisites)).toBe(true);
      expect(Array.isArray(story.technicalNotes)).toBe(true);
    });
  });
});
