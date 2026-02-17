import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParsedBreakdown, ParsedEpic, ParsedStory } from "./parser.js";
import { parseStoryMarkdown } from "./parser.js";
import {
  convertToPrd,
  savePrd,
  type ProjectMetadata,
} from "./converter.js";
import type { Prd } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStory(overrides: Partial<ParsedStory> = {}): ParsedStory {
  return {
    id: "1.1",
    title: "Test story",
    userStory: "As a developer, I want tests, so that things work.",
    acceptanceCriteria: ["Given X, when Y, then Z"],
    prerequisites: [],
    technicalNotes: [],
    ...overrides,
  };
}

function makeEpic(overrides: Partial<ParsedEpic> = {}): ParsedEpic {
  return {
    number: 1,
    name: "Foundation",
    goal: "Set up the project",
    scope: "Everything",
    stories: [makeStory()],
    ...overrides,
  };
}

function makeBreakdown(epics?: ParsedEpic[]): ParsedBreakdown {
  const e = epics ?? [makeEpic()];
  return {
    epics: e,
    allStories: e.flatMap((ep) => ep.stories),
  };
}

const META: ProjectMetadata = {
  project: "TestProject",
  branchName: "ralph/epic-1",
  description: "Epic 1: Foundation",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("convertToPrd", () => {
  it("produces a valid Prd from a single-epic breakdown", () => {
    const prd = convertToPrd(makeBreakdown(), META);

    expect(prd.project).toBe("TestProject");
    expect(prd.branchName).toBe("ralph/epic-1");
    expect(prd.description).toBe("Epic 1: Foundation");
    expect(prd.userStories).toHaveLength(1);
  });

  it("maps story fields correctly", () => {
    const prd = convertToPrd(makeBreakdown(), META);
    const story = prd.userStories[0]!;

    expect(story.id).toBe("1.1");
    expect(story.title).toBe("Test story");
    expect(story.description).toBe(
      "As a developer, I want tests, so that things work.",
    );
    expect(story.passes).toBe(false);
  });

  it("always appends 'Typecheck passes' and 'All tests pass'", () => {
    const prd = convertToPrd(makeBreakdown(), META);
    const criteria = prd.userStories[0]!.acceptanceCriteria;

    expect(criteria).toContain("Typecheck passes");
    expect(criteria).toContain("All tests pass");
  });

  it("does not duplicate required criteria if already present", () => {
    const story = makeStory({
      acceptanceCriteria: [
        "Given X, when Y, then Z",
        "Typecheck passes",
        "All tests pass",
      ],
    });
    const breakdown = makeBreakdown([makeEpic({ stories: [story] })]);
    const prd = convertToPrd(breakdown, META);
    const criteria = prd.userStories[0]!.acceptanceCriteria;

    const typecheckCount = criteria.filter((c) => c === "Typecheck passes").length;
    const testsCount = criteria.filter((c) => c === "All tests pass").length;
    expect(typecheckCount).toBe(1);
    expect(testsCount).toBe(1);
  });

  it("handles case-insensitive duplicate check for required criteria", () => {
    const story = makeStory({
      acceptanceCriteria: ["typecheck passes", "all tests pass"],
    });
    const breakdown = makeBreakdown([makeEpic({ stories: [story] })]);
    const prd = convertToPrd(breakdown, META);
    const criteria = prd.userStories[0]!.acceptanceCriteria;

    // Should not add duplicates even with different casing
    expect(criteria).toHaveLength(2);
  });

  it("sets priority based on epic and story ordering", () => {
    const epic1 = makeEpic({
      number: 1,
      stories: [
        makeStory({ id: "1.1" }),
        makeStory({ id: "1.2" }),
      ],
    });
    const epic2 = makeEpic({
      number: 2,
      stories: [
        makeStory({ id: "2.1" }),
      ],
    });
    const breakdown = makeBreakdown([epic1, epic2]);
    const prd = convertToPrd(breakdown, META);

    // Epic 1 stories should have lower priority numbers than epic 2
    expect(prd.userStories[0]!.priority).toBe(1);   // epic 0, story 0
    expect(prd.userStories[1]!.priority).toBe(2);   // epic 0, story 1
    expect(prd.userStories[2]!.priority).toBe(101); // epic 1, story 0
  });

  it("builds notes from technical notes and prerequisites", () => {
    const story = makeStory({
      technicalNotes: ["Use Express", "Add middleware"],
      prerequisites: ["1.1", "1.2"],
    });
    const breakdown = makeBreakdown([makeEpic({ stories: [story] })]);
    const prd = convertToPrd(breakdown, META);
    const notes = prd.userStories[0]!.notes;

    expect(notes).toContain("Use Express");
    expect(notes).toContain("Add middleware");
    expect(notes).toContain("Depends on 1.1, 1.2 being complete");
  });

  it("omits notes field when no technical notes or prerequisites", () => {
    const prd = convertToPrd(makeBreakdown(), META);
    expect(prd.userStories[0]!.notes).toBeUndefined();
  });

  it("sets notes from only prerequisites when no technical notes", () => {
    const story = makeStory({ prerequisites: ["1.1"] });
    const breakdown = makeBreakdown([makeEpic({ stories: [story] })]);
    const prd = convertToPrd(breakdown, META);

    expect(prd.userStories[0]!.notes).toBe("Depends on 1.1 being complete.");
  });

  describe("epic filtering", () => {
    it("filters to a single epic when epicNumber is specified", () => {
      const epic1 = makeEpic({
        number: 1,
        stories: [makeStory({ id: "1.1" })],
      });
      const epic2 = makeEpic({
        number: 2,
        stories: [makeStory({ id: "2.1" }), makeStory({ id: "2.2" })],
      });
      const breakdown = makeBreakdown([epic1, epic2]);
      const prd = convertToPrd(breakdown, META, { epicNumber: 2 });

      expect(prd.userStories).toHaveLength(2);
      expect(prd.userStories[0]!.id).toBe("2.1");
      expect(prd.userStories[1]!.id).toBe("2.2");
    });

    it("throws when epic number not found", () => {
      const breakdown = makeBreakdown();
      expect(() => convertToPrd(breakdown, META, { epicNumber: 99 })).toThrow(
        "Epic 99 not found",
      );
    });
  });

  describe("multi-epic conversion", () => {
    it("converts all epics when no filter is set", () => {
      const epic1 = makeEpic({
        number: 1,
        stories: [makeStory({ id: "1.1" }), makeStory({ id: "1.2" })],
      });
      const epic2 = makeEpic({
        number: 2,
        stories: [makeStory({ id: "2.1" })],
      });
      const breakdown = makeBreakdown([epic1, epic2]);
      const prd = convertToPrd(breakdown, META);

      expect(prd.userStories).toHaveLength(3);
    });

    it("all stories start with passes: false", () => {
      const epic1 = makeEpic({
        number: 1,
        stories: [makeStory({ id: "1.1" }), makeStory({ id: "1.2" })],
      });
      const breakdown = makeBreakdown([epic1]);
      const prd = convertToPrd(breakdown, META);

      for (const story of prd.userStories) {
        expect(story.passes).toBe(false);
      }
    });
  });
});

describe("savePrd", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .boop directory and writes prd.json", () => {
    const prd: Prd = {
      project: "Test",
      branchName: "test-branch",
      description: "Test desc",
      userStories: [],
    };

    const filePath = savePrd(prd, tmpDir);

    expect(filePath).toBe(path.join(tmpDir, ".boop", "prd.json"));
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.project).toBe("Test");
    expect(content.branchName).toBe("test-branch");
  });

  it("overwrites existing prd.json", () => {
    const prd1: Prd = {
      project: "First",
      branchName: "b1",
      description: "d1",
      userStories: [],
    };
    const prd2: Prd = {
      project: "Second",
      branchName: "b2",
      description: "d2",
      userStories: [],
    };

    savePrd(prd1, tmpDir);
    savePrd(prd2, tmpDir);

    const content = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".boop", "prd.json"), "utf-8"),
    );
    expect(content.project).toBe("Second");
  });

  it("writes valid JSON with trailing newline", () => {
    const prd: Prd = {
      project: "Test",
      branchName: "b",
      description: "d",
      userStories: [
        {
          id: "1.1",
          title: "Story",
          description: "Desc",
          acceptanceCriteria: ["Typecheck passes", "All tests pass"],
          priority: 1,
          passes: false,
        },
      ],
    };

    savePrd(prd, tmpDir);

    const raw = fs.readFileSync(path.join(tmpDir, ".boop", "prd.json"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("works when .boop directory already exists", () => {
    fs.mkdirSync(path.join(tmpDir, ".boop"), { recursive: true });

    const prd: Prd = {
      project: "Test",
      branchName: "b",
      description: "d",
      userStories: [],
    };

    expect(() => savePrd(prd, tmpDir)).not.toThrow();
    expect(fs.existsSync(path.join(tmpDir, ".boop", "prd.json"))).toBe(true);
  });
});

describe("end-to-end: parse → convert → save", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-e2e-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces a valid prd.json from fixture markdown", () => {
    // Load the fixture used by parser tests
    const fixturesDir = path.resolve(
      import.meta.dirname,
      "..",
      "..",
      "test",
      "fixtures",
    );
    const md = fs.readFileSync(
      path.join(fixturesDir, "stories-normal.md"),
      "utf-8",
    );

    const breakdown = parseStoryMarkdown(md);

    const prd = convertToPrd(breakdown, {
      project: "E2E-Test",
      branchName: "ralph/e2e",
      description: "End-to-end test",
    });

    // Save and re-read
    const filePath = savePrd(prd, tmpDir);
    const saved: Prd = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    expect(saved.project).toBe("E2E-Test");
    expect(saved.userStories).toHaveLength(3); // 2 from epic 1, 1 from epic 2
    expect(saved.userStories.every((s) => !s.passes)).toBe(true);

    // All stories should have the required criteria
    for (const story of saved.userStories) {
      expect(story.acceptanceCriteria).toContain("Typecheck passes");
      expect(story.acceptanceCriteria).toContain("All tests pass");
    }
  });
});
