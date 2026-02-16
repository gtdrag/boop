import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PipelineOrchestrator } from "./orchestrator.js";

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
      const orch1 = new PipelineOrchestrator(tmpDir);
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
      const orch = new PipelineOrchestrator(tmpDir);
      orch.transition("PLANNING");
      expect(orch.getState().phase).toBe("PLANNING");
    });

    it("follows the full phase sequence", () => {
      const orch = new PipelineOrchestrator(tmpDir);
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
      const orch = new PipelineOrchestrator(tmpDir);
      expect(() => orch.transition("BUILDING")).toThrow(
        "Invalid transition: IDLE → BUILDING",
      );
    });

    it("allows BRIDGING → BUILDING when scaffolding is already complete", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.transition("PLANNING");
      orch.transition("BRIDGING");
      orch.completeScaffolding();
      // Should allow skipping SCAFFOLDING
      orch.transition("BUILDING");
      expect(orch.getState().phase).toBe("BUILDING");
    });

    it("prevents SCAFFOLDING when already complete", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.transition("PLANNING");
      orch.transition("BRIDGING");
      orch.completeScaffolding();
      expect(() => orch.transition("SCAFFOLDING")).toThrow(
        "SCAFFOLDING already complete",
      );
    });

    it("persists state to disk after transition", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.transition("PLANNING");

      // Verify file exists
      const fp = path.join(tmpDir, ".boop", "state.yaml");
      expect(fs.existsSync(fp)).toBe(true);
    });
  });

  describe("advance", () => {
    it("moves to the next phase in sequence", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.advance(); // IDLE → PLANNING
      expect(orch.getState().phase).toBe("PLANNING");
      orch.advance(); // PLANNING → BRIDGING
      expect(orch.getState().phase).toBe("BRIDGING");
    });

    it("skips SCAFFOLDING when already complete", () => {
      const orch = new PipelineOrchestrator(tmpDir);
      orch.transition("PLANNING");
      orch.transition("BRIDGING");
      orch.completeScaffolding();
      orch.advance(); // BRIDGING → should skip SCAFFOLDING → BUILDING
      expect(orch.getState().phase).toBe("BUILDING");
    });

    it("throws when already COMPLETE", () => {
      const orch = new PipelineOrchestrator(tmpDir);
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
      const orch = new PipelineOrchestrator(tmpDir);
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
      const orch = new PipelineOrchestrator(tmpDir);
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
      const orch = new PipelineOrchestrator(tmpDir);
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
      const orch = new PipelineOrchestrator(tmpDir);
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
});
