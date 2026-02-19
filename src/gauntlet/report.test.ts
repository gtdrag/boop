/**
 * Tests for gauntlet report generation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateGauntletReport, saveGauntletReport } from "./report.js";
import type { GauntletResult } from "./types.js";

describe("report", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-report-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeResult = (overrides?: Partial<GauntletResult>): GauntletResult => ({
    gauntletId: "gauntlet-v1",
    runId: "gauntlet-v1-2026-02-19",
    startedAt: "2026-02-19T10:00:00Z",
    completedAt: "2026-02-19T10:30:00Z",
    gitCommit: "abc1234567890",
    tiers: [
      {
        tierId: "t1-todo-app",
        level: 1,
        success: true,
        phaseReached: "REVIEWING",
        durationMs: 60000,
        errors: [],
        notes: [{ phase: "viability", category: "success", text: "Passed" }],
        tags: { post: "gauntlet/t1-todo-app-post" },
      },
    ],
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

  // --- generateGauntletReport ---
  it("generates a complete markdown report", () => {
    const report = generateGauntletReport(makeResult());

    expect(report).toContain("# Gauntlet Report: gauntlet-v1");
    expect(report).toContain("gauntlet-v1-2026-02-19");
    expect(report).toContain("abc1234567890");
    expect(report).toContain("## Summary");
    expect(report).toContain("## Tier Results");
    expect(report).toContain("## Tier Details");
    expect(report).toContain("## Git Tags");
    expect(report).toContain("t1-todo-app");
    expect(report).toContain("PASS");
  });

  it("includes evolution audit trail when steps exist", () => {
    const result = makeResult({
      evolutionSteps: [
        {
          tierId: "t1-todo-app",
          promptsChanged: ["viability/system.md"],
          heuristicsAdded: 2,
          archDecisionsAdded: 1,
          filesChanged: ["evolution-log.yaml"],
          approved: true,
          skipped: false,
        },
      ],
      summary: {
        totalTiers: 1,
        passed: 1,
        failed: 0,
        totalDurationMs: 60000,
        evolutionSteps: 1,
      },
    });

    const report = generateGauntletReport(result);
    expect(report).toContain("## Evolution Audit Trail");
    expect(report).toContain("viability/system.md");
    expect(report).toContain("**Heuristics added:** 2");
  });

  it("shows multiple tiers in result table", () => {
    const result = makeResult({
      tiers: [
        {
          tierId: "t1-todo-app",
          level: 1,
          success: true,
          phaseReached: "REVIEWING",
          durationMs: 30000,
          errors: [],
          notes: [],
          tags: { post: "gauntlet/t1-post" },
        },
        {
          tierId: "t2-notes-app",
          level: 2,
          success: false,
          phaseReached: "PLANNING",
          durationMs: 15000,
          errors: ["timeout"],
          notes: [],
          tags: { post: "gauntlet/t2-post" },
        },
      ],
      summary: {
        totalTiers: 2,
        passed: 1,
        failed: 1,
        totalDurationMs: 45000,
        evolutionSteps: 0,
      },
    });

    const report = generateGauntletReport(result);
    expect(report).toContain("t1-todo-app");
    expect(report).toContain("t2-notes-app");
    expect(report).toContain("FAIL");
  });

  // --- saveGauntletReport ---
  it("saves report to disk", () => {
    const result = makeResult();
    const reportPath = saveGauntletReport(result, tmpDir);

    expect(fs.existsSync(reportPath)).toBe(true);
    const content = fs.readFileSync(reportPath, "utf-8");
    expect(content).toContain("# Gauntlet Report");
  });

  it("creates output directory if it does not exist", () => {
    const result = makeResult();
    const outputDir = path.join(tmpDir, "nested", "output");
    const reportPath = saveGauntletReport(result, outputDir);

    expect(fs.existsSync(reportPath)).toBe(true);
  });
});
