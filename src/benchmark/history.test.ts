import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  saveResult,
  loadResult,
  loadIndex,
  listRuns,
  getLatestRun,
  generateRunId,
  resolveBenchmarksDir,
} from "./history.js";
import type { BenchmarkResult } from "./types.js";

function makeSampleResult(suiteId = "smoke", startedAt = "2026-02-18T14:30:00.000Z"): BenchmarkResult {
  return {
    suiteId,
    startedAt,
    completedAt: "2026-02-18T14:30:05.000Z",
    gitCommit: "abc1234",
    boopVersion: "0.1.0",
    mode: "dry-run",
    cases: [
      {
        caseId: "case-1",
        success: true,
        lastPhaseReached: "stories",
        mode: "dry-run",
        totalDurationMs: 100,
        phases: [],
        totalTokenUsage: { inputTokens: 500, outputTokens: 1000 },
        totalRetries: 0,
        expectationResults: [],
      },
    ],
    summary: {
      totalCases: 1,
      passed: 1,
      failed: 0,
      totalDurationMs: 100,
      totalTokenUsage: { inputTokens: 500, outputTokens: 1000 },
      totalRetries: 0,
    },
  };
}

describe("history", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-history-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("generateRunId", () => {
    it("generates an ID from suite and timestamp", () => {
      const runId = generateRunId("smoke", "2026-02-18T14:30:00.000Z");
      expect(runId).toBe("smoke-2026-02-18-14-30-00");
    });
  });

  describe("resolveBenchmarksDir", () => {
    it("uses ~/.boop/benchmarks/ by default", () => {
      const dir = resolveBenchmarksDir();
      expect(dir).toBe(path.join(os.homedir(), ".boop", "benchmarks"));
    });

    it("uses custom dir when provided", () => {
      const dir = resolveBenchmarksDir("/custom");
      expect(dir).toBe(path.join("/custom", "benchmarks"));
    });
  });

  describe("saveResult", () => {
    it("writes JSON, markdown, and updates index", () => {
      const result = makeSampleResult();
      const runId = saveResult(result, tmpDir);

      expect(runId).toBe("smoke-2026-02-18-14-30-00");

      // Check JSON file exists
      const jsonPath = path.join(tmpDir, "benchmarks", "runs", `${runId}.json`);
      expect(fs.existsSync(jsonPath)).toBe(true);

      const json = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(json.suiteId).toBe("smoke");

      // Check markdown file exists
      const mdPath = path.join(tmpDir, "benchmarks", "runs", `${runId}.md`);
      expect(fs.existsSync(mdPath)).toBe(true);

      const md = fs.readFileSync(mdPath, "utf-8");
      expect(md).toContain("# Benchmark Scorecard: smoke");

      // Check index
      const index = loadIndex(tmpDir);
      expect(index).toHaveLength(1);
      expect(index[0]!.runId).toBe(runId);
      expect(index[0]!.suiteId).toBe("smoke");
    });

    it("appends to existing index", () => {
      saveResult(makeSampleResult("smoke", "2026-02-18T14:30:00.000Z"), tmpDir);
      saveResult(makeSampleResult("smoke", "2026-02-18T15:00:00.000Z"), tmpDir);

      const index = loadIndex(tmpDir);
      expect(index).toHaveLength(2);
    });
  });

  describe("loadResult", () => {
    it("loads a saved result by run ID", () => {
      const original = makeSampleResult();
      const runId = saveResult(original, tmpDir);

      const loaded = loadResult(runId, tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.suiteId).toBe("smoke");
      expect(loaded!.cases).toHaveLength(1);
    });

    it("returns null for unknown run ID", () => {
      expect(loadResult("nonexistent", tmpDir)).toBeNull();
    });
  });

  describe("listRuns", () => {
    it("lists all runs", () => {
      saveResult(makeSampleResult("smoke", "2026-02-18T14:30:00.000Z"), tmpDir);
      saveResult(makeSampleResult("planning-only", "2026-02-18T15:00:00.000Z"), tmpDir);

      const runs = listRuns(tmpDir);
      expect(runs).toHaveLength(2);
    });

    it("filters by suite ID", () => {
      saveResult(makeSampleResult("smoke", "2026-02-18T14:30:00.000Z"), tmpDir);
      saveResult(makeSampleResult("planning-only", "2026-02-18T15:00:00.000Z"), tmpDir);

      const runs = listRuns(tmpDir, "smoke");
      expect(runs).toHaveLength(1);
      expect(runs[0]!.suiteId).toBe("smoke");
    });

    it("returns empty array when no index exists", () => {
      expect(listRuns(tmpDir)).toEqual([]);
    });
  });

  describe("getLatestRun", () => {
    it("returns the most recent run for a suite", () => {
      saveResult(makeSampleResult("smoke", "2026-02-18T14:30:00.000Z"), tmpDir);
      saveResult(makeSampleResult("smoke", "2026-02-18T15:00:00.000Z"), tmpDir);

      const latest = getLatestRun("smoke", tmpDir);
      expect(latest).not.toBeNull();
      expect(latest!.runId).toBe("smoke-2026-02-18-15-00-00");
    });

    it("returns null for suite with no runs", () => {
      expect(getLatestRun("nonexistent", tmpDir)).toBeNull();
    });
  });
});
