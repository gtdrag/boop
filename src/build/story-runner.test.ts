import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Story, Prd } from "../shared/types.js";
import { buildSystemPrompt, buildStoryPrompt, runStory } from "./story-runner.js";

// ---------------------------------------------------------------------------
// Mock child_process.spawnSync for runStory tests
// ---------------------------------------------------------------------------

const mockSpawnSync = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    stdout: "Story implemented successfully.",
    stderr: "",
    status: 0,
    error: null,
  }),
);

vi.mock("node:child_process", () => ({
  spawnSync: mockSpawnSync,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-runner-"));
  mockSpawnSync.mockReset();
  mockSpawnSync.mockReturnValue({
    stdout: "Story implemented successfully.",
    stderr: "",
    status: 0,
    error: null,
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "1.1",
    title: "Test story",
    description: "As a developer, I want tests.",
    acceptanceCriteria: ["Given X, then Y", "Typecheck passes", "All tests pass"],
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
    userStories: [makeStory()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  it("includes project name from PRD", () => {
    const prd = makePrd({ project: "MyApp" });
    const prompt = buildSystemPrompt(prd, tmpDir);

    expect(prompt).toContain("MyApp");
  });

  it("includes CLAUDE.md content when file exists", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Project Rules\nDo X.\n");

    const prompt = buildSystemPrompt(makePrd(), tmpDir);
    expect(prompt).toContain("# Project Rules");
    expect(prompt).toContain("Do X.");
  });

  it("uses fallback when CLAUDE.md does not exist", () => {
    const prompt = buildSystemPrompt(makePrd(), tmpDir);
    expect(prompt).toContain("No CLAUDE.md found");
  });

  it("includes progress.txt content when file exists", () => {
    const boopDir = path.join(tmpDir, ".boop");
    fs.mkdirSync(boopDir, { recursive: true });
    fs.writeFileSync(path.join(boopDir, "progress.txt"), "## Story 1.0 done\n");

    const prompt = buildSystemPrompt(makePrd(), tmpDir);
    expect(prompt).toContain("## Story 1.0 done");
  });

  it("uses fallback when progress.txt does not exist", () => {
    const prompt = buildSystemPrompt(makePrd(), tmpDir);
    expect(prompt).toContain("No progress.txt yet");
  });

  it("includes PRD branch name", () => {
    const prd = makePrd({ branchName: "ralph/epic-5" });
    const prompt = buildSystemPrompt(prd, tmpDir);
    expect(prompt).toContain("ralph/epic-5");
  });

  it("instructs agent not to commit", () => {
    const prompt = buildSystemPrompt(makePrd(), tmpDir);
    expect(prompt).toContain("Do NOT commit");
  });
});

// ---------------------------------------------------------------------------
// buildStoryPrompt
// ---------------------------------------------------------------------------

describe("buildStoryPrompt", () => {
  it("includes story ID and title", () => {
    const prompt = buildStoryPrompt(makeStory({ id: "2.3", title: "Build feature" }));
    expect(prompt).toContain("Story 2.3: Build feature");
  });

  it("includes description", () => {
    const prompt = buildStoryPrompt(makeStory({ description: "As a user, I want X." }));
    expect(prompt).toContain("As a user, I want X.");
  });

  it("includes all acceptance criteria numbered", () => {
    const story = makeStory({
      acceptanceCriteria: ["Criterion A", "Criterion B", "Criterion C"],
    });
    const prompt = buildStoryPrompt(story);

    expect(prompt).toContain("1. Criterion A");
    expect(prompt).toContain("2. Criterion B");
    expect(prompt).toContain("3. Criterion C");
  });

  it("includes notes when present", () => {
    const story = makeStory({ notes: "Use Express for the server." });
    const prompt = buildStoryPrompt(story);
    expect(prompt).toContain("Use Express for the server.");
  });

  it("omits notes section when not present", () => {
    const story = makeStory();
    delete story.notes;
    const prompt = buildStoryPrompt(story);
    expect(prompt).not.toContain("Implementation Notes");
  });

  it("includes priority", () => {
    const story = makeStory({ priority: 42 });
    const prompt = buildStoryPrompt(story);
    expect(prompt).toContain("42");
  });
});

// ---------------------------------------------------------------------------
// runStory
// ---------------------------------------------------------------------------

describe("runStory", () => {
  it("spawns claude with --print and --dangerously-skip-permissions", async () => {
    await runStory(makeStory(), makePrd(), { projectDir: tmpDir });

    expect(mockSpawnSync).toHaveBeenCalledOnce();
    const [cmd, args] = mockSpawnSync.mock.calls[0]!;
    expect(cmd).toBe("claude");
    expect(args).toContain("--print");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--no-session-persistence");
  });

  it("pipes the combined prompt via stdin", async () => {
    await runStory(makeStory(), makePrd({ project: "FooApp" }), { projectDir: tmpDir });

    const [, , spawnOpts] = mockSpawnSync.mock.calls[0]!;
    expect(spawnOpts.input).toContain("FooApp");
    expect(spawnOpts.input).toContain("Story 1.1");
  });

  it("runs in the project directory", async () => {
    await runStory(makeStory(), makePrd(), { projectDir: tmpDir });

    const [, , spawnOpts] = mockSpawnSync.mock.calls[0]!;
    expect(spawnOpts.cwd).toBe(tmpDir);
  });

  it("passes --model when specified", async () => {
    await runStory(makeStory(), makePrd(), {
      projectDir: tmpDir,
      model: "claude-sonnet-4-5-20250929",
    });

    const [, args] = mockSpawnSync.mock.calls[0]!;
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-5-20250929");
  });

  it("does not pass --model when not specified", async () => {
    await runStory(makeStory(), makePrd(), { projectDir: tmpDir });

    const [, args] = mockSpawnSync.mock.calls[0]!;
    expect(args).not.toContain("--model");
  });

  it("returns the story and CLI output", async () => {
    mockSpawnSync.mockReturnValue({
      stdout: "Files created, tests passing.",
      stderr: "",
      status: 0,
      error: null,
    });

    const result = await runStory(makeStory({ id: "3.1", title: "Custom story" }), makePrd(), {
      projectDir: tmpDir,
    });

    expect(result.story.id).toBe("3.1");
    expect(result.output).toBe("Files created, tests passing.");
  });

  it("throws descriptive error when claude is not found (ENOENT)", async () => {
    mockSpawnSync.mockReturnValue({
      stdout: "",
      stderr: "",
      status: null,
      error: new Error("spawnSync claude ENOENT"),
    });

    await expect(runStory(makeStory(), makePrd(), { projectDir: tmpDir })).rejects.toThrow(
      "Claude CLI not found",
    );
  });

  it("throws timeout error on ETIMEDOUT", async () => {
    mockSpawnSync.mockReturnValue({
      stdout: "",
      stderr: "",
      status: null,
      error: new Error("spawnSync ETIMEDOUT"),
    });

    await expect(
      runStory(makeStory({ id: "2.1" }), makePrd(), { projectDir: tmpDir }),
    ).rejects.toThrow("timed out");
  });

  it("throws on non-zero exit code with stderr", async () => {
    mockSpawnSync.mockReturnValue({
      stdout: "",
      stderr: "Authentication failed",
      status: 1,
      error: null,
    });

    await expect(runStory(makeStory(), makePrd(), { projectDir: tmpDir })).rejects.toThrow(
      "exited with code 1: Authentication failed",
    );
  });

  it("throws on non-zero exit code without stderr", async () => {
    mockSpawnSync.mockReturnValue({
      stdout: "",
      stderr: "",
      status: 2,
      error: null,
    });

    await expect(runStory(makeStory(), makePrd(), { projectDir: tmpDir })).rejects.toThrow(
      "exited with code 2",
    );
  });

  it("uses custom timeout", async () => {
    await runStory(makeStory(), makePrd(), {
      projectDir: tmpDir,
      timeout: 120_000,
    });

    const [, , spawnOpts] = mockSpawnSync.mock.calls[0]!;
    expect(spawnOpts.timeout).toBe(120_000);
  });

  it("uses default timeout of 600s when not specified", async () => {
    await runStory(makeStory(), makePrd(), { projectDir: tmpDir });

    const [, , spawnOpts] = mockSpawnSync.mock.calls[0]!;
    expect(spawnOpts.timeout).toBe(600_000);
  });
});
