import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockAnalyzeCodebase,
  mockGenerateImprovementPrd,
  mockRunLoopIteration,
  mockRunAdversarialLoop,
  mockGenerateAdversarialSummary,
  mockToReviewPhaseResult,
  mockRunEpicSignOff,
} = vi.hoisted(() => ({
  mockAnalyzeCodebase: vi.fn(),
  mockGenerateImprovementPrd: vi.fn(),
  mockRunLoopIteration: vi.fn(),
  mockRunAdversarialLoop: vi.fn(),
  mockGenerateAdversarialSummary: vi.fn(),
  mockToReviewPhaseResult: vi.fn(),
  mockRunEpicSignOff: vi.fn(),
}));

vi.mock("./analyzer.js", () => ({
  analyzeCodebase: mockAnalyzeCodebase,
}));

vi.mock("./planner.js", () => ({
  generateImprovementPrd: mockGenerateImprovementPrd,
}));

vi.mock("../build/ralph-loop.js", () => ({
  runLoopIteration: mockRunLoopIteration,
}));

vi.mock("../review/adversarial/loop.js", () => ({
  runAdversarialLoop: mockRunAdversarialLoop,
}));

vi.mock("../review/adversarial/summary.js", () => ({
  generateAdversarialSummary: mockGenerateAdversarialSummary,
  toReviewPhaseResult: mockToReviewPhaseResult,
}));

vi.mock("../pipeline/epic-loop.js", () => ({
  runEpicSignOff: mockRunEpicSignOff,
}));

vi.mock("../retrospective/analyzer.js", () => ({
  analyze: vi.fn(() => ({
    projectName: "test",
    totalEpics: 1,
    epics: [],
    codebasePatterns: [],
    overallMetrics: { totalStories: 0, totalFindings: 0, totalFixed: 0 },
  })),
}));

vi.mock("../retrospective/reporter.js", () => ({
  generateReport: vi.fn(() => "# Report"),
  saveReport: vi.fn(),
  formatSummary: vi.fn(() => "Summary"),
  buildMemoryEntries: vi.fn(() => []),
  saveMemory: vi.fn(),
}));

// Prevent messaging from loading real adapters
vi.mock("../channels/messaging.js", () => ({
  createMessagingDispatcher: () => ({
    enabled: false,
    notify: vi.fn(),
    initAdapter: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    createSignOffPrompt: vi.fn(),
  }),
  messagingConfigFromProfile: () => ({ channel: "none" }),
}));

// Prevent review rules from loading real files
vi.mock("../review/adversarial/review-rules.js", () => ({
  loadReviewRules: () => [],
}));

