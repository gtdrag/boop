/**
 * Adversarial review loop — iterates review → verify → fix → test until clean.
 *
 * Orchestrates the full adversarial cycle:
 *   1. Run three parallel adversarial agents (code-quality, test-coverage, security)
 *   2. Verify findings against the actual codebase (filter out hallucinations)
 *   3. Auto-fix verified findings with regression guard
 *   4. Repeat until zero findings or max iterations reached
 *
 * Includes stuck detection: if two consecutive iterations find the same
 * unresolved findings, the loop exits early.
 */
import fs from "node:fs";
import path from "node:path";

import type { TestSuiteRunnerFn } from "../team-orchestrator.js";
import { writeSnapshot, generateSessionId } from "../../shared/context-snapshot.js";
import type { ContextSnapshot } from "../../shared/context-snapshot.js";
import { runAdversarialAgents } from "./runner.js";
import type {
  AdversarialAgentResult,
  AdversarialFinding,
  AdversarialRunnerOptions,
} from "./runner.js";
import { verifyFindings } from "./verifier.js";
import type { VerificationResult } from "./verifier.js";
import { fixFindings } from "./fixer.js";
import type { FixBatchResult, FixResult } from "./fixer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IterationResult {
  /** Iteration number (1-based). */
  iteration: number;
  /** Raw results from the three adversarial agents. */
  agentResults: AdversarialAgentResult[];
  /** Verification results (verified vs. discarded). */
  verification: VerificationResult;
  /** Fix results (what was fixed, what wasn't). */
  fixResult: FixBatchResult | null;
  /** Whether tests passed after this iteration. */
  testsPass: boolean;
  /** Finding IDs that remain unresolved after this iteration. */
  unresolvedIds: string[];
}

export interface AdversarialLoopResult {
  /** All iteration results, in order. */
  iterations: IterationResult[];
  /** Whether the loop converged (zero findings). */
  converged: boolean;
  /** Why the loop exited. */
  exitReason: "converged" | "max-iterations" | "stuck" | "test-failure";
  /** Total findings across all iterations. */
  totalFindings: number;
  /** Total findings auto-fixed. */
  totalFixed: number;
  /** Total findings discarded by verifier. */
  totalDiscarded: number;
  /** Findings that remain unresolved. */
  unresolvedFindings: AdversarialFinding[];
  /** All fix results across iterations. */
  allFixResults: FixResult[];
}

export interface AdversarialLoopOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Epic number being reviewed. */
  epicNumber: number;
  /** Maximum iterations. Defaults to 3. */
  maxIterations?: number;
  /** Test suite runner function. */
  testSuiteRunner: TestSuiteRunnerFn;
  /** Base branch to diff against. */
  baseBranch?: string;
  /** Model for Claude CLI (fix agent). */
  model?: string;
  /** Progress callback. */
  onProgress?: (iteration: number, phase: string, message: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Save iteration artifacts to disk.
 */
function saveIterationArtifacts(
  projectDir: string,
  epicNumber: number,
  result: IterationResult,
): void {
  const dir = path.join(projectDir, ".boop", "reviews", `epic-${epicNumber}`);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `iteration-${result.iteration}.json`);
  const artifact = {
    iteration: result.iteration,
    agents: result.agentResults.map((a) => ({
      agent: a.agent,
      success: a.success,
      findingCount: a.findings.length,
    })),
    verification: result.verification.stats,
    fixResults: result.fixResult
      ? {
          fixed: result.fixResult.fixed.length,
          unfixed: result.fixResult.unfixed.length,
        }
      : null,
    testsPass: result.testsPass,
    unresolvedIds: result.unresolvedIds,
  };

  fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2), "utf-8");
}

/**
 * Check if two consecutive iterations have the same unresolved findings.
 * This indicates the fixer is stuck and the loop should exit early.
 */
