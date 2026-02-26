import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConvergenceState,
  recordCycle,
  shouldStop,
  formatTrend,
  saveConvergenceState,
  loadConvergenceState,
} from "./convergence.js";
import type { CycleResult, ConvergenceState } from "./convergence.js";

describe("convergence", () => {
  describe("createConvergenceState", () => {
    it("creates empty state with given maxDepth", () => {
      const state = createConvergenceState(3);
      expect(state.cycles).toEqual([]);
      expect(state.maxDepth).toBe(3);
      expect(state.threshold).toBe(2);
    });

    it("allows custom threshold", () => {
      const state = createConvergenceState(5, 0);
      expect(state.threshold).toBe(0);
    });
  });

  describe("recordCycle", () => {
    it("appends a cycle result", () => {
      const state = createConvergenceState(3);
      const result: CycleResult = {
        cycle: 1,
        totalFindings: 10,
        fixed: 7,
        remaining: 3,
        timestamp: "2026-01-01T00:00:00Z",
      };
      recordCycle(state, result);
      expect(state.cycles).toHaveLength(1);
      expect(state.cycles[0]).toEqual(result);
    });
  });

  describe("shouldStop", () => {
    it("returns continue when no cycles", () => {
      const state = createConvergenceState(3);
      const decision = shouldStop(state);
      expect(decision.stop).toBe(false);
      expect(decision.reason).toBe("no-cycles");
    });

    it("stops at max-depth", () => {
      const state = createConvergenceState(2);
      recordCycle(state, { cycle: 1, totalFindings: 10, fixed: 5, remaining: 5, timestamp: "" });
      recordCycle(state, { cycle: 2, totalFindings: 8, fixed: 4, remaining: 4, timestamp: "" });
      const decision = shouldStop(state);
      expect(decision.stop).toBe(true);
      expect(decision.reason).toBe("max-depth");
    });

    it("stops when converged (remaining <= threshold)", () => {
      const state = createConvergenceState(5, 2);
      recordCycle(state, { cycle: 1, totalFindings: 5, fixed: 3, remaining: 2, timestamp: "" });
      const decision = shouldStop(state);
      expect(decision.stop).toBe(true);
      expect(decision.reason).toBe("converged");
    });

    it("stops on diminishing returns (same remaining count)", () => {
      const state = createConvergenceState(5);
      recordCycle(state, { cycle: 1, totalFindings: 10, fixed: 5, remaining: 5, timestamp: "" });
      recordCycle(state, { cycle: 2, totalFindings: 8, fixed: 3, remaining: 5, timestamp: "" });
      const decision = shouldStop(state);
      expect(decision.stop).toBe(true);
      expect(decision.reason).toBe("diminishing-returns");
    });

    it("continues when findings are decreasing", () => {
      const state = createConvergenceState(5);
      recordCycle(state, { cycle: 1, totalFindings: 10, fixed: 5, remaining: 5, timestamp: "" });
      recordCycle(state, { cycle: 2, totalFindings: 6, fixed: 3, remaining: 3, timestamp: "" });
      const decision = shouldStop(state);
      expect(decision.stop).toBe(false);
      expect(decision.reason).toBe("continue");
    });

    it("max-depth takes priority over other conditions", () => {
      const state = createConvergenceState(1, 10);
      recordCycle(state, { cycle: 1, totalFindings: 5, fixed: 3, remaining: 2, timestamp: "" });
      const decision = shouldStop(state);
      expect(decision.stop).toBe(true);
      expect(decision.reason).toBe("max-depth");
    });
  });

  describe("formatTrend", () => {
    it("returns 'no cycles' message for empty state", () => {
      const state = createConvergenceState(3);
      expect(formatTrend(state)).toContain("No cycles completed");
    });

    it("formats cycle data as a table", () => {
      const state = createConvergenceState(3);
      recordCycle(state, { cycle: 1, totalFindings: 10, fixed: 7, remaining: 3, timestamp: "" });
      recordCycle(state, { cycle: 2, totalFindings: 5, fixed: 3, remaining: 2, timestamp: "" });
      const output = formatTrend(state);
      expect(output).toContain("Cycle");
      expect(output).toContain("Findings");
      expect(output).toContain("Fixed");
      expect(output).toContain("Remaining");
    });
  });

  describe("save/load round-trip", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-conv-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("saves and loads convergence state", () => {
      const state = createConvergenceState(3, 1);
      recordCycle(state, {
        cycle: 1,
        totalFindings: 8,
        fixed: 5,
        remaining: 3,
        timestamp: "2026-01-01T00:00:00Z",
      });

      saveConvergenceState(tmpDir, state);
      const loaded = loadConvergenceState(tmpDir);

      expect(loaded).toEqual(state);
    });

    it("returns null when no file exists", () => {
      const loaded = loadConvergenceState(tmpDir);
      expect(loaded).toBeNull();
    });
  });
});
