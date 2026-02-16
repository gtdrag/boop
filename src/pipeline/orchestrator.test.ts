import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeveloperProfile } from "../shared/types.js";
import { PipelineOrchestrator } from "./orchestrator.js";

const TEST_PROFILE: DeveloperProfile = {
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

describe("PipelineOrchestrator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-orch-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("starts with IDLE state when no state file exists", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      expect(orch.getState().phase).toBe("IDLE");
    });

    it("loads existing state from disk", () => {
      // Create a pipeline and save state
      const orch1 = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch1.startEpic(1);
      orch1.transition("PLANNING");

      // New orchestrator should load the saved state
      const orch2 = new PipelineOrchestrator(tmpDir);
      expect(orch2.getState().phase).toBe("PLANNING");
      expect(orch2.getState().epicNumber).toBe(1);
    });
  });

  describe("transition", () => {
    it("transitions from IDLE to PLANNING", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.transition("PLANNING");
      expect(orch.getState().phase).toBe("PLANNING");
    });

    it("follows the full phase sequence", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.transition("PLANNING");
      orch.transition("BRIDGING");
      orch.transition("SCAFFOLDING");
      orch.transition("BUILDING");
      orch.transition("REVIEWING");
      orch.transition("SIGN_OFF");
      orch.transition("COMPLETE");
      expect(orch.getState().phase).toBe("COMPLETE");
    });

    it("throws on invalid transition", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      expect(() => orch.transition("BUILDING")).toThrow(
        "Invalid transition: IDLE → BUILDING",
      );
    });

    it("allows BRIDGING → BUILDING when scaffolding is already complete", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.transition("PLANNING");
      orch.transition("BRIDGING");
      orch.completeScaffolding();
      // Should allow skipping SCAFFOLDING
      orch.transition("BUILDING");
      expect(orch.getState().phase).toBe("BUILDING");
    });

    it("prevents SCAFFOLDING when already complete", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.transition("PLANNING");
      orch.transition("BRIDGING");
      orch.completeScaffolding();
      expect(() => orch.transition("SCAFFOLDING")).toThrow(
        "SCAFFOLDING already complete",
      );
    });

    it("persists state to disk after transition", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.transition("PLANNING");

      // Verify file exists
      const fp = path.join(tmpDir, ".boop", "state.yaml");
      expect(fs.existsSync(fp)).toBe(true);
    });
  });

  describe("advance", () => {
    it("moves to the next phase in sequence", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.advance(); // IDLE → PLANNING
      expect(orch.getState().phase).toBe("PLANNING");
      orch.advance(); // PLANNING → BRIDGING
      expect(orch.getState().phase).toBe("BRIDGING");
    });

    it("skips SCAFFOLDING when already complete", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.transition("PLANNING");
      orch.transition("BRIDGING");
      orch.completeScaffolding();
      orch.advance(); // BRIDGING → should skip SCAFFOLDING → BUILDING
      expect(orch.getState().phase).toBe("BUILDING");
    });

    it("throws when already COMPLETE", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.transition("PLANNING");
      orch.transition("BRIDGING");
      orch.transition("SCAFFOLDING");
      orch.transition("BUILDING");
      orch.transition("REVIEWING");
      orch.transition("SIGN_OFF");
      orch.transition("COMPLETE");
      expect(() => orch.advance()).toThrow("already COMPLETE");
    });
  });

  describe("startEpic", () => {
    it("resets phase to IDLE and sets epic number", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.transition("PLANNING");
      orch.startEpic(3);
      expect(orch.getState().phase).toBe("IDLE");
      expect(orch.getState().epicNumber).toBe(3);
    });

    it("clears currentStory and lastCompletedStep", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.setCurrentStory("1.2");
      orch.setLastCompletedStep("compile");
      orch.startEpic(2);
      expect(orch.getState().currentStory).toBeNull();
      expect(orch.getState().lastCompletedStep).toBeNull();
    });
  });

  describe("setCurrentStory / setLastCompletedStep", () => {
    it("updates currentStory", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.setCurrentStory("1.4");
      expect(orch.getState().currentStory).toBe("1.4");
    });

    it("updates lastCompletedStep", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.setLastCompletedStep("typecheck");
      expect(orch.getState().lastCompletedStep).toBe("typecheck");
    });
  });

  describe("reset", () => {
    it("returns to default IDLE state", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.startEpic(2);
      orch.transition("PLANNING");
      orch.setCurrentStory("2.1");
      orch.reset();

      const state = orch.getState();
      expect(state.phase).toBe("IDLE");
      expect(state.epicNumber).toBe(0);
      expect(state.currentStory).toBeNull();
    });
  });

  describe("formatStatus", () => {
    it("shows 'no active pipeline' when in default state", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      expect(orch.formatStatus()).toContain("No active pipeline");
    });

    it("shows phase and epic for an active pipeline", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.startEpic(1);
      orch.transition("PLANNING");
      const status = orch.formatStatus();
      expect(status).toContain("PLANNING");
      expect(status).toContain("1");
    });

    it("includes story when set", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.startEpic(1);
      orch.setCurrentStory("1.3");
      const status = orch.formatStatus();
      expect(status).toContain("1.3");
    });
  });

  describe("formatResumeContext", () => {
    it("shows 'no interrupted pipeline' when in default state", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      expect(orch.formatResumeContext()).toContain(
        "No interrupted pipeline to resume",
      );
    });

    it("shows full context for an active pipeline", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.startEpic(1);
      orch.transition("PLANNING");
      orch.setCurrentStory("1.2");
      orch.setLastCompletedStep("parse-prd");

      const ctx = orch.formatResumeContext();
      expect(ctx).toContain("PLANNING");
      expect(ctx).toContain("1.2");
      expect(ctx).toContain("parse-prd");
      expect(ctx).toContain("Continue from this point?");
    });
  });

  describe("profile integration", () => {
    it("returns null from getProfile when no profile provided", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      expect(orch.getProfile()).toBeNull();
    });

    it("returns profile from getProfile when provided", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      expect(orch.getProfile()).toEqual(TEST_PROFILE);
    });

    it("requireProfile throws when no profile is loaded", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      expect(() => orch.requireProfile()).toThrow("No developer profile found");
    });

    it("requireProfile returns profile when loaded", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      expect(orch.requireProfile()).toEqual(TEST_PROFILE);
    });

    it("transition from IDLE to PLANNING throws without profile", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      expect(() => orch.transition("PLANNING")).toThrow(
        "No developer profile found",
      );
    });

    it("transition from IDLE to PLANNING succeeds with profile", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.transition("PLANNING");
      expect(orch.getState().phase).toBe("PLANNING");
    });

    it("advance from IDLE throws without profile", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      expect(() => orch.advance()).toThrow("No developer profile found");
    });

    it("advance from IDLE succeeds with profile", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.advance();
      expect(orch.getState().phase).toBe("PLANNING");
    });

    it("formatStatus includes profile name when profile is loaded", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.startEpic(1);
      orch.transition("PLANNING");
      const status = orch.formatStatus();
      expect(status).toContain("Test Dev");
    });

    it("formatStatus omits profile line when no profile", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.startEpic(1);
      // Cannot transition without profile, so test the IDLE-with-epic status
      const status = orch.formatStatus();
      expect(status).not.toContain("Profile:");
    });

    it("formatResumeContext includes profile name when profile is loaded", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.startEpic(1);
      orch.transition("PLANNING");
      orch.setCurrentStory("1.1");
      const ctx = orch.formatResumeContext();
      expect(ctx).toContain("Test Dev");
    });

    it("formatResumeContext omits profile line when no profile", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.startEpic(1);
      const ctx = orch.formatResumeContext();
      expect(ctx).not.toContain("Profile:");
    });

    it("profile is available to all pipeline phases (full traversal)", () => {
      const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
      orch.transition("PLANNING");
      expect(orch.getProfile()?.name).toBe("Test Dev");
      orch.transition("BRIDGING");
      expect(orch.getProfile()?.frontendFramework).toBe("next");
      orch.transition("SCAFFOLDING");
      expect(orch.getProfile()?.database).toBe("postgresql");
      orch.transition("BUILDING");
      expect(orch.getProfile()?.cloudProvider).toBe("vercel");
      orch.transition("REVIEWING");
      expect(orch.getProfile()?.testRunner).toBe("vitest");
      orch.transition("SIGN_OFF");
      expect(orch.getProfile()?.linter).toBe("oxlint");
      orch.transition("COMPLETE");
      expect(orch.getProfile()).toEqual(TEST_PROFILE);
    });
  });
});
