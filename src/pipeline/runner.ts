/**
 * Pipeline runner — chains all phases end-to-end after planning completes.
 *
 * Pure glue code: for each epic, runs bridging → scaffolding → building →
 * reviewing → sign-off, then deploys once (if configured) and finishes
 * with a retrospective.
 *
 * Phase sequence per epic: 1. BRIDGING → 2. SCAFFOLDING → 3. BUILDING →
 * 4. REVIEWING → 5. SIGN_OFF. After all epics: 6. DEPLOYING → 7. RETROSPECTIVE.
 *
 * Every phase is wrapped in error handling that reports the failure cleanly
 * and leaves the orchestrator in a resumable state.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { DeveloperProfile } from "../shared/types.js";
import type { PipelineOrchestrator } from "./orchestrator.js";
import { parseStoryMarkdown } from "../bridge/parser.js";
import { convertToPrd, savePrd } from "../bridge/converter.js";
import type { ProjectMetadata } from "../bridge/converter.js";
import { scaffoldProject } from "../scaffolding/generator.js";
import { generateSeoDefaults } from "../scaffolding/defaults/seo.js";
import { generateAnalyticsDefaults } from "../scaffolding/defaults/analytics.js";
import { generateAccessibilityDefaults } from "../scaffolding/defaults/accessibility.js";
import { generateSecurityHeaderDefaults } from "../scaffolding/defaults/security-headers.js";
import { generateDeploymentDefaults } from "../scaffolding/defaults/deployment.js";
import { runLoopIteration } from "../build/ralph-loop.js";
import type { LoopResult } from "../build/ralph-loop.js";
import type { TestSuiteResult, ReviewPhaseResult } from "../review/team-orchestrator.js";
import { createRefactoringAgent } from "../review/refactoring-agent.js";
import { createTestHardener } from "../review/test-hardener.js";
import { createSecurityScanner } from "../review/security-scanner.js";
import { createQaSmokeTest } from "../review/qa-smoke-test.js";
import { runAdversarialLoop } from "../review/adversarial/loop.js";
import { generateAdversarialSummary, toReviewPhaseResult } from "../review/adversarial/summary.js";
import { runEpicSignOff } from "./epic-loop.js";
import type { SignOffDecision, EpicSummary } from "./epic-loop.js";
import { analyze } from "../retrospective/analyzer.js";
import {
  generateReport,
  saveReport,
  buildMemoryEntries,
  saveMemory,
  formatSummary,
} from "../retrospective/reporter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineRunnerOptions {
  orchestrator: PipelineOrchestrator;
  projectDir: string;
  profile: DeveloperProfile;
  /** Raw stories markdown from StoriesResult.stories. */
  storiesMarkdown: string;
  /** Run without user prompts. */
  autonomous?: boolean;
  /** Progress callback for each phase transition. */
  onProgress?: (phase: string, message: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write scaffolding default files (SEO, analytics, accessibility, security
 * headers) to disk. Skips individual files that fail to write rather than
 * aborting the entire batch.
 */
function applyScaffoldingDefaults(
  profile: DeveloperProfile,
  projectDir: string,
  onProgress?: PipelineRunnerOptions["onProgress"],
): void {
  const allFiles = [
    ...generateSeoDefaults(profile),
    ...generateAnalyticsDefaults(profile),
    ...generateAccessibilityDefaults(profile),
    ...generateSecurityHeaderDefaults(profile),
    ...generateDeploymentDefaults(profile),
  ];

  for (const file of allFiles) {
    const fullPath = path.join(projectDir, file.filepath);
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content, "utf-8");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      onProgress?.("SCAFFOLDING", `Warning: failed to write ${file.filepath}: ${msg}`);
    }
  }
}

/**
 * Creates a test suite runner that executes `pnpm test` in the project
 * directory with a 5-minute timeout.
 *
 * Returns a function matching the {@link TestSuiteRunnerFn} signature.
 * The `projectDir` parameter on the returned function is intentionally
 * ignored — the runner binds to the project directory at creation time
 * so the same runner can be passed to both the review pipeline and the
 * fix cycle without the caller needing to track the directory.
 */
function createTestSuiteRunner(projectDir: string) {
  return async (): Promise<TestSuiteResult> => {
    try {
      const output = execSync("pnpm test", {
        cwd: projectDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 300_000,
      });
      return { passed: true, output };
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string };
      const output = [execError.stdout ?? "", execError.stderr ?? ""].filter(Boolean).join("\n");
      return { passed: false, output };
    }
  };
}

/**
 * Lazily creates a sign-off prompt function. Only imports `@clack/prompts`
 * when actually called (not when constructed).
 */