function isStuck(prev: IterationResult, curr: IterationResult): boolean {
  if (prev.unresolvedIds.length === 0 && curr.unresolvedIds.length === 0) {
    return false; // Both clean — not stuck, just converged
  }

  const prevSet = new Set(prev.unresolvedIds);
  const currSet = new Set(curr.unresolvedIds);

  if (prevSet.size !== currSet.size) return false;

  for (const id of currSet) {
    if (!prevSet.has(id)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the adversarial review loop until convergence or max iterations.
 *
 * Each iteration:
 *   1. Run three adversarial agents in parallel
 *   2. Verify findings (filter hallucinations)
 *   3. Auto-fix verified findings
 *   4. Run test suite
 *   5. Check for convergence or stuck state
 */
export async function runAdversarialLoop(
  options: AdversarialLoopOptions,
): Promise<AdversarialLoopResult> {
  const {
    projectDir,
    epicNumber,
    maxIterations = 3,
    testSuiteRunner,
    baseBranch = "main",
    model,
    onProgress,
  } = options;

  const iterations: IterationResult[] = [];
  const allFixResults: FixResult[] = [];
  let totalFindings = 0;
  let totalFixed = 0;
  let totalDiscarded = 0;
  let exitReason: AdversarialLoopResult["exitReason"] = "max-iterations";

  for (let i = 1; i <= maxIterations; i++) {
    onProgress?.(i, "review", `Starting adversarial review iteration ${i}/${maxIterations}`);

    // Step 1: Run adversarial agents
    const runnerOptions: AdversarialRunnerOptions = {
      projectDir,
      epicNumber,
      baseBranch,
    };
    const agentResults = await runAdversarialAgents(runnerOptions);
    const allFindings = agentResults.flatMap((r) => r.findings);
    totalFindings += allFindings.length;

    onProgress?.(
      i,
      "review",
      `Found ${allFindings.length} findings across ${agentResults.filter((r) => r.success).length} agents`,
    );

    // Step 2: Verify findings
    onProgress?.(i, "verify", "Verifying findings against codebase...");
    const verification = verifyFindings(projectDir, allFindings);
    totalDiscarded += verification.stats.discarded;

    onProgress?.(
      i,
      "verify",
      `Verified: ${verification.stats.verified}, Discarded: ${verification.stats.discarded}`,
    );

    // Step 3: Fix verified findings (if any)
    let fixResult: FixBatchResult | null = null;

    if (verification.verified.length > 0) {
      onProgress?.(i, "fix", `Fixing ${verification.verified.length} verified findings...`);

      fixResult = await fixFindings(verification.verified, {
        projectDir,
        testSuiteRunner,
        model,
      });

      totalFixed += fixResult.fixed.length;
      allFixResults.push(...fixResult.results);

      onProgress?.(
        i,
        "fix",
        `Fixed: ${fixResult.fixed.length}, Unfixed: ${fixResult.unfixed.length}`,
      );
    } else {
      onProgress?.(i, "fix", "No findings to fix — iteration clean");
    }

    // Step 4: Run final test suite
    const testsPass = fixResult
      ? fixResult.finalTestResult.passed
      : (await testSuiteRunner(projectDir)).passed;

    // Build iteration result
    const unresolvedIds = fixResult ? fixResult.unfixed.map((f) => f.id) : [];

    const iterResult: IterationResult = {
      iteration: i,
      agentResults,
      verification,
      fixResult,
      testsPass,
      unresolvedIds,
    };

    iterations.push(iterResult);
    saveIterationArtifacts(projectDir, epicNumber, iterResult);

    // Write context snapshot for next iteration
    const reviewSnapshot: ContextSnapshot = {
      sessionId: generateSessionId(),
      timestamp: new Date().toISOString(),
      phase: "REVIEWING",
      epicNumber,
      reviewIteration: i,
      filesChanged: fixResult
        ? fixResult.results.filter((r) => r.fixed && r.finding.file).map((r) => r.finding.file!)
        : [],
      decisions: [],
      blockers: [],
      findingsCount: allFindings.length,
      fixedCount: fixResult?.fixed.length ?? 0,
      discardedCount: verification.stats.discarded,
      unresolvedIds: unresolvedIds,
      fixCommits: fixResult
        ? fixResult.results.filter((r) => r.commitSha).map((r) => r.commitSha!)
        : [],
    };
    writeSnapshot(projectDir, reviewSnapshot);

    // Step 5: Check exit conditions
    if (verification.verified.length === 0) {
      exitReason = "converged";
      onProgress?.(i, "done", "Converged — zero findings");
      break;
    }

    if (!testsPass) {
      exitReason = "test-failure";
      onProgress?.(i, "done", "Tests failing — exiting loop");
      break;
    }

    if (fixResult && fixResult.unfixed.length === 0) {
      // All findings were fixed — but we need to re-review to check if
      // the fixes introduced new issues. Continue to next iteration.
      onProgress?.(i, "done", "All findings fixed — re-reviewing for regressions");
      continue;
    }

    // Stuck detection
    if (iterations.length >= 2) {
      const prev = iterations[iterations.length - 2]!;
      if (isStuck(prev, iterResult)) {
        exitReason = "stuck";
        onProgress?.(i, "done", "Stuck — same findings across iterations");
        break;
      }
    }
  }

  // Collect unresolved findings from the last iteration
  const lastIter = iterations[iterations.length - 1];
  const unresolvedFindings = lastIter?.fixResult?.unfixed ?? [];

  return {
    iterations,
    converged: exitReason === "converged",
    exitReason,
    totalFindings,
    totalFixed,
    totalDiscarded,
    unresolvedFindings,
    allFixResults,
  };
}
