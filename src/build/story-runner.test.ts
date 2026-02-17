import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Story, Prd } from "../shared/types.js";
import { buildSystemPrompt, buildStoryPrompt, runStory } from "./story-runner.js";

// ---------------------------------------------------------------------------
// Mock the claude-client module
// ---------------------------------------------------------------------------

const mockSendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: "Implementation complete.",
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "claude-opus-4-6-20250929",
  }),
);

vi.mock("../shared/claude-client.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: (error: unknown) => {
    if (error && typeof error === "object" && "status" in error) {
      const status = (error as { status: number }).status;
      return status === 429 || status >= 500;
    }
    return false;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-runner-"));
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue({
    text: "Implementation complete.",
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "claude-opus-4-6-20250929",
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
  it("calls sendMessage with system prompt and story message", async () => {
    const story = makeStory();
    const prd = makePrd();

    await runStory(story, prd, { projectDir: tmpDir });

    expect(mockSendMessage).toHaveBeenCalledOnce();

    const [options, systemPrompt, messages] = mockSendMessage.mock.calls[0]!;
    expect(options.maxTokens).toBe(16384);
    expect(systemPrompt).toContain("TestProject");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("Story 1.1");
  });

  it("returns the story and response text", async () => {
    const story = makeStory({ id: "3.1", title: "Custom story" });
    const result = await runStory(story, makePrd(), { projectDir: tmpDir });

    expect(result.story.id).toBe("3.1");
    expect(result.text).toBe("Implementation complete.");
    expect(result.response.model).toBe("claude-opus-4-6-20250929");
  });

  it("uses custom client options", async () => {
    await runStory(makeStory(), makePrd(), {
      projectDir: tmpDir,
      clientOptions: { model: "claude-sonnet-4-5-20250929", maxTokens: 8192 },
    });

    const [options] = mockSendMessage.mock.calls[0]!;
    expect(options.model).toBe("claude-sonnet-4-5-20250929");
    // Custom maxTokens from clientOptions overrides the runner's default
    expect(options.maxTokens).toBe(8192);
  });

  it("propagates API errors when not retryable", async () => {
    mockSendMessage.mockRejectedValue(new Error("Bad request"));

    // With maxRetries: 0, the retry wrapper wraps the error in a RetryError
    await expect(
      runStory(makeStory(), makePrd(), {
        projectDir: tmpDir,
        retryOptions: { maxRetries: 0 },
      }),
    ).rejects.toThrow("All 1 attempts failed");
  });
});
