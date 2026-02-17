import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prd, Story } from "../shared/types.js";
import {
  loadPrd,
  savePrdFile,
  pickNextStory,
  markStoryPassed,
  allStoriesComplete,
  formatQualityFailure,
  type QualityCheckResult,
} from "./ralph-loop.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-loop-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "1.1",
    title: "Test story",
    description: "As a developer, I want tests.",
    acceptanceCriteria: ["Typecheck passes", "All tests pass"],
    priority: 1,
    passes: false,
    ...overrides,
  };
}

function makePrd(overrides: Partial<Prd> = {}): Prd {
  return {
    project: "TestProject",
    branchName: "ralph/test",
    description: "Test epic",
    userStories: [
      makeStory({ id: "1.1", priority: 1 }),
      makeStory({ id: "1.2", priority: 2 }),
      makeStory({ id: "1.3", priority: 3 }),
    ],
    ...overrides,
  };
}

function writePrd(prd: Prd): string {
  const filePath = path.join(tmpDir, "prd.json");
  fs.writeFileSync(filePath, JSON.stringify(prd, null, 2) + "\n", "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// loadPrd / savePrdFile
// ---------------------------------------------------------------------------

describe("loadPrd", () => {
  it("reads and parses a valid prd.json", () => {
    const filePath = writePrd(makePrd());
    const prd = loadPrd(filePath);

    expect(prd.project).toBe("TestProject");
    expect(prd.userStories).toHaveLength(3);
  });

  it("throws for a missing file", () => {
    expect(() => loadPrd(path.join(tmpDir, "nonexistent.json"))).toThrow();
  });
});

describe("savePrdFile", () => {
  it("writes the PRD to disk", () => {
    const prd = makePrd();
    const filePath = path.join(tmpDir, "out.json");

    savePrdFile(prd, filePath);

    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Prd;
    expect(parsed.project).toBe("TestProject");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("overwrites an existing file", () => {
    const filePath = path.join(tmpDir, "out.json");
    savePrdFile(makePrd({ project: "First" }), filePath);
    savePrdFile(makePrd({ project: "Second" }), filePath);

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Prd;
    expect(parsed.project).toBe("Second");
  });
});

// ---------------------------------------------------------------------------
// pickNextStory
// ---------------------------------------------------------------------------

describe("pickNextStory", () => {
  it("picks the highest-priority (lowest number) incomplete story", () => {
    const prd = makePrd();
    const next = pickNextStory(prd);
    expect(next?.id).toBe("1.1");
  });

  it("skips stories that already pass", () => {
    const prd = makePrd();
    prd.userStories[0]!.passes = true;

    const next = pickNextStory(prd);
    expect(next?.id).toBe("1.2");
  });

  it("returns undefined when all stories are complete", () => {
    const prd = makePrd();
    for (const s of prd.userStories) s.passes = true;

    expect(pickNextStory(prd)).toBeUndefined();
  });

  it("sorts by priority even when stories are out of order", () => {
    const prd = makePrd({
      userStories: [
        makeStory({ id: "1.3", priority: 3 }),
        makeStory({ id: "1.1", priority: 1 }),
        makeStory({ id: "1.2", priority: 2 }),
      ],
    });

    const next = pickNextStory(prd);
    expect(next?.id).toBe("1.1");
  });
});

// ---------------------------------------------------------------------------
// markStoryPassed
// ---------------------------------------------------------------------------

describe("markStoryPassed", () => {
  it("sets passes to true for the matching story", () => {
    const prd = makePrd();
    expect(prd.userStories[0]!.passes).toBe(false);

    markStoryPassed(prd, "1.1");
    expect(prd.userStories[0]!.passes).toBe(true);
  });

  it("does not affect other stories", () => {
    const prd = makePrd();
    markStoryPassed(prd, "1.1");

    expect(prd.userStories[1]!.passes).toBe(false);
    expect(prd.userStories[2]!.passes).toBe(false);
  });

  it("is a no-op for unknown story IDs", () => {
    const prd = makePrd();
    markStoryPassed(prd, "99.99");

    for (const s of prd.userStories) {
      expect(s.passes).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// allStoriesComplete
// ---------------------------------------------------------------------------

describe("allStoriesComplete", () => {
  it("returns false when some stories are incomplete", () => {
    const prd = makePrd();
    expect(allStoriesComplete(prd)).toBe(false);
  });

  it("returns true when all stories pass", () => {
    const prd = makePrd();
    for (const s of prd.userStories) s.passes = true;

    expect(allStoriesComplete(prd)).toBe(true);
  });

  it("returns true for empty story list", () => {
    const prd = makePrd({ userStories: [] });
    expect(allStoriesComplete(prd)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatQualityFailure
// ---------------------------------------------------------------------------

describe("formatQualityFailure", () => {
  it("includes typecheck output when typecheck failed", () => {
    const result: QualityCheckResult = {
      passed: false,
      typecheckOutput: "error TS2345: Argument of type...",
    };

    const msg = formatQualityFailure(result);
    expect(msg).toContain("Quality checks FAILED");
    expect(msg).toContain("Typecheck");
    expect(msg).toContain("error TS2345");
  });

  it("includes test output when tests failed", () => {
    const result: QualityCheckResult = {
      passed: false,
      typecheckOutput: "ok",
      testOutput: "FAIL src/foo.test.ts",
    };

    const msg = formatQualityFailure(result);
    expect(msg).toContain("Tests");
    expect(msg).toContain("FAIL src/foo.test.ts");
  });

  it("includes reality check violations", () => {
    const result: QualityCheckResult = {
      passed: false,
      typecheckOutput: "ok",
      testOutput: "ok",
      realityCheck: {
        passed: false,
        violations: [{ file: "src/x.ts", line: 5, kind: "todo", text: "// TODO" }],
      },
    };

    const msg = formatQualityFailure(result);
    expect(msg).toContain("Reality Check");
    expect(msg).toContain("src/x.ts:5");
  });
});
