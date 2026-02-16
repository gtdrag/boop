import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { PipelineState } from "../shared/types.js";
import { defaultState, loadState, saveState, stateFilePath } from "./state.js";

describe("state", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-state-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("defaultState", () => {
    it("returns IDLE phase with zeroed fields", () => {
      const state = defaultState();
      expect(state.phase).toBe("IDLE");
      expect(state.epicNumber).toBe(0);
      expect(state.currentStory).toBeNull();
      expect(state.lastCompletedStep).toBeNull();
      expect(state.scaffoldingComplete).toBe(false);
      expect(state.updatedAt).toBeTruthy();
    });
  });

  describe("stateFilePath", () => {
    it("returns .boop/state.yaml under the project dir", () => {
      const fp = stateFilePath("/some/project");
      expect(fp).toBe(path.join("/some/project", ".boop", "state.yaml"));
    });
  });

  describe("loadState", () => {
    it("returns null when file does not exist", () => {
      expect(loadState(tmpDir)).toBeNull();
    });

    it("reads previously saved state", () => {
      const state: PipelineState = {
        phase: "BUILDING",
        epicNumber: 2,
        currentStory: "2.1",
        lastCompletedStep: "compile",
        scaffoldingComplete: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      saveState(tmpDir, state);

      const loaded = loadState(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.phase).toBe("BUILDING");
      expect(loaded!.epicNumber).toBe(2);
      expect(loaded!.currentStory).toBe("2.1");
      expect(loaded!.scaffoldingComplete).toBe(true);
    });
  });

  describe("saveState", () => {
    it("creates .boop/ directory if it doesn't exist", () => {
      saveState(tmpDir, defaultState());
      expect(fs.existsSync(path.join(tmpDir, ".boop"))).toBe(true);
    });

    it("writes valid YAML", () => {
      const state = defaultState();
      saveState(tmpDir, state);

      const raw = fs.readFileSync(stateFilePath(tmpDir), "utf-8");
      const parsed = parse(raw) as PipelineState;
      expect(parsed.phase).toBe("IDLE");
    });

    it("updates the updatedAt timestamp", () => {
      const state: PipelineState = {
        ...defaultState(),
        updatedAt: "2020-01-01T00:00:00.000Z",
      };
      saveState(tmpDir, state);

      const loaded = loadState(tmpDir);
      expect(loaded!.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    });

    it("does not leave .tmp files after write", () => {
      saveState(tmpDir, defaultState());
      const boopDir = path.join(tmpDir, ".boop");
      const files = fs.readdirSync(boopDir);
      expect(files).not.toContain("state.yaml.tmp");
    });
  });
});
