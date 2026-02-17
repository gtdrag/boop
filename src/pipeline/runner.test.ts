import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperProfile } from "../shared/types.js";
import { PipelineOrchestrator } from "./orchestrator.js";

// ---------------------------------------------------------------------------
// Hoisted mocks — external I/O modules called by runner.ts
// ---------------------------------------------------------------------------

const {
  mockParseStoryMarkdown,
  mockConvertToPrd,
  mockSavePrd,
  mockScaffoldProject,
  mockGenerateSeoDefaults,
  mockGenerateAnalyticsDefaults,
  mockGenerateAccessibilityDefaults,
  mockGenerateSecurityHeaderDefaults,
  mockGenerateDeploymentDefaults,
  mockRunLoopIteration,
  mockRunAdversarialLoop,
  mockGenerateAdversarialSummary,
  mockToReviewPhaseResult,
  mockCreateRefactoringAgent,
  mockCreateTestHardener,
  mockCreateSecurityScanner,
  mockCreateQaSmokeTest,
  mockRunEpicSignOff,
  mockAnalyze,
  mockGenerateReport,
  mockSaveReport,
  mockBuildMemoryEntries,
  mockSaveMemory,
  mockFormatSummary,
  mockDeploy,
} = vi.hoisted(() => ({
  mockParseStoryMarkdown: vi.fn(),
  mockConvertToPrd: vi.fn(),
  mockSavePrd: vi.fn(),
  mockScaffoldProject: vi.fn(),
  mockGenerateSeoDefaults: vi.fn(),
  mockGenerateAnalyticsDefaults: vi.fn(),
  mockGenerateAccessibilityDefaults: vi.fn(),
  mockGenerateSecurityHeaderDefaults: vi.fn(),
  mockGenerateDeploymentDefaults: vi.fn(),
  mockRunLoopIteration: vi.fn(),
  mockRunAdversarialLoop: vi.fn(),
  mockGenerateAdversarialSummary: vi.fn(),
  mockToReviewPhaseResult: vi.fn(),
  mockCreateRefactoringAgent: vi.fn(),
  mockCreateTestHardener: vi.fn(),
  mockCreateSecurityScanner: vi.fn(),
  mockCreateQaSmokeTest: vi.fn(),
  mockRunEpicSignOff: vi.fn(),
  mockAnalyze: vi.fn(),
  mockGenerateReport: vi.fn(),
  mockSaveReport: vi.fn(),
  mockBuildMemoryEntries: vi.fn(),
  mockSaveMemory: vi.fn(),
  mockFormatSummary: vi.fn(),
  mockDeploy: vi.fn(),
}));

