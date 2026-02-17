/**
 * Integration tests for the full pipeline flow.
 *
 * Exercises the complete phase progression with mocked external dependencies:
 *   IDLE → PLANNING → BRIDGING → SCAFFOLDING → BUILDING → REVIEWING → SIGN_OFF → COMPLETE
 *
 * Unlike unit tests (which test individual functions in isolation), these tests
 * verify that data flows correctly between phases and the state machine advances
 * properly through the entire pipeline.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Hoisted mocks (survive vi.resetAllMocks) ----

const {
  mockRunLoopIteration,
  mockRunAdversarialLoop,
  mockGenerateAdversarialSummary,
  mockToReviewPhaseResult,
  mockRunEpicSignOff,
  mockDeploy,
  mockAnalyze,
  mockGenerateReport,
  mockSaveReport,
  mockBuildMemoryEntries,
  mockSaveMemory,
  mockFormatSummary,
} = vi.hoisted(() => ({
  mockRunLoopIteration: vi.fn(),
  mockRunAdversarialLoop: vi.fn(),
  mockGenerateAdversarialSummary: vi.fn(),
  mockToReviewPhaseResult: vi.fn(),
  mockRunEpicSignOff: vi.fn(),
  mockDeploy: vi.fn(),
  mockAnalyze: vi.fn(),
  mockGenerateReport: vi.fn(),
  mockSaveReport: vi.fn(),
  mockBuildMemoryEntries: vi.fn(),
  mockSaveMemory: vi.fn(),
  mockFormatSummary: vi.fn(),
}));

// ---- Module mocks ----

vi.mock("../../src/build/ralph-loop.js", () => ({
  runLoopIteration: mockRunLoopIteration,
}));

vi.mock("../../src/review/adversarial/loop.js", () => ({
  runAdversarialLoop: mockRunAdversarialLoop,
}));

vi.mock("../../src/review/adversarial/summary.js", () => ({
  generateAdversarialSummary: mockGenerateAdversarialSummary,
  toReviewPhaseResult: mockToReviewPhaseResult,
}));

vi.mock("../../src/pipeline/epic-loop.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/pipeline/epic-loop.js")>();
  return {
    ...actual,
    runEpicSignOff: mockRunEpicSignOff,
  };
});

vi.mock("../../src/deployment/deployer.js", () => ({
  deploy: mockDeploy,
}));

vi.mock("../../src/retrospective/reporter.js", () => ({
  analyze: mockAnalyze,
  generateReport: mockGenerateReport,
  saveReport: mockSaveReport,
  buildMemoryEntries: mockBuildMemoryEntries,
  saveMemory: mockSaveMemory,
  formatSummary: mockFormatSummary,
}));

vi.mock("../../src/retrospective/analyzer.js", () => ({
  analyze: mockAnalyze,
}));

// Mock child_process for test suite runner and other modules
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn().mockReturnValue("All tests passed"),
    spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: "ok", stderr: "" }),
    execFileSync: vi.fn().mockReturnValue(""),
  };
});

// ---- Imports ----

import { runFullPipeline } from "../../src/pipeline/runner.js";
import { PipelineOrchestrator } from "../../src/pipeline/orchestrator.js";
import type { DeveloperProfile } from "../../src/shared/types.js";

// ---- Test helpers ----

const STORIES_MARKDOWN = `# Epic & Story Breakdown

## Epic 1: Foundation
**Goal:** Set up the project foundation.
**Scope:** Project init

### Story 1.1: Initialize project
**As a** developer, **I want** to initialize the project, **so that** I have a working base.

**Acceptance Criteria:**
- Given a fresh checkout, when I run pnpm install, then it succeeds
- Typecheck passes
- All tests pass

**Prerequisites:** None

**Technical Notes:**
- Set up TypeScript config
- Add basic test

---
`;

function makeProfile(): DeveloperProfile {
  return {
    name: "Test User",
    languages: ["typescript"],
    frontendFramework: "react",
    backendFramework: "express",
    database: "postgresql",
    cloudProvider: "none",
    styling: "tailwind",
    stateManagement: "zustand",
    analytics: "none",
    ciCd: "github-actions",
    packageManager: "pnpm",
    testRunner: "vitest",
    linter: "eslint",
    projectStructure: "feature",
    errorTracker: "none",
    aiModel: "claude-opus-4-6",
    autonomousByDefault: false,
  };
}

function makeReviewResult() {
  return {
    epicNumber: 1,
    parallelResults: [],
    fixCycleResults: [],
    blockingIssues: [],
    summary: "All clean",
    approved: true,
  };
}

// ---- Tests ----

describe("Pipeline integration flow", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-integration-"));
    fs.mkdirSync(path.join(projectDir, ".boop"), { recursive: true });

    // Reset all mocks
    vi.clearAllMocks();

    // Build loop: first call returns "passed", second returns "no-stories" (all complete)
    mockRunLoopIteration
      .mockResolvedValueOnce({
        outcome: "passed",
        story: { id: "1.1", title: "Init" },
        allComplete: true,
      });

    // Adversarial review: converges with zero findings
    mockRunAdversarialLoop.mockResolvedValue({
      iterations: [],
      converged: true,
      exitReason: "converged",
      totalFindings: 0,
      totalFixed: 0,
      totalDiscarded: 0,
      unresolvedFindings: [],
      allFixResults: [],
    });

    mockGenerateAdversarialSummary.mockReturnValue({
      markdown: "# Review Summary\nAll clean.",
      allResolved: true,
      savedPath: path.join(projectDir, ".boop", "reviews", "summary.md"),
    });

    mockToReviewPhaseResult.mockReturnValue(makeReviewResult());

    // Sign-off: auto-approve
    mockRunEpicSignOff.mockResolvedValue({ approved: true });

    // Retrospective
    mockAnalyze.mockReturnValue({
      projectDir,
      projectName: "test-project",
      totalEpics: 1,
      metrics: {},
    });
    mockGenerateReport.mockReturnValue("# Retrospective Report");
    mockSaveReport.mockReturnValue(undefined);
    mockBuildMemoryEntries.mockReturnValue([]);
    mockSaveMemory.mockReturnValue(undefined);
    mockFormatSummary.mockReturnValue("Pipeline complete.");
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("completes full pipeline: BRIDGING → SCAFFOLDING → BUILDING → REVIEWING → SIGN_OFF → COMPLETE", async () => {
    const profile = makeProfile();
    const orch = new PipelineOrchestrator(projectDir, profile);
    const phases: string[] = [];

    await runFullPipeline({
      orchestrator: orch,
      projectDir,
      profile,
      storiesMarkdown: STORIES_MARKDOWN,
      autonomous: true,
      onProgress: (phase) => {
        if (!phases.includes(phase)) phases.push(phase);
      },
    });

    // Verify all phases were visited in order
    expect(phases).toContain("BRIDGING");
    expect(phases).toContain("SCAFFOLDING");
    expect(phases).toContain("BUILDING");
    expect(phases).toContain("REVIEWING");
    expect(phases).toContain("SIGN_OFF");
    expect(phases).toContain("COMPLETE");

    // Verify phase order
    const bridgingIdx = phases.indexOf("BRIDGING");
    const scaffoldingIdx = phases.indexOf("SCAFFOLDING");
    const buildingIdx = phases.indexOf("BUILDING");
    const reviewingIdx = phases.indexOf("REVIEWING");
    const signOffIdx = phases.indexOf("SIGN_OFF");

    expect(bridgingIdx).toBeLessThan(scaffoldingIdx);
    expect(scaffoldingIdx).toBeLessThan(buildingIdx);
    expect(buildingIdx).toBeLessThan(reviewingIdx);
    expect(reviewingIdx).toBeLessThan(signOffIdx);
  });

  it("creates prd.json during BRIDGING phase", async () => {
    const profile = makeProfile();
    const orch = new PipelineOrchestrator(projectDir, profile);

    await runFullPipeline({
      orchestrator: orch,
      projectDir,
      profile,
      storiesMarkdown: STORIES_MARKDOWN,
      autonomous: true,
    });

    const prdPath = path.join(projectDir, ".boop", "prd.json");
    expect(fs.existsSync(prdPath)).toBe(true);

    const prd = JSON.parse(fs.readFileSync(prdPath, "utf-8"));
    expect(prd.branchName).toBe("epic-1");
    expect(prd.userStories).toBeDefined();
    expect(prd.userStories.length).toBeGreaterThan(0);
  });

  it("passes sandboxed flag through to build loop", async () => {
    const profile = makeProfile();
    const orch = new PipelineOrchestrator(projectDir, profile);

    await runFullPipeline({
      orchestrator: orch,
      projectDir,
      profile,
      storiesMarkdown: STORIES_MARKDOWN,
      autonomous: true,
      sandboxed: true,
    });

    // Verify sandboxed was passed to runLoopIteration
    expect(mockRunLoopIteration).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxed: true }),
    );
  });

  it("calls adversarial review after build completes", async () => {
    const profile = makeProfile();
    const orch = new PipelineOrchestrator(projectDir, profile);

    await runFullPipeline({
      orchestrator: orch,
      projectDir,
      profile,
      storiesMarkdown: STORIES_MARKDOWN,
      autonomous: true,
    });

    expect(mockRunAdversarialLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir,
        epicNumber: 1,
      }),
    );
    expect(mockGenerateAdversarialSummary).toHaveBeenCalled();
    expect(mockToReviewPhaseResult).toHaveBeenCalledWith(1, expect.anything());
  });

  it("passes review result to sign-off", async () => {
    const profile = makeProfile();
    const orch = new PipelineOrchestrator(projectDir, profile);

    await runFullPipeline({
      orchestrator: orch,
      projectDir,
      profile,
      storiesMarkdown: STORIES_MARKDOWN,
      autonomous: true,
    });

    expect(mockRunEpicSignOff).toHaveBeenCalledWith(
      expect.objectContaining({
        epicNumber: 1,
        reviewResult: makeReviewResult(),
        autonomous: true,
      }),
    );
  });

  it("stops pipeline on build failure", async () => {
    mockRunLoopIteration.mockReset();
    mockRunLoopIteration.mockResolvedValue({
      outcome: "failed",
      story: { id: "1.1", title: "Init" },
      error: "Test compilation failed",
      allComplete: false,
    });

    const profile = makeProfile();
    const orch = new PipelineOrchestrator(projectDir, profile);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runFullPipeline({
      orchestrator: orch,
      projectDir,
      profile,
      storiesMarkdown: STORIES_MARKDOWN,
      autonomous: true,
    });

    // Review should NOT have been called
    expect(mockRunAdversarialLoop).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("stops pipeline on sign-off rejection in non-autonomous mode", async () => {
    mockRunEpicSignOff.mockResolvedValue({ approved: false });

    const profile = makeProfile();
    const orch = new PipelineOrchestrator(projectDir, profile);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runFullPipeline({
      orchestrator: orch,
      projectDir,
      profile,
      storiesMarkdown: STORIES_MARKDOWN,
      autonomous: false,
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("not approved"),
    );
    logSpy.mockRestore();
  });

  it("scaffolding only runs on first epic", async () => {
    // Complete the first epic so scaffolding is marked done
    const profile = makeProfile();
    const orch = new PipelineOrchestrator(projectDir, profile);
    const phases: string[] = [];

    await runFullPipeline({
      orchestrator: orch,
      projectDir,
      profile,
      storiesMarkdown: STORIES_MARKDOWN,
      autonomous: true,
      onProgress: (phase) => phases.push(phase),
    });

    // Count how many times SCAFFOLDING appears
    const scaffoldingCount = phases.filter((p) => p === "SCAFFOLDING").length;
    expect(scaffoldingCount).toBeGreaterThan(0); // At least once

    // If we ran again with the same orchestrator (already scaffolded),
    // scaffolding should be skipped — verified by checking state
    const state = orch.getState();
    expect(state.scaffoldingComplete).toBe(true);
  });

  it("state machine reaches COMPLETE at end of successful pipeline", async () => {
    const profile = makeProfile();
    const orch = new PipelineOrchestrator(projectDir, profile);

    await runFullPipeline({
      orchestrator: orch,
      projectDir,
      profile,
      storiesMarkdown: STORIES_MARKDOWN,
      autonomous: true,
    });

    const state = orch.getState();
    expect(state.phase).toBe("COMPLETE");
  });
});