function createInteractiveSignOff(): (summary: EpicSummary) => Promise<SignOffDecision> {
  return async (summary) => {
    const { confirm, text, isCancel } = await import("@clack/prompts");

    console.log(summary.markdown);
    console.log();

    const approved = await confirm({ message: "Approve this epic?" });
    if (isCancel(approved)) {
      return { action: "reject", feedback: "Sign-off cancelled by user." };
    }
    if (approved) {
      return { action: "approve" };
    }

    const feedback = await text({
      message: "What needs to change?",
      placeholder: "Describe what should be fixed before approval...",
    });

    if (isCancel(feedback) || !feedback?.trim()) {
      return { action: "reject", feedback: "No feedback provided." };
    }

    return { action: "reject", feedback: feedback as string };
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Redact credential-like values from deploy output before writing to disk. */
function redactSecrets(text: string): string {
  return (
    text
      // ENV_VAR style: VERCEL_TOKEN=abc, API_KEY: sk-123 (case-sensitive to avoid
      // false positives on lowercase words like "token count" or "primary_key")
      .replace(
        /(\b[A-Z_]*(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)[A-Z_]*)[=:]\s*\S+/g,
        "$1=[REDACTED]",
      )
      // Bearer tokens: "Bearer eyJ..." or "Authorization: Bearer ..."
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      // URL-embedded credentials: https://user:pass@host
      .replace(/:\/\/[^@\s]+@/g, "://[REDACTED]@")
  );
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runFullPipeline(options: PipelineRunnerOptions): Promise<void> {
  const {
    orchestrator: orch,
    projectDir,
    profile,
    storiesMarkdown,
    autonomous = false,
    onProgress,
  } = options;

  const breakdown = parseStoryMarkdown(storiesMarkdown);
  const projectName = path.basename(projectDir);

  for (const epic of breakdown.epics) {
    const epicNumber = epic.number;
    onProgress?.("BRIDGING", `Starting epic ${epicNumber}: ${epic.name}`);

    // --- 1. BRIDGING ---
    orch.startEpic(epicNumber);
    orch.transition("BRIDGING");

    const metadata: ProjectMetadata = {
      project: projectName,
      branchName: `epic-${epicNumber}`,
      description: `${epic.name}: ${epic.goal}`,
    };

    const prd = convertToPrd(breakdown, metadata, { epicNumber });
    savePrd(prd, projectDir);
    onProgress?.("BRIDGING", `PRD saved for epic ${epicNumber}`);

    // --- 2. SCAFFOLDING (first epic only) ---
    const state = orch.getState();
    if (!state.scaffoldingComplete) {
      orch.transition("SCAFFOLDING");
      onProgress?.("SCAFFOLDING", "Scaffolding project...");

      scaffoldProject(profile, projectDir);
      applyScaffoldingDefaults(profile, projectDir, onProgress);
      orch.completeScaffolding();

      onProgress?.("SCAFFOLDING", "Scaffolding complete");
    }

    // --- 3. BUILDING ---
    orch.advance(); // SCAFFOLDING→BUILDING or BRIDGING→BUILDING
    onProgress?.("BUILDING", `Building epic ${epicNumber}...`);

    const prdPath = path.join(projectDir, ".boop", "prd.json");
    const maxIterations = epic.stories.length * 3;
    let buildFailed = false;

    for (let i = 0; i < maxIterations; i++) {
      const result: LoopResult = await runLoopIteration({
        projectDir,
        prdPath,
        model: profile.aiModel || undefined,
      });

      if (result.allComplete) {
        onProgress?.("BUILDING", `All stories complete for epic ${epicNumber}`);
        break;
      }

      if (result.outcome === "failed") {
        onProgress?.("BUILDING", `Build failed: ${result.error ?? "unknown error"}`);
        console.error(`[boop] Build failed on story ${result.story?.id ?? "?"}: ${result.error}`);
        console.error("[boop] Pipeline paused in BUILDING. Resume with: boop --resume");
        buildFailed = true;
        break;
      }

      if (result.outcome === "no-stories") {
        onProgress?.("BUILDING", "No more stories to process");
        break;
      }

      onProgress?.("BUILDING", `Story ${result.story?.id ?? "?"} passed`);
    }

    if (buildFailed) return;

    // --- 4. REVIEWING (adversarial loop) ---
    orch.transition("REVIEWING");
    onProgress?.("REVIEWING", `Running adversarial review for epic ${epicNumber}...`);

    let reviewResult: ReviewPhaseResult;
    try {
      const loopResult = await runAdversarialLoop({
        projectDir,
        epicNumber,
        testSuiteRunner: createTestSuiteRunner(projectDir),
        model: profile.aiModel || undefined,
        onProgress: (iter, phase, msg) =>
          onProgress?.("REVIEWING", `[iter ${iter}] ${phase}: ${msg}`),
      });

      generateAdversarialSummary(projectDir, epicNumber, loopResult);
      reviewResult = toReviewPhaseResult(epicNumber, loopResult);
    } catch (error: unknown) {
      console.error(`[boop] Review failed for epic ${epicNumber}: ${formatError(error)}`);
      console.error("[boop] Pipeline paused in REVIEWING. Resume with: boop --resume");
      return;
    }

    onProgress?.("REVIEWING", `Review complete for epic ${epicNumber}`);

    // --- 5. SIGN-OFF ---
    orch.transition("SIGN_OFF");
    onProgress?.("SIGN_OFF", `Epic ${epicNumber} sign-off`);

    let signOffResult;
    try {
      signOffResult = await runEpicSignOff({
        projectDir,
        epicNumber,
        reviewResult,
        autonomous,
        signOffPrompt: autonomous ? undefined : createInteractiveSignOff(),
        fixCycleAgents: {
          refactoringAgent: createRefactoringAgent(),
          testHardener: createTestHardener(),
          testSuiteRunner: createTestSuiteRunner(projectDir),
          securityScanner: createSecurityScanner(),
          qaSmokeTester: createQaSmokeTest(),
        },
      });
    } catch (error: unknown) {
      console.error(`[boop] Sign-off failed for epic ${epicNumber}: ${formatError(error)}`);
      console.error("[boop] Pipeline paused in SIGN_OFF. Resume with: boop --resume");
      return;
    }

    if (!signOffResult.approved && !autonomous) {
      console.log(`[boop] Epic ${epicNumber} not approved. Pipeline paused.`);
      return;
    }

    onProgress?.("SIGN_OFF", `Epic ${epicNumber} approved`);
  }

  // --- 6. DEPLOYING (once after all epics) ---
  if (profile.cloudProvider && profile.cloudProvider !== "none" && breakdown.epics.length > 0) {
    const lastEpicNumber = breakdown.epics[breakdown.epics.length - 1]!.number;
    orch.transition("DEPLOYING");
    onProgress?.("DEPLOYING", `Deploying project...`);

    try {
      const { deploy } = await import("../deployment/deployer.js");
      const deployResult = await deploy({
        projectDir,
        cloudProvider: profile.cloudProvider,
        projectName: path.basename(projectDir),
        model: profile.aiModel || undefined,
      });

      const resultToSave = {
        success: deployResult.success,
        url: deployResult.url,
        provider: deployResult.provider,
        error: deployResult.error,
        output: redactSecrets(deployResult.output.slice(0, 2000)),
        timestamp: new Date().toISOString(),
      };
      const boopDir = path.join(projectDir, ".boop");
      fs.mkdirSync(boopDir, { recursive: true });
      fs.writeFileSync(
        path.join(boopDir, "deploy-result.json"),
        JSON.stringify(resultToSave, null, 2),
      );

      if (deployResult.success) {
        const urlMsg = deployResult.url
          ? `Live at: ${deployResult.url}`
          : "Build verified (no public URL)";
        onProgress?.("DEPLOYING", urlMsg);
        orch.notify("deployment-complete", { epic: lastEpicNumber, detail: urlMsg });
      } else {
        onProgress?.("DEPLOYING", `Deployment failed: ${deployResult.error ?? "unknown"}`);
        console.error(`[boop] Deployment failed: ${deployResult.error}`);
        console.error("[boop] Pipeline continuing to retrospective despite deploy failure.");
        orch.notify("deployment-failed", { epic: lastEpicNumber, detail: deployResult.error });
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      onProgress?.("DEPLOYING", `Deployment error: ${msg}`);
      console.error(`[boop] Deployment error: ${msg}`);
      console.error("[boop] Pipeline continuing to retrospective despite deploy error.");
      orch.notify("deployment-failed", {
        epic: breakdown.epics[breakdown.epics.length - 1]!.number,
        detail: msg,
      });
    }
  }

  // --- 7. RETROSPECTIVE ---
  orch.transition("RETROSPECTIVE");
  onProgress?.("RETROSPECTIVE", "Running retrospective analysis...");

  try {
    const retroData = analyze({
      projectDir,
      projectName,
      totalEpics: breakdown.epics.length,
    });

    const report = generateReport(retroData);
    saveReport(projectDir, report);

    const memoryEntries = buildMemoryEntries(retroData);
    saveMemory(memoryEntries);

    const summary = formatSummary(retroData);
    console.log();
    console.log(summary);
  } catch (error: unknown) {
    console.error(`[boop] Retrospective failed: ${formatError(error)}`);
    console.error("[boop] Pipeline paused in RETROSPECTIVE. Resume with: boop --resume");
    return;
  }

  orch.transition("COMPLETE");
  onProgress?.("COMPLETE", "Pipeline finished");
}