// Runner's direct dependencies
vi.mock("../bridge/parser.js", () => ({
  parseStoryMarkdown: mockParseStoryMarkdown,
}));
vi.mock("../bridge/converter.js", () => ({
  convertToPrd: mockConvertToPrd,
  savePrd: mockSavePrd,
}));
vi.mock("../scaffolding/generator.js", () => ({
  scaffoldProject: mockScaffoldProject,
}));
vi.mock("../scaffolding/defaults/seo.js", () => ({
  generateSeoDefaults: mockGenerateSeoDefaults,
}));
vi.mock("../scaffolding/defaults/analytics.js", () => ({
  generateAnalyticsDefaults: mockGenerateAnalyticsDefaults,
}));
vi.mock("../scaffolding/defaults/accessibility.js", () => ({
  generateAccessibilityDefaults: mockGenerateAccessibilityDefaults,
}));
vi.mock("../scaffolding/defaults/security-headers.js", () => ({
  generateSecurityHeaderDefaults: mockGenerateSecurityHeaderDefaults,
}));
vi.mock("../scaffolding/defaults/deployment.js", () => ({
  generateDeploymentDefaults: mockGenerateDeploymentDefaults,
}));
vi.mock("../deployment/deployer.js", () => ({
  deploy: mockDeploy,
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
vi.mock("../review/refactoring-agent.js", () => ({
  createRefactoringAgent: mockCreateRefactoringAgent,
}));
vi.mock("../review/test-hardener.js", () => ({
  createTestHardener: mockCreateTestHardener,
}));
vi.mock("../review/security-scanner.js", () => ({
  createSecurityScanner: mockCreateSecurityScanner,
}));
vi.mock("../review/qa-smoke-test.js", () => ({
  createQaSmokeTest: mockCreateQaSmokeTest,
}));
vi.mock("./epic-loop.js", () => ({
  runEpicSignOff: mockRunEpicSignOff,
}));
vi.mock("../retrospective/analyzer.js", () => ({
  analyze: mockAnalyze,
}));
vi.mock("../retrospective/reporter.js", () => ({
  generateReport: mockGenerateReport,
  saveReport: mockSaveReport,
  buildMemoryEntries: mockBuildMemoryEntries,
  saveMemory: mockSaveMemory,
  formatSummary: mockFormatSummary,
}));

// Orchestrator's planning dependencies — mocked so the real orchestrator can
// be imported without pulling in the Anthropic SDK at module-load time.
vi.mock("../planning/viability.js", () => ({ assessViability: vi.fn() }));
vi.mock("../planning/prd.js", () => ({ generatePrd: vi.fn() }));
vi.mock("../planning/architecture.js", () => ({ generateArchitecture: vi.fn() }));
vi.mock("../planning/stories.js", () => ({ generateStories: vi.fn() }));

// ---------------------------------------------------------------------------
// Test helpers
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
  packageManager: "pnpm",
  testRunner: "vitest",
  linter: "oxlint",
  projectStructure: "monorepo",
  aiModel: "claude-opus-4-6",
  autonomousByDefault: false,
};

function makeReviewResult(epicNumber = 1) {
  return {
    epicNumber,
    parallelResults: [],
    refactoringResult: null,
    testHardeningResult: null,
    testSuiteResult: null,
    securityResult: null,
    qaResult: null,
    canAdvance: true,
    blockingIssues: [],
    lastCompletedPhase: null,
  };
}

function makeRetroData() {
  return {
    projectName: "test",
    totalEpics: 1,
    totalStories: 2,
    epics: [],
    topFindingPatterns: [],
    codebasePatterns: [],
    allLearnings: [],
    mostComplexStory: null,
    avgFilesPerStory: 0,
  };
}

function singleEpicBreakdown() {
  return {
    epics: [
      {
        number: 1,
        name: "Setup",
        goal: "Set up the project",
        scope: "Foundation",
        stories: [
          {
            id: "1.1",
            title: "Init",
            userStory: "As a dev...",
            acceptanceCriteria: [],
            prerequisites: [],
            technicalNotes: [],
          },
          {
            id: "1.2",
            title: "Config",
            userStory: "As a dev...",
            acceptanceCriteria: [],
            prerequisites: [],
            technicalNotes: [],
          },
        ],
      },
    ],
    allStories: [],
  };
}

function twoEpicBreakdown() {
  return {
    epics: [
      {
        number: 1,
        name: "Setup",
        goal: "Foundation",
        scope: "s1",
        stories: [
          {
            id: "1.1",
            title: "Init",
            userStory: "",
            acceptanceCriteria: [],
            prerequisites: [],
            technicalNotes: [],
          },
        ],
      },
      {
        number: 2,
        name: "Features",
        goal: "Build features",
        scope: "s2",
        stories: [
          {
            id: "2.1",
            title: "Feature",
            userStory: "",
            acceptanceCriteria: [],
            prerequisites: [],
            technicalNotes: [],
          },
        ],
      },
    ],
    allStories: [],
  };
}

// ---------------------------------------------------------------------------
// Tests — uses real PipelineOrchestrator with temp dirs so that state
// transitions are validated by the actual state machine, not hand-rolled mocks.
// ---------------------------------------------------------------------------

describe("runFullPipeline", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-runner-test-"));
    vi.clearAllMocks();

    // Default happy-path mocks
    mockParseStoryMarkdown.mockReturnValue(singleEpicBreakdown());
    mockConvertToPrd.mockReturnValue({
      project: "test",
      branchName: "epic-1",
      description: "Setup",
      userStories: [],
    });
    mockSavePrd.mockReturnValue(undefined);
    mockScaffoldProject.mockReturnValue({ directories: [], files: [], gitInitialized: false });
    mockGenerateSeoDefaults.mockReturnValue([]);
    mockGenerateAnalyticsDefaults.mockReturnValue([]);
    mockGenerateAccessibilityDefaults.mockReturnValue([]);
    mockGenerateSecurityHeaderDefaults.mockReturnValue([]);
    mockGenerateDeploymentDefaults.mockReturnValue([]);
    mockDeploy.mockResolvedValue({
      success: true,
      url: "https://test.vercel.app",
      output: "Deployed!",
      provider: "Vercel",
    });

    mockRunLoopIteration
      .mockResolvedValueOnce({ outcome: "passed", story: { id: "1.1" }, allComplete: false })
      .mockResolvedValueOnce({ outcome: "passed", story: { id: "1.2" }, allComplete: true });

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
      markdown: "# Summary",
      allResolved: true,
      savedPath: "/tmp/summary.md",
    });
    mockToReviewPhaseResult.mockReturnValue(makeReviewResult());

    mockCreateRefactoringAgent.mockReturnValue(vi.fn());
    mockCreateTestHardener.mockReturnValue(vi.fn());
    mockCreateSecurityScanner.mockReturnValue(vi.fn());
    mockCreateQaSmokeTest.mockReturnValue(vi.fn());

    mockRunEpicSignOff.mockResolvedValue({
      summary: { markdown: "" },
      approved: true,
      rejectionCycles: 0,
    });

    mockAnalyze.mockReturnValue(makeRetroData());
    mockGenerateReport.mockReturnValue("# Retro");
    mockSaveReport.mockReturnValue("/tmp/retro.md");
    mockBuildMemoryEntries.mockReturnValue([]);
    mockSaveMemory.mockReturnValue("/tmp/memory.yaml");
    mockFormatSummary.mockReturnValue("Summary");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("runs single-epic pipeline to COMPLETE and persists state to disk", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "## Epic 1: Setup\n### Story 1.1: Init\n",
      autonomous: true,
    });

    // State machine reached COMPLETE
    const state = orch.getState();
    expect(state.phase).toBe("COMPLETE");
    expect(state.scaffoldingComplete).toBe(true);

    // State persisted — a fresh orchestrator reads it from disk
    const orch2 = new PipelineOrchestrator(tmpDir);
    expect(orch2.getState().phase).toBe("COMPLETE");

    // Every phase module was invoked
    expect(mockConvertToPrd).toHaveBeenCalled();
    expect(mockSavePrd).toHaveBeenCalled();
    expect(mockScaffoldProject).toHaveBeenCalledWith(TEST_PROFILE, tmpDir);
    expect(mockRunLoopIteration).toHaveBeenCalled();
    expect(mockRunAdversarialLoop).toHaveBeenCalled();
    expect(mockRunEpicSignOff).toHaveBeenCalled();
    expect(mockAnalyze).toHaveBeenCalled();
    expect(mockGenerateReport).toHaveBeenCalled();
    expect(mockSaveReport).toHaveBeenCalled();
    expect(mockSaveMemory).toHaveBeenCalled();
  });

  it("multi-epic: scaffolds only on first epic, both reach COMPLETE", async () => {
    const { runFullPipeline } = await import("./runner.js");
    mockParseStoryMarkdown.mockReturnValue(twoEpicBreakdown());
    mockRunLoopIteration.mockReset();
    mockRunLoopIteration.mockResolvedValue({ outcome: "no-stories", allComplete: true });

    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    // Scaffold ran exactly once
    expect(mockScaffoldProject).toHaveBeenCalledTimes(1);

    // Pipeline completed both epics
    expect(orch.getState().phase).toBe("COMPLETE");
    expect(orch.getState().scaffoldingComplete).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Failure isolation — each phase stops the pipeline and leaves state resumable
  // -------------------------------------------------------------------------

  it("build failure stops pipeline in BUILDING state", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    mockRunLoopIteration.mockReset();
    mockRunLoopIteration.mockResolvedValue({
      outcome: "failed",
      story: { id: "1.1", title: "Init" },
      error: "Typecheck failed",
      allComplete: false,
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    expect(orch.getState().phase).toBe("BUILDING");
    expect(mockRunAdversarialLoop).not.toHaveBeenCalled();
    expect(mockRunEpicSignOff).not.toHaveBeenCalled();
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Build failed"));

    consoleSpy.mockRestore();
  });

  it("review failure stops pipeline in REVIEWING state", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    mockRunAdversarialLoop.mockRejectedValue(new Error("Adversarial loop crashed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    expect(orch.getState().phase).toBe("REVIEWING");
    expect(mockRunEpicSignOff).not.toHaveBeenCalled();
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Review failed for epic 1: Adversarial loop crashed"),
    );

    consoleSpy.mockRestore();
  });

  it("sign-off failure stops pipeline in SIGN_OFF state", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    mockRunEpicSignOff.mockRejectedValue(new Error("Prompt library unavailable"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    expect(orch.getState().phase).toBe("SIGN_OFF");
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Sign-off failed for epic 1: Prompt library unavailable"),
    );

    consoleSpy.mockRestore();
  });

  it("retrospective failure stops pipeline in RETROSPECTIVE state", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    mockAnalyze.mockImplementation(() => {
      throw new Error("Corrupt review data");
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    expect(orch.getState().phase).toBe("RETROSPECTIVE");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Retrospective failed: Corrupt review data"),
    );

    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Sign-off behavior
  // -------------------------------------------------------------------------

  it("autonomous mode passes autonomous: true to sign-off", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    expect(mockRunEpicSignOff).toHaveBeenCalledWith(expect.objectContaining({ autonomous: true }));
  });

  it("sign-off rejection in interactive mode stops before retrospective", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    mockRunEpicSignOff.mockResolvedValue({
      summary: { markdown: "# Summary" },
      approved: false,
      rejectionCycles: 1,
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: false,
    });

    // Pipeline paused in SIGN_OFF — not COMPLETE
    expect(orch.getState().phase).toBe("SIGN_OFF");
    expect(mockAnalyze).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Progress reporting
  // -------------------------------------------------------------------------

  it("calls onProgress for each phase transition", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
    const progress: Array<[string, string]> = [];

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
      onProgress: (phase, msg) => progress.push([phase, msg]),
    });

    const phases = progress.map(([phase]) => phase);
    expect(phases).toContain("BRIDGING");
    expect(phases).toContain("SCAFFOLDING");
    expect(phases).toContain("BUILDING");
    expect(phases).toContain("REVIEWING");
    expect(phases).toContain("SIGN_OFF");
    expect(phases).toContain("DEPLOYING");
    expect(phases).toContain("RETROSPECTIVE");
    expect(phases).toContain("COMPLETE");
  });

  // -------------------------------------------------------------------------
  // Deployment phase
  // -------------------------------------------------------------------------

  it("runs DEPLOYING phase when cloudProvider is set", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);
    const progress: Array<[string, string]> = [];

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
      onProgress: (phase, msg) => progress.push([phase, msg]),
    });

    expect(mockDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir: tmpDir,
        cloudProvider: "vercel",
      }),
    );

    const deployPhases = progress.filter(([phase]) => phase === "DEPLOYING");
    expect(deployPhases.length).toBeGreaterThanOrEqual(1);
    expect(orch.getState().phase).toBe("COMPLETE");
  });

  it("skips DEPLOYING when cloudProvider is 'none'", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const noDeployProfile = { ...TEST_PROFILE, cloudProvider: "none" as const };
    const orch = new PipelineOrchestrator(tmpDir, noDeployProfile);

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: noDeployProfile,
      storiesMarkdown: "md",
      autonomous: true,
    });

    expect(mockDeploy).not.toHaveBeenCalled();
    expect(orch.getState().phase).toBe("COMPLETE");
  });

  it("deploy failure does not stop pipeline — continues to RETROSPECTIVE", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    mockDeploy.mockResolvedValue({
      success: false,
      url: null,
      output: "Error!",
      error: "Build failed on Vercel",
      provider: "Vercel",
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    // Pipeline reached COMPLETE despite deploy failure
    expect(orch.getState().phase).toBe("COMPLETE");
    expect(mockAnalyze).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Deployment failed"));

    consoleSpy.mockRestore();
  });

  it("deploy exception does not stop pipeline", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    mockDeploy.mockRejectedValue(new Error("Network timeout"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    expect(orch.getState().phase).toBe("COMPLETE");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Deployment error"));

    consoleSpy.mockRestore();
  });

  it("saves deploy result to .boop/deploy-result.json", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    mockDeploy.mockResolvedValue({
      success: true,
      url: "https://my-app.vercel.app",
      output: "Deployed successfully",
      provider: "Vercel",
    });

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    const resultPath = path.join(tmpDir, ".boop", "deploy-result.json");
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.success).toBe(true);
    expect(result.url).toBe("https://my-app.vercel.app");
    expect(result.provider).toBe("Vercel");
    expect(result.timestamp).toBeDefined();
  });

  it("redacts credentials from deploy-result.json output", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    mockDeploy.mockResolvedValue({
      success: true,
      url: "https://my-app.vercel.app",
      output:
        "Deploying...\nVERCEL_TOKEN=sk_live_abc123\nAuthorization: Bearer eyJhbGciOi\nhttps://user:pass123@registry.example.com\nDone!",
      provider: "Vercel",
    });

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    const resultPath = path.join(tmpDir, ".boop", "deploy-result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.output).not.toContain("sk_live_abc123");
    expect(result.output).not.toContain("eyJhbGciOi");
    expect(result.output).not.toContain("pass123");
    expect(result.output).toContain("[REDACTED]");
  });

  it("truncates deploy output to 2000 chars in result file", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    mockDeploy.mockResolvedValue({
      success: true,
      url: "https://my-app.vercel.app",
      output: "x".repeat(10_000),
      provider: "Vercel",
    });

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
    });

    const resultPath = path.join(tmpDir, ".boop", "deploy-result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.output.length).toBeLessThanOrEqual(2000);
  });

  // -------------------------------------------------------------------------
  // Scaffolding defaults resilience
  // -------------------------------------------------------------------------

  it("continues writing remaining defaults when one file fails", async () => {
    const { runFullPipeline } = await import("./runner.js");
    const orch = new PipelineOrchestrator(tmpDir, TEST_PROFILE);

    // Create a regular file where a directory is expected — mkdirSync will
    // fail for any child path because "blocked" is a file, not a directory.
    const blockerPath = path.join(tmpDir, "blocked");
    fs.writeFileSync(blockerPath, "I am a file, not a directory");

    mockGenerateSeoDefaults.mockReturnValue([{ filepath: "blocked/seo.ts", content: "// seo" }]);
    mockGenerateAnalyticsDefaults.mockReturnValue([
      { filepath: "config/analytics.ts", content: "// analytics" },
    ]);

    const progress: Array<[string, string]> = [];

    await runFullPipeline({
      orchestrator: orch,
      projectDir: tmpDir,
      profile: TEST_PROFILE,
      storiesMarkdown: "md",
      autonomous: true,
      onProgress: (phase, msg) => progress.push([phase, msg]),
    });

    // SEO file failed — analytics file was still written
    expect(fs.existsSync(path.join(tmpDir, "blocked", "seo.ts"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "config", "analytics.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "config", "analytics.ts"), "utf-8")).toBe(
      "// analytics",
    );

    // onProgress reported the warning
    const warnings = progress.filter(([, msg]) => msg.includes("Warning:"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![1]).toContain("blocked/seo.ts");

    // Pipeline still reached COMPLETE
    expect(orch.getState().phase).toBe("COMPLETE");
  });
});
