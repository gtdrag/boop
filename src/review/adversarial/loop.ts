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
  AdversarialAgentType,
  AdversarialFinding,
  AdversarialRunnerOptions,
} from "./runner.js";
import type { ReviewRule } from "./review-rules.js";
import type { ApprovalGateFn } from "./approval-gate.js";
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
  exitReason: "converged" | "max-iterations" | "stuck" | "test-failure" | "diverging" | "human-aborted";
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
  /** Findings deferred to summary (medium/low severity, not auto-fixed). */
  deferredFindings: AdversarialFinding[];
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
  /**
   * Minimum severity to auto-fix. Findings below this threshold are
   * captured in the summary as recommendations but not sent to the fixer.
   * Defaults to "high" (only critical + high get auto-fixed).
   */
  minFixSeverity?: "critical" | "high" | "medium" | "low";
  /** Subset of agents to run (from risk tier). Defaults to all three. */
  agents?: AdversarialAgentType[];
  /** Review rules to inject into agent prompts. */
  reviewRules?: ReviewRule[];
  /** Optional human approval gate before fixing. */
  approvalGate?: ApprovalGateFn;
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

/**
 * Check if the review loop is diverging (finding count increasing).
 * When fixes introduce more surface area than they resolve, the loop
 * will never converge — it's a doom loop. Exit early.
 */
function isDiverging(prev: IterationResult, curr: IterationResult): boolean {
  const prevCount = prev.verification.stats.verified;
  const currCount = curr.verification.stats.verified;
  return currCount > prevCount;
}

/**
 * Severity rank for comparison. Lower number = more severe.
 */
const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Filter findings to only those at or above the minimum severity threshold.
 * Returns [fixable, deferred] — fixable get auto-fixed, deferred go to summary.
 */
function partitionBySeverity(
  findings: AdversarialFinding[],
  minSeverity: string,
): [AdversarialFinding[], AdversarialFinding[]] {
  const threshold = SEVERITY_RANK[minSeverity] ?? 1;
  const fixable: AdversarialFinding[] = [];
  const deferred: AdversarialFinding[] = [];

  for (const f of findings) {
    const rank = SEVERITY_RANK[f.severity] ?? 4;
    if (rank <= threshold) {
      fixable.push(f);
    } else {
      deferred.push(f);
    }
  }

  return [fixable, deferred];
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
    minFixSeverity = "high",
    agents: agentSubset,
    reviewRules,
    approvalGate,
  } = options;

  const iterations: IterationResult[] = [];
  const allFixResults: FixResult[] = [];
  const allDeferredFindings: AdversarialFinding[] = [];
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
      agents: agentSubset,
      reviewRules,
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

    // Step 2b: Severity gate — only auto-fix critical + high
    let [fixable, deferred] = partitionBySeverity(verification.verified, minFixSeverity);
    allDeferredFindings.push(...deferred);

    if (deferred.length > 0) {
      onProgress?.(
        i,
        "verify",
        `Deferred ${deferred.length} ${minFixSeverity === "high" ? "medium/low" : "low"} findings to summary`,
      );
    }

    // Step 2c: Human approval gate (optional)
    if (approvalGate && fixable.length > 0) {
      onProgress?.(i, "approval", `Awaiting approval for ${fixable.length} findings...`);

      const decision = await approvalGate({
        iteration: i,
        maxIterations,
        fixable,
        deferred,
      });

      if (decision.action === "abort") {
        exitReason = "human-aborted";
        onProgress?.(i, "approval", "Human aborted the review loop");

        const iterResult: IterationResult = {
          iteration: i,
          agentResults,
          verification,
          fixResult: null,
          testsPass: true,
          unresolvedIds: [],
        };
        iterations.push(iterResult);
        saveIterationArtifacts(projectDir, epicNumber, iterResult);
        break;
      }

      if (decision.action === "skip") {
        onProgress?.(i, "approval", "Human skipped this iteration's fixes");

        const iterResult: IterationResult = {
          iteration: i,
          agentResults,
          verification,
          fixResult: null,
          testsPass: true,
          unresolvedIds: fixable.map((f) => f.id),
        };
        iterations.push(iterResult);
        saveIterationArtifacts(projectDir, epicNumber, iterResult);
        continue;
      }

      if (decision.action === "filter") {
        const approvedSet = new Set(decision.approvedIds);
        const rejected = fixable.filter((f) => !approvedSet.has(f.id));
        fixable = fixable.filter((f) => approvedSet.has(f.id));
        allDeferredFindings.push(...rejected);
        onProgress?.(
          i,
          "approval",
          `Approved ${fixable.length} findings, deferred ${rejected.length}`,
        );
      }

      // "approve" falls through — fix all fixable
    }

    // Step 3: Divergence detection — if verified finding count is increasing,
    // the loop is creating more problems than it solves. Exit early.
    if (iterations.length >= 1) {
      const prev = iterations[iterations.length - 1]!;
      if (isDiverging(prev, { verification } as IterationResult)) {
        exitReason = "diverging";
        onProgress?.(
          i,
          "done",
          `Diverging — findings increased from ${prev.verification.stats.verified} to ${verification.stats.verified}. Stopping to prevent doom loop.`,
        );

        // Still save this iteration's data
        const iterResult: IterationResult = {
          iteration: i,
          agentResults,
          verification,
          fixResult: null,
          testsPass: true,
          unresolvedIds: [],
        };
        iterations.push(iterResult);
        saveIterationArtifacts(projectDir, epicNumber, iterResult);
        break;
      }
    }

    // Step 4: Fix verified findings that meet the severity threshold
    let fixResult: FixBatchResult | null = null;

    if (fixable.length > 0) {
      onProgress?.(
        i,
        "fix",
        `Fixing ${fixable.length} verified findings (${minFixSeverity}+ severity)...`,
      );

      fixResult = await fixFindings(fixable, {
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

    // Step 5: Run final test suite
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

    // Step 6: Check exit conditions
    if (fixable.length === 0) {
      exitReason = "converged";
      onProgress?.(i, "done", "Converged — no fixable findings");
      break;
    }

    if (!testsPass) {
      exitReason = "test-failure";
      onProgress?.(i, "done", "Tests failing — exiting loop");
      break;
    }

    if (fixResult && fixResult.unfixed.length === 0) {
      // All fixable findings were fixed — re-review to check for regressions
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
    deferredFindings: allDeferredFindings,
  };
}
