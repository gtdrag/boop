/**
 * Tests for gauntlet runner.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperProfile } from "../shared/types.js";
import type { GauntletTier, GauntletTierResult } from "./types.js";

const mockRunPlanning = vi.fn().mockResolvedValue({
  viability: { recommendation: "PROCEED", assessment: "Looks good" },
  prd: { prd: "# PRD" },
  architecture: { architecture: "# Architecture" },
  stories: { stories: "# Stories" },
});

const mockGetState = vi.fn().mockReturnValue({ phase: "PLANNING" });

// Mock the pipeline imports so we don't need real pipeline infrastructure
vi.mock("../pipeline/orchestrator.js", () => {
  return {
    PipelineOrchestrator: class MockOrchestrator {
      reset = vi.fn();
      runPlanning = mockRunPlanning;
      getState = mockGetState;
    },
  };
});

vi.mock("../pipeline/runner.js", () => {
  return {
    runFullPipeline: vi.fn().mockResolvedValue(undefined),
  };
});

// Must import AFTER mocks are set up
const { runTier, runEvolutionStep } = await import("./runner.js");

describe("runner", () => {
  let tmpDir: string;
  let workspaceDir: string;
  let gitRepoDir: string;

  const baseProfile: DeveloperProfile = {
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
    projectStructure: "single-repo",
    errorTracker: "sentry",
    aiModel: "claude-opus-4-6",
    autonomousByDefault: true,
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-runner-"));
    workspaceDir = path.join(tmpDir, "workspace");
    gitRepoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(gitRepoDir, { recursive: true });

    // Initialize git repo
    execSync("git init", { cwd: gitRepoDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: gitRepoDir, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: gitRepoDir, stdio: "pipe" });
    fs.writeFileSync(path.join(gitRepoDir, "init.txt"), "init", "utf-8");
    execSync("git add . && git commit -m 'init'", { cwd: gitRepoDir, stdio: "pipe" });

    mockRunPlanning.mockClear();
    mockGetState.mockClear();
    mockGetState.mockReturnValue({ phase: "PLANNING" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeTier = (overrides?: Partial<GauntletTier>): GauntletTier => ({
    id: "t1-test",
    label: "T1: Test",
    level: 1,
    idea: "Build a simple app",
    stack: "React",
    rationale: "Basic test",
    successCriteria: {
      minPhaseReached: "PLANNING",
      planningMustPass: true,
    },
    ...overrides,
  });

  // --- runTier ---
  it("creates isolated project directory for the tier", async () => {
    const tier = makeTier();
    await runTier(tier, baseProfile, workspaceDir, gitRepoDir);

    const tierDir = path.join(workspaceDir, "gauntlet-t1-test");
    expect(fs.existsSync(tierDir)).toBe(true);
  });

  it("returns a tier result with correct structure", async () => {
    const tier = makeTier();
    const result = await runTier(tier, baseProfile, workspaceDir, gitRepoDir);

    expect(result.tierId).toBe("t1-test");
    expect(result.level).toBe(1);
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThan(0);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.tags.post).toBe("gauntlet/t1-test-post");
  });

  it("merges profile overrides without errors", async () => {
    const tier = makeTier({
      profileOverrides: { database: "sqlite", backendFramework: "fastify" },
    });

    const result = await runTier(tier, baseProfile, workspaceDir, gitRepoDir);
    // Verify the tier ran and produced a result (mock may produce no errors)
    expect(result.tierId).toBe("t1-test");
    expect(typeof result.success).toBe("boolean");
  });

  it("tags the post-run state", async () => {
    const tier = makeTier();
    await runTier(tier, baseProfile, workspaceDir, gitRepoDir);

    const tagCheck = execSync('git tag -l "gauntlet/t1-test-post"', {
      cwd: gitRepoDir,
      encoding: "utf-8",
    }).trim();
    expect(tagCheck).toBe("gauntlet/t1-test-post");
  });

  it("collects notes from the tier project", async () => {
    const tier = makeTier();
    const result = await runTier(tier, baseProfile, workspaceDir, gitRepoDir);

    // Should have at least notes about missing artifacts
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it("invokes the PipelineOrchestrator with the idea", async () => {
    const tier = makeTier({ idea: "Build something cool" });
    await runTier(tier, baseProfile, workspaceDir, gitRepoDir);

    expect(mockRunPlanning).toHaveBeenCalledWith(
      "Build something cool",
      expect.objectContaining({ autonomous: true }),
    );
  });

  // --- runEvolutionStep ---
  it("creates evolution log entry", async () => {
    const tierResult: GauntletTierResult = {
      tierId: "t1-test",
      level: 1,
      success: true,
      phaseReached: "REVIEWING",
      durationMs: 5000,
      errors: [],
      notes: [],
      tags: { post: "gauntlet/t1-test-post" },
    };

    const result = await runEvolutionStep(tierResult, gitRepoDir, "gauntlet-v1");

    expect(result.tierId).toBe("t1-test");
    expect(result.approved).toBe(true);
    expect(result.skipped).toBe(false);

    // Check evolution log was created
    const logPath = path.join(gitRepoDir, "evolution-log.yaml");
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it("appends to existing evolution log", async () => {
    // Create initial log
    const logPath = path.join(gitRepoDir, "evolution-log.yaml");
    fs.writeFileSync(logPath, "- tier: t0-initial\n  date: '2026-01-01'\n", "utf-8");
    execSync("git add . && git commit -m 'add log'", { cwd: gitRepoDir, stdio: "pipe" });

    const tierResult: GauntletTierResult = {
      tierId: "t1-test",
      level: 1,
      success: true,
      phaseReached: "REVIEWING",
      durationMs: 5000,
      errors: [],
      notes: [],
      tags: { post: "gauntlet/t1-test-post" },
    };

    await runEvolutionStep(tierResult, gitRepoDir, "gauntlet-v1");

    const logContent = fs.readFileSync(logPath, "utf-8");
    expect(logContent).toContain("t0-initial");
    expect(logContent).toContain("t1-test");
  });
});
