import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCaseDryRun, runSuite, getGitCommit } from "./runner.js";
import type { BenchmarkCase, BenchmarkSuite } from "./types.js";

describe("runner", () => {
  let tmpDir: string;
  let fixturesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-runner-"));
    fixturesDir = path.join(tmpDir, "benchmarks", "fixtures", "mock-responses");
    fs.mkdirSync(fixturesDir, { recursive: true });

    fs.writeFileSync(
      path.join(fixturesDir, "viability-proceed.md"),
      "# Viability\n\n**PROCEED**\n\nThis is a good idea.",
    );
    fs.writeFileSync(
      path.join(fixturesDir, "prd-basic.md"),
      "# PRD\n\nBasic requirements document.",
    );
    fs.writeFileSync(
      path.join(fixturesDir, "architecture-basic.md"),
      "# Architecture\n\nBasic architecture.",
    );
    fs.writeFileSync(
      path.join(fixturesDir, "stories-1-epic.md"),
      "# Stories\n\n## Epic 1\n\nStory 1.1: Setup",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getGitCommit", () => {
    it("returns a non-empty string", () => {
      const commit = getGitCommit();
      expect(commit.length).toBeGreaterThan(0);
    });
  });

  describe("runCaseDryRun", () => {
    it("runs a case through all planning phases", async () => {
      const benchmarkCase: BenchmarkCase = {
        id: "test-1",
        label: "Test Case",
        idea: "a simple todo app",
        complexity: "trivial",
        stopAfter: "PLANNING",
      };

      const result = await runCaseDryRun(benchmarkCase, tmpDir);

      expect(result.caseId).toBe("test-1");
      expect(result.success).toBe(true);
      expect(result.mode).toBe("dry-run");
      expect(result.lastPhaseReached).toBe("stories");
      expect(result.phases).toHaveLength(4);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.totalTokenUsage.inputTokens).toBeGreaterThan(0);
      expect(result.totalTokenUsage.outputTokens).toBeGreaterThan(0);
      expect(result.terminalError).toBeUndefined();
    });

    it("evaluates expectations correctly", async () => {
      const benchmarkCase: BenchmarkCase = {
        id: "test-exp",
        label: "Expectation Test",
        idea: "a todo app",
        complexity: "trivial",
        stopAfter: "PLANNING",
        expectations: [
          { metric: "success", expected: true },
          { metric: "viability_recommendation", expected: "PROCEED" },
          { metric: "phase_reached", expected: "stories" },
        ],
      };

      const result = await runCaseDryRun(benchmarkCase, tmpDir);

      expect(result.expectationResults).toHaveLength(3);
      expect(result.expectationResults.every((e) => e.passed)).toBe(true);
    });

    it("reports progress via callback", async () => {
      const progress: string[] = [];
      const benchmarkCase: BenchmarkCase = {
        id: "test-progress",
        label: "Progress Test",
        idea: "test",
        complexity: "trivial",
        stopAfter: "PLANNING",
      };

      await runCaseDryRun(benchmarkCase, tmpDir, (caseId, phase, status) => {
        progress.push(`${caseId}:${phase}:${status}`);
      });

      expect(progress).toContain("test-progress:viability:starting");
      expect(progress).toContain("test-progress:viability:completed");
      expect(progress).toContain("test-progress:stories:completed");
    });

    it("handles missing fixtures gracefully", async () => {
      // Remove a fixture
      fs.unlinkSync(path.join(fixturesDir, "prd-basic.md"));

      const benchmarkCase: BenchmarkCase = {
        id: "test-missing",
        label: "Missing Fixture",
        idea: "test",
        complexity: "trivial",
        stopAfter: "PLANNING",
      };

      const result = await runCaseDryRun(benchmarkCase, tmpDir);

      expect(result.success).toBe(false);
      expect(result.terminalError).toContain("Mock fixture not found");
      expect(result.lastPhaseReached).toBe("viability");
    });
  });

  describe("runSuite", () => {
    it("runs all cases in a suite and returns a BenchmarkResult", async () => {
      const suite: BenchmarkSuite = {
        id: "test-suite",
        name: "Test Suite",
        description: "test",
        mode: "dry-run",
        cases: [
          {
            id: "case-1",
            label: "Case 1",
            idea: "idea 1",
            complexity: "trivial",
            stopAfter: "PLANNING",
          },
          {
            id: "case-2",
            label: "Case 2",
            idea: "idea 2",
            complexity: "simple",
            stopAfter: "PLANNING",
          },
        ],
      };

      const result = await runSuite(suite, { projectRoot: tmpDir });

      expect(result.suiteId).toBe("test-suite");
      expect(result.mode).toBe("dry-run");
      expect(result.cases).toHaveLength(2);
      expect(result.summary.totalCases).toBe(2);
      expect(result.summary.passed).toBe(2);
      expect(result.summary.failed).toBe(0);
      expect(result.boopVersion).toBeDefined();
      expect(result.gitCommit).toBeDefined();
      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
    });

    it("allows mode override", async () => {
      const suite: BenchmarkSuite = {
        id: "live-suite",
        name: "Live Suite",
        description: "test",
        mode: "live",
        cases: [
          {
            id: "case-1",
            label: "Case 1",
            idea: "idea 1",
            complexity: "trivial",
            stopAfter: "PLANNING",
          },
        ],
      };

      // Override to dry-run to avoid real API calls
      const result = await runSuite(suite, { projectRoot: tmpDir, mode: "dry-run" });
      expect(result.mode).toBe("dry-run");
      expect(result.cases[0]!.success).toBe(true);
    });

    it("computes summary with failures", async () => {
      // Remove a fixture to force failure
      fs.unlinkSync(path.join(fixturesDir, "viability-proceed.md"));

      const suite: BenchmarkSuite = {
        id: "fail-suite",
        name: "Fail Suite",
        description: "test",
        mode: "dry-run",
        cases: [
          {
            id: "case-1",
            label: "Failing Case",
            idea: "idea",
            complexity: "trivial",
            stopAfter: "PLANNING",
          },
        ],
      };

      const result = await runSuite(suite, { projectRoot: tmpDir });
      expect(result.summary.passed).toBe(0);
      expect(result.summary.failed).toBe(1);
    });
  });
});
