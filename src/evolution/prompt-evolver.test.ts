import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BenchmarkResult, BenchmarkCaseResult, PhaseMetrics } from "../benchmark/types.js";

const mockSendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: JSON.stringify({
      content: "Improved prompt content here.",
      rationale: "Clarified instructions for better output.",
      targetWeaknesses: ["ambiguous instructions"],
    }),
    usage: { inputTokens: 100, outputTokens: 200 },
    model: "claude-opus-4-6",
  }),
);

vi.mock("../shared/index.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: () => false,
  retry: (fn: () => Promise<unknown>) => fn(),
}));

import {
  generateProposals,
  validateProposal,
  promoteProposal,
  runEvolution,
} from "./prompt-evolver.js";

function makeBenchmarkResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  const phaseMetrics: PhaseMetrics = {
    phase: "viability",
    success: true,
    durationMs: 100,
    tokenUsage: { inputTokens: 50, outputTokens: 50 },
    retryCount: 0,
  };
  const caseResult: BenchmarkCaseResult = {
    caseId: "test-case",
    success: true,
    lastPhaseReached: "stories",
    mode: "dry-run",
    totalDurationMs: 400,
    phases: [
      phaseMetrics,
      { ...phaseMetrics, phase: "prd" },
      { ...phaseMetrics, phase: "architecture" },
      { ...phaseMetrics, phase: "stories" },
    ],
    totalTokenUsage: { inputTokens: 200, outputTokens: 200 },
    totalRetries: 0,
    expectationResults: [],
  };
  return {
    suiteId: "smoke",
    startedAt: "2025-01-01T00:00:00Z",
    completedAt: "2025-01-01T00:01:00Z",
    gitCommit: "abc1234",
    boopVersion: "0.1.0",
    mode: "dry-run",
    cases: [caseResult],
    summary: { totalCases: 1, passed: 1, failed: 0, totalDurationMs: 400, totalTokenUsage: { inputTokens: 200, outputTokens: 200 }, totalRetries: 0 },
    ...overrides,
  };
}

describe("prompt-evolver", () => {
  let tmpDir: string;
  let promptsDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-evolver-"));
    promptsDir = path.join(tmpDir, "prompts");
    memoryDir = path.join(tmpDir, "memory");
    // Create prompt files for each phase
    for (const phase of ["viability", "prd", "architecture", "stories"]) {
      const dir = path.join(promptsDir, phase);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "system.md"), `Original ${phase} prompt content.`);
    }
    mockSendMessage.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("generateProposals", () => {
    it("generates proposals for specified phases", async () => {
      const baseline = makeBenchmarkResult();
      const proposals = await generateProposals(baseline, ["viability"], {
        promptsDir,
      });
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.phase).toBe("viability");
      expect(proposals[0]!.content).toBe("Improved prompt content here.");
    });

    it("skips phases with missing prompt files", async () => {
      fs.rmSync(path.join(promptsDir, "prd"), { recursive: true, force: true });
      const baseline = makeBenchmarkResult();
      const proposals = await generateProposals(baseline, ["prd"], {
        promptsDir,
      });
      expect(proposals).toHaveLength(0);
    });

    it("handles Claude returning invalid JSON gracefully", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: "Sorry, I cannot help with that.",
        usage: { inputTokens: 10, outputTokens: 10 },
        model: "claude-opus-4-6",
      });
      const baseline = makeBenchmarkResult();
      const proposals = await generateProposals(baseline, ["viability"], {
        promptsDir,
      });
      expect(proposals).toHaveLength(0);
    });
  });

  describe("validateProposal", () => {
    it("returns null when no regressions", async () => {
      const baseline = makeBenchmarkResult();
      const proposal = {
        phase: "viability" as const,
        content: "New prompt content",
        rationale: "Better",
        targetWeaknesses: [],
      };
      const result = await validateProposal(proposal, baseline, {
        promptsDir,
        runBenchmark: async () => makeBenchmarkResult(),
      });
      expect(result).toBeNull();
    });

    it("returns reason string when regressions found", async () => {
      const baseline = makeBenchmarkResult();
      const proposal = {
        phase: "viability" as const,
        content: "New prompt content",
        rationale: "Better",
        targetWeaknesses: [],
      };
      const regressedResult = makeBenchmarkResult({
        cases: [{
          ...makeBenchmarkResult().cases[0]!,
          success: false,
        }],
      });
      const result = await validateProposal(proposal, baseline, {
        promptsDir,
        runBenchmark: async () => regressedResult,
      });
      expect(result).toContain("Regressions");
    });

    it("restores original prompt after validation", async () => {
      const baseline = makeBenchmarkResult();
      const originalContent = fs.readFileSync(
        path.join(promptsDir, "viability", "system.md"),
        "utf-8",
      );
      const proposal = {
        phase: "viability" as const,
        content: "Modified content",
        rationale: "Test",
        targetWeaknesses: [],
      };
      await validateProposal(proposal, baseline, {
        promptsDir,
        runBenchmark: async () => makeBenchmarkResult(),
      });
      const afterContent = fs.readFileSync(
        path.join(promptsDir, "viability", "system.md"),
        "utf-8",
      );
      expect(afterContent).toBe(originalContent);
    });
  });

  describe("promoteProposal", () => {
    it("writes new content to prompt file and saves version", () => {
      const proposal = {
        phase: "viability" as const,
        content: "Promoted prompt content",
        rationale: "Better clarity",
        targetWeaknesses: [],
      };
      const version = promoteProposal(proposal, { promptsDir, memoryDir });
      expect(version.phase).toBe("viability");
      expect(version.version).toBe(1);

      const written = fs.readFileSync(
        path.join(promptsDir, "viability", "system.md"),
        "utf-8",
      );
      expect(written).toBe("Promoted prompt content");
    });
  });

  describe("runEvolution", () => {
    it("generates, validates, and promotes proposals", async () => {
      const baseline = makeBenchmarkResult();
      const result = await runEvolution(baseline, ["viability"], {
        promptsDir,
        memoryDir,
        runBenchmark: async () => makeBenchmarkResult(),
      });
      expect(result.proposals).toHaveLength(1);
      expect(result.promoted).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
      expect(result.versions).toHaveLength(1);
    });

    it("rejects proposals that cause regressions", async () => {
      const baseline = makeBenchmarkResult();
      const regressedResult = makeBenchmarkResult({
        cases: [{
          ...makeBenchmarkResult().cases[0]!,
          success: false,
        }],
      });
      const result = await runEvolution(baseline, ["viability"], {
        promptsDir,
        memoryDir,
        runBenchmark: async () => regressedResult,
      });
      expect(result.promoted).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });
  });
});