import { runImproveLoop } from "./runner.js";
import type { ImproveRunnerOptions } from "./runner.js";
import { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import type { DeveloperProfile } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_PROFILE: DeveloperProfile = {
  name: "Test Dev",
  languages: ["typescript"],
  frontendFramework: "next",
  backendFramework: "express",
  database: "postgresql",
  cloudProvider: "vercel",
  styling: "tailwind",
  stateManagement: "zustand",
  analytics: "posthog",
  ciCd: "github-actions",
  sourceControl: "github",
  packageManager: "pnpm",
  testRunner: "vitest",
  linter: "oxlint",
  projectStructure: "monorepo",
  aiModel: "claude-opus-4-6",
  autonomousByDefault: false,
};

function makeAnalysisResult(findingCount = 2) {
  const findings = Array.from({ length: findingCount }, (_, i) => ({
    id: `cod-${i + 1}`,
    source: "code-quality" as const,
    title: `Finding ${i + 1}`,
    severity: "high" as const,
    description: `Issue ${i + 1}`,
    file: `src/file${i + 1}.ts`,
  }));

  return {
    snapshot: {
      totalFiles: 10,
      languageBreakdown: { ".ts": 10 },
      totalLines: 1000,
      hasTests: true,
      hasTypecheck: true,
      dependencyCount: 5,
      fileTree: "  src/app.ts",
    },
    agentResults: [],
    verification: { verified: findings, discarded: [], stats: { total: findingCount, verified: findingCount, discarded: 0 } },
    verifiedFindings: findings,
  };
}

function makePrdResult(cycleNumber = 1, storyCount = 2) {
  return {
    prd: {
      project: "test",
      branchName: `improve/cycle-${cycleNumber}`,
      description: `Cycle ${cycleNumber}`,
      userStories: Array.from({ length: storyCount }, (_, i) => ({
        id: `imp-${cycleNumber}.${i + 1}`,
        title: `Fix ${i + 1}`,
        description: "Fix something",
        acceptanceCriteria: ["Done"],
        priority: i + 1,
        passes: false,
      })),
    },
    themes: { "code-quality": storyCount },
  };
}

function makeLoopResult(unresolvedCount = 0) {
  return {
    iterations: [{ iteration: 1 }],
    converged: unresolvedCount === 0,
    exitReason: unresolvedCount === 0 ? "converged" : "max-iterations",
    totalFindings: 2,
    totalFixed: 2 - unresolvedCount,
    totalDiscarded: 0,
    unresolvedFindings: Array.from({ length: unresolvedCount }, (_, i) => ({
      id: `cod-${i + 1}`,
      source: "code-quality",
      title: `Unresolved ${i + 1}`,
      severity: "high",
      description: "Still broken",
    })),
    allFixResults: [],
    deferredFindings: [],
  };
}

describe("improve runner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-improve-runner-test-"));

    mockAnalyzeCodebase.mockReset();
    mockGenerateImprovementPrd.mockReset();
    mockRunLoopIteration.mockReset();
    mockRunAdversarialLoop.mockReset();
    mockGenerateAdversarialSummary.mockReset();
    mockToReviewPhaseResult.mockReset();
    mockRunEpicSignOff.mockReset();

    // Default mocks
    mockAnalyzeCodebase.mockResolvedValue(makeAnalysisResult());
    mockGenerateImprovementPrd.mockResolvedValue(makePrdResult());
    mockRunLoopIteration.mockResolvedValue({ outcome: "no-stories", allComplete: true });
    mockRunAdversarialLoop.mockResolvedValue(makeLoopResult());
    mockToReviewPhaseResult.mockReturnValue({ epicNumber: 1, approved: true, findings: [] });
    mockRunEpicSignOff.mockResolvedValue({ approved: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeOptions(overrides?: Partial<ImproveRunnerOptions>): ImproveRunnerOptions {
    return {
      orchestrator: new PipelineOrchestrator(tmpDir, TEST_PROFILE),
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      maxDepth: 3,
      autonomous: true,
      ...overrides,
    };
  }

  it("runs a single cycle through ANALYZING → BUILDING → REVIEWING → SIGN_OFF", async () => {
    // Converge after 1 cycle (0 remaining)
    const opts = makeOptions({ maxDepth: 1 });
    const transitions: string[] = [];
    const origTransition = opts.orchestrator.transition.bind(opts.orchestrator);
    opts.orchestrator.transition = (phase) => {
      transitions.push(phase);
      origTransition(phase);
    };

    await runImproveLoop(opts);

    expect(transitions).toContain("ANALYZING");
    expect(transitions).toContain("BUILDING");
    expect(transitions).toContain("REVIEWING");
    expect(transitions).toContain("SIGN_OFF");
    expect(transitions).toContain("RETROSPECTIVE");
    expect(transitions).toContain("COMPLETE");
  });

  it("stops when analysis finds zero findings", async () => {
    mockAnalyzeCodebase.mockResolvedValue(makeAnalysisResult(0));

    await runImproveLoop(makeOptions({ maxDepth: 3 }));

    // Should not generate PRD or run build
    expect(mockGenerateImprovementPrd).not.toHaveBeenCalled();
    expect(mockRunLoopIteration).not.toHaveBeenCalled();
  });

  it("respects maxDepth", async () => {
    // Return findings with remaining > threshold so it doesn't converge
    mockRunAdversarialLoop.mockResolvedValue(makeLoopResult(5));
    mockAnalyzeCodebase
      .mockResolvedValueOnce(makeAnalysisResult(5))
      .mockResolvedValueOnce(makeAnalysisResult(4));
    mockGenerateImprovementPrd
      .mockResolvedValueOnce(makePrdResult(1))
      .mockResolvedValueOnce(makePrdResult(2));

    await runImproveLoop(makeOptions({ maxDepth: 2 }));

    // Should have called analyzeCodebase twice (2 cycles)
    expect(mockAnalyzeCodebase).toHaveBeenCalledTimes(2);
  });

  it("propagates focus to analyzer", async () => {
    await runImproveLoop(makeOptions({ focus: "security" }));

    expect(mockAnalyzeCodebase).toHaveBeenCalledWith(
      tmpDir,
      expect.objectContaining({ focus: "security" }),
    );
  });

  it("passes previousFindingIds to planner on second cycle", async () => {
    // First cycle fixes cod-1 and cod-2, second cycle runs
    mockRunAdversarialLoop
      .mockResolvedValueOnce(makeLoopResult(3)) // 3 remaining
      .mockResolvedValueOnce(makeLoopResult(0)); // converged

    mockAnalyzeCodebase
      .mockResolvedValueOnce(makeAnalysisResult(5))
      .mockResolvedValueOnce(makeAnalysisResult(3));

    mockGenerateImprovementPrd
      .mockResolvedValueOnce(makePrdResult(1))
      .mockResolvedValueOnce(makePrdResult(2));

    await runImproveLoop(makeOptions({ maxDepth: 3 }));

    // Second call should include previousFindingIds
    const secondCallOptions = mockGenerateImprovementPrd.mock.calls[1]?.[4];
    expect(secondCallOptions?.previousFindingIds).toBeDefined();
    expect(secondCallOptions?.cycleNumber).toBe(2);
  });

  it("runs retrospective after all cycles", async () => {
    await runImproveLoop(makeOptions({ maxDepth: 1 }));

    // Final state should be COMPLETE
    const opts = makeOptions();
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
    expect(orch.getState().phase).toBe("COMPLETE");
  });

  it("calls onProgress callback", async () => {
    const events: string[] = [];
    await runImproveLoop(
      makeOptions({
        maxDepth: 1,
        onProgress: (phase, msg) => events.push(`${phase}: ${msg}`),
      }),
    );

    expect(events.some((e) => e.startsWith("IMPROVE:"))).toBe(true);
    expect(events.some((e) => e.startsWith("ANALYZING:"))).toBe(true);
    expect(events.some((e) => e.startsWith("BUILDING:"))).toBe(true);
    expect(events.some((e) => e.startsWith("RETROSPECTIVE:"))).toBe(true);
  });

  it("saves convergence state to disk", async () => {
    await runImproveLoop(makeOptions({ maxDepth: 1 }));

    const convPath = path.join(tmpDir, ".boop", "convergence.json");
    expect(fs.existsSync(convPath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(convPath, "utf-8"));
    expect(saved.cycles).toHaveLength(1);
  });
});
