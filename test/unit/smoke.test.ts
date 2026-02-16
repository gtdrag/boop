/**
 * Smoke test — verifies that key modules from src/ can be imported
 * and their primary exports are available and functional.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { VERSION } from "../../src/version.js";
import {
  createLogger,
  Logger,
  PIPELINE_PHASES,
  retry,
  RetryError,
} from "../../src/shared/index.js";
import { buildProgram, handleCli } from "../../src/cli/program.js";
import { listChannels, isValidChannel } from "../../src/channels/registry.js";
import { PipelineOrchestrator } from "../../src/pipeline/orchestrator.js";
import { defaultState, loadState, saveState } from "../../src/pipeline/state.js";
import { initGlobalConfig } from "../../src/config/index.js";

let tmpDir: string | undefined;

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("smoke test — src/ imports", () => {
  it("exports VERSION as a semver-like string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exports shared utilities", () => {
    expect(typeof createLogger).toBe("function");
    expect(Logger).toBeDefined();
    expect(typeof retry).toBe("function");
    expect(RetryError).toBeDefined();
    expect(Array.isArray(PIPELINE_PHASES)).toBe(true);
    expect(PIPELINE_PHASES.length).toBeGreaterThan(0);
  });

  it("exports CLI entry points", () => {
    expect(typeof buildProgram).toBe("function");
    expect(typeof handleCli).toBe("function");
  });

  it("exports channel registry", () => {
    expect(typeof listChannels).toBe("function");
    expect(typeof isValidChannel).toBe("function");

    const channels = listChannels();
    expect(channels.length).toBe(2);

    const ids = channels.map((c) => c.id);
    expect(ids).toContain("whatsapp");
    expect(ids).toContain("telegram");
  });

  it("exports pipeline state module", () => {
    expect(typeof defaultState).toBe("function");
    expect(typeof loadState).toBe("function");
    expect(typeof saveState).toBe("function");

    const state = defaultState();
    expect(state.phase).toBe("IDLE");
    expect(state.epicNumber).toBe(0);
  });

  it("exports pipeline orchestrator", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-smoke-"));
    expect(PipelineOrchestrator).toBeDefined();
    const orch = new PipelineOrchestrator(tmpDir);
    expect(orch.getState().phase).toBe("IDLE");
  });

  it("exports config module", () => {
    expect(typeof initGlobalConfig).toBe("function");
  });
});
