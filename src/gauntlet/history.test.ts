/**
 * Tests for gauntlet history persistence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateRunId,
  saveGauntletResult,
  loadGauntletResult,
  loadGauntletIndex,
  listGauntletRuns,
  getLatestGauntletRun,
  resolveGauntletHistoryDir,
} from "./history.js";
import type { GauntletResult } from "./types.js";

describe("history", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-history-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeResult = (overrides?: Partial<GauntletResult>): GauntletResult => ({
    gauntletId: "gauntlet-v1",
    runId: "gauntlet-v1-2026-02-19-10-00-00",
    startedAt: "2026-02-19T10:00:00Z",
    completedAt: "2026-02-19T10:30:00Z",
    gitCommit: "abc1234",
    tiers: [],
    evolutionSteps: [],
    summary: {
      totalTiers: 1,
      passed: 1,
      failed: 0,
      totalDurationMs: 60000,
      evolutionSteps: 0,
    },
    ...overrides,
  });

  // --- resolveGauntletHistoryDir ---
  it("resolves to ~/.boop/gauntlet by default", () => {
    const dir = resolveGauntletHistoryDir();
    expect(dir).toBe(path.join(os.homedir(), ".boop", "gauntlet"));
  });

  it("resolves to custom dir when provided", () => {
    const dir = resolveGauntletHistoryDir("/custom");
    expect(dir).toBe(path.join("/custom", "gauntlet"));
  });

  // --- generateRunId ---
  it("generates a run ID from gauntlet ID and timestamp", () => {
    const runId = generateRunId("gauntlet-v1", "2026-02-19T10:30:45Z");
    expect(runId).toBe("gauntlet-v1-2026-02-19-10-30-45");
  });

  // --- saveGauntletResult ---
  it("saves result and creates JSON + MD files", () => {
    const result = makeResult();
    const runId = saveGauntletResult(result, tmpDir);

    expect(runId).toBe(result.runId);

    const jsonPath = path.join(tmpDir, "gauntlet", "runs", `${runId}.json`);
    const mdPath = path.join(tmpDir, "gauntlet", "runs", `${runId}.md`);
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);
  });

  it("updates the index after saving", () => {
    const result = makeResult();
    saveGauntletResult(result, tmpDir);

    const index = loadGauntletIndex(tmpDir);
    expect(index).toHaveLength(1);
    expect(index[0]!.runId).toBe(result.runId);
    expect(index[0]!.gauntletId).toBe("gauntlet-v1");
  });

  // --- loadGauntletResult ---
  it("loads a saved result by run ID", () => {
    const result = makeResult();
    saveGauntletResult(result, tmpDir);

    const loaded = loadGauntletResult(result.runId, tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.gauntletId).toBe("gauntlet-v1");
    expect(loaded!.runId).toBe(result.runId);
  });

  it("returns null for non-existent run ID", () => {
    const loaded = loadGauntletResult("nonexistent", tmpDir);
    expect(loaded).toBeNull();
  });

  // --- loadGauntletIndex ---
  it("returns empty array when no index exists", () => {
    const index = loadGauntletIndex(tmpDir);
    expect(index).toEqual([]);
  });

  // --- listGauntletRuns ---
  it("lists all runs", () => {
    saveGauntletResult(makeResult(), tmpDir);
    saveGauntletResult(
      makeResult({
        runId: "gauntlet-v1-2026-02-20-10-00-00",
        startedAt: "2026-02-20T10:00:00Z",
      }),
      tmpDir,
    );

    const runs = listGauntletRuns(tmpDir);
    expect(runs).toHaveLength(2);
  });

  it("filters runs by gauntlet ID", () => {
    saveGauntletResult(makeResult(), tmpDir);
    saveGauntletResult(
      makeResult({
        gauntletId: "gauntlet-v2",
        runId: "gauntlet-v2-2026-02-20-10-00-00",
      }),
      tmpDir,
    );

    const v1Runs = listGauntletRuns(tmpDir, "gauntlet-v1");
    expect(v1Runs).toHaveLength(1);
    expect(v1Runs[0]!.gauntletId).toBe("gauntlet-v1");
  });

  // --- getLatestGauntletRun ---
  it("returns the latest run", () => {
    saveGauntletResult(makeResult(), tmpDir);
    saveGauntletResult(
      makeResult({
        runId: "gauntlet-v1-2026-02-20-10-00-00",
        startedAt: "2026-02-20T10:00:00Z",
      }),
      tmpDir,
    );

    const latest = getLatestGauntletRun("gauntlet-v1", tmpDir);
    expect(latest).not.toBeNull();
    expect(latest!.runId).toBe("gauntlet-v1-2026-02-20-10-00-00");
  });

  it("returns null when no runs exist", () => {
    const latest = getLatestGauntletRun("gauntlet-v1", tmpDir);
    expect(latest).toBeNull();
  });
});
