import { describe, expect, it } from "vitest";
import { PIPELINE_PHASES } from "./types.js";
import type { PipelineState, DeveloperProfile, Story, Prd, LogEntry } from "./types.js";

describe("types", () => {
  it("PIPELINE_PHASES contains all phases in order", () => {
    expect(PIPELINE_PHASES).toEqual([
      "IDLE",
      "PLANNING",
      "BRIDGING",
      "SCAFFOLDING",
      "BUILDING",
      "REVIEWING",
      "SIGN_OFF",
      "DEPLOYING",
      "RETROSPECTIVE",
      "COMPLETE",
    ]);
  });

  it("PipelineState shape can be constructed", () => {
    const state: PipelineState = {
      phase: "BUILDING",
      epicNumber: 1,
      currentStory: "1.3",
      lastCompletedStep: null,
      scaffoldingComplete: false,
      updatedAt: new Date().toISOString(),
    };
    expect(state.phase).toBe("BUILDING");
    expect(state.epicNumber).toBe(1);
    expect(state.currentStory).toBe("1.3");
  });

  it("DeveloperProfile shape can be constructed", () => {
    const profile: DeveloperProfile = {
      name: "Test Dev",
      languages: ["typescript"],
      frontendFramework: "next",
      backendFramework: "express",
      database: "postgresql",
      cloudProvider: "vercel",
      styling: "tailwind",
      stateManagement: "zustand",
      analytics: "posthog",
      ciCd: "github-actions",
      packageManager: "pnpm",
      testRunner: "vitest",
      linter: "oxlint",
      projectStructure: "monorepo",
      aiModel: "claude-opus-4-6",
      autonomousByDefault: false,
    };
    expect(profile.name).toBe("Test Dev");
    expect(profile.languages).toContain("typescript");
    expect(profile.frontendFramework).toBe("next");
    expect(profile.database).toBe("postgresql");
    expect(profile.projectStructure).toBe("monorepo");
  });

  it("Story shape can be constructed", () => {
    const story: Story = {
      id: "1.3",
      title: "Shared utilities",
      description: "As a developer...",
      acceptanceCriteria: ["Logger works", "Retry works"],
      priority: 3,
      passes: false,
    };
    expect(story.id).toBe("1.3");
    expect(story.passes).toBe(false);
  });

  it("Prd shape can be constructed", () => {
    const prd: Prd = {
      project: "Boop",
      branchName: "ralph/epic-1-foundation",
      description: "Epic 1",
      userStories: [],
    };
    expect(prd.project).toBe("Boop");
    expect(prd.userStories).toHaveLength(0);
  });

  it("LogEntry shape can be constructed", () => {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level: "info",
      phase: "BUILDING",
      epic: "1",
      story: "1.3",
      msg: "hello",
    };
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("hello");
  });
});
