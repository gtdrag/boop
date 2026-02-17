/**
 * Epic summary generation and sign-off gate.
 *
 * After the review pipeline completes, this module:
 *   1. Generates an epic summary from all review results
 *   2. Saves the summary to .boop/reviews/epic-N/summary.md
 *   3. Pauses for user approval (unless --autonomous)
 *   4. On rejection, re-enters the review pipeline at the refactoring step
 */
import fs from "node:fs";
import path from "node:path";
import type {
  ReviewPhaseResult,
  AgentResult,
  ReviewFinding,
  ReviewContext,
  RefactoringAgentFn,
  ReviewAgentFn,
  TestSuiteRunnerFn,
} from "../review/team-orchestrator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EpicSummary {
  /** Epic number. */
  epicNumber: number;
  /** Generated markdown summary. */
  markdown: string;
  /** Whether the epic can advance (no blocking issues). */
  canAdvance: boolean;
  /** All blocking issues. */
  blockingIssues: string[];
  /** Path where summary was saved. */
  summaryPath: string;
}

export type SignOffDecision =
  | { action: "approve" }
  | { action: "reject"; feedback: string };

/**
 * Function that prompts the user for sign-off.
 * Returns their decision (approve or reject with feedback).
 */
export type SignOffPromptFn = (summary: EpicSummary) => Promise<SignOffDecision>;

/**
 * Agents needed for the rejection/fix cycle.
 * Only the refactoring → test-hardener → test-suite → security → QA portion.
 */
export interface FixCycleAgents {
  refactoringAgent: RefactoringAgentFn;
  testHardener: ReviewAgentFn;
  testSuiteRunner: TestSuiteRunnerFn;
  securityScanner: ReviewAgentFn;
  qaSmokeTester: ReviewAgentFn;
}

export interface EpicLoopOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Epic number being reviewed. */
  epicNumber: number;
  /** The review pipeline result to summarize. */
  reviewResult: ReviewPhaseResult;
  /** Whether running in autonomous mode (skip sign-off). */
  autonomous?: boolean;
  /** Sign-off prompt function (for interactive mode). */
  signOffPrompt?: SignOffPromptFn;
  /** Agents for the rejection/fix cycle. */
  fixCycleAgents?: FixCycleAgents;
  /** Maximum rejection cycles before forcing a decision. */
  maxRejectionCycles?: number;
}

// ---------------------------------------------------------------------------
// Summary Generation
// ---------------------------------------------------------------------------

function formatFindingsSummary(findings: ReviewFinding[]): string {
  if (findings.length === 0) return "No findings.\n";

  const bySeverity = new Map<string, number>();
  for (const f of findings) {
    bySeverity.set(f.severity, (bySeverity.get(f.severity) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push(`| Severity | Count |`);
  lines.push(`| -------- | ----- |`);
  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    const count = bySeverity.get(sev);
    if (count) {
      lines.push(`| ${sev} | ${count} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function formatAgentSection(label: string, result: AgentResult | null): string {
  if (!result) return `### ${label}\n\nSkipped.\n\n`;

  const status = result.success ? "Passed" : "Failed";
  const lines: string[] = [];
  lines.push(`### ${label}`);
  lines.push("");
  lines.push(`**Status:** ${status}`);
  lines.push("");

  if (result.findings.length > 0) {
    lines.push(formatFindingsSummary(result.findings));
  } else {
    lines.push("No findings.\n");
  }

  if (result.blockingIssues.length > 0) {
    lines.push("**Blocking Issues:**");
    for (const issue of result.blockingIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatTestSuiteSection(result: ReviewPhaseResult): string {
  const lines: string[] = [];
  lines.push("### Test Suite");
  lines.push("");

  if (!result.testSuiteResult) {
    lines.push("Skipped.\n");
    return lines.join("\n");
  }

  const status = result.testSuiteResult.passed ? "Passed" : "Failed";
  lines.push(`**Status:** ${status}`);
  lines.push("");
  return lines.join("\n");
}

function formatScreenshotsSection(projectDir: string, epicNumber: number): string {
  const qaDir = path.join(projectDir, ".boop", "reviews", `epic-${epicNumber}`, "qa-smoke-test");
  const lines: string[] = [];

  try {
    const files = fs.readdirSync(qaDir).filter((f) => f.endsWith(".png"));
    if (files.length > 0) {
      lines.push("**Screenshots:**");
      for (const file of files) {
        const routeName = file.replace(".png", "").replace(/_/g, "/");
        lines.push(`- \`/${routeName}\`: ![${routeName}](qa-smoke-test/${file})`);
      }
      lines.push("");
    }
  } catch {
    // QA dir doesn't exist or no screenshots — that's fine
  }

  return lines.join("\n");
}

/**
 * Generate an epic summary from review pipeline results.
 */
export function generateEpicSummary(
  projectDir: string,
  epicNumber: number,
  reviewResult: ReviewPhaseResult,
): EpicSummary {
  const lines: string[] = [];

  lines.push(`# Epic ${epicNumber} Review Summary`);
  lines.push("");
  lines.push(`**Date:** ${new Date().toISOString()}`);
  lines.push(`**Can Advance:** ${reviewResult.canAdvance ? "Yes" : "No"}`);
  lines.push("");

  // Blocking issues overview
  if (reviewResult.blockingIssues.length > 0) {
    lines.push("## Blocking Issues");
    lines.push("");
    for (const issue of reviewResult.blockingIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push("");
  }

  // Parallel phase results
  lines.push("## Review Results");
  lines.push("");

  const codeReview = reviewResult.parallelResults.find((r) => r.agent === "code-review") ?? null;
  const gapAnalysis =
    reviewResult.parallelResults.find((r) => r.agent === "gap-analysis") ?? null;
  const techDebt = reviewResult.parallelResults.find((r) => r.agent === "tech-debt") ?? null;

  lines.push(formatAgentSection("Code Review", codeReview));
  lines.push(formatAgentSection("Gap Analysis", gapAnalysis));
  lines.push(formatAgentSection("Tech Debt", techDebt));
  lines.push(formatAgentSection("Refactoring", reviewResult.refactoringResult));
  lines.push(formatAgentSection("Test Hardening", reviewResult.testHardeningResult));
  lines.push(formatTestSuiteSection(reviewResult));
  lines.push(formatAgentSection("Security Scan", reviewResult.securityResult));
  lines.push(formatAgentSection("QA Smoke Test", reviewResult.qaResult));

  // Screenshots from QA
  const screenshotsSection = formatScreenshotsSection(projectDir, epicNumber);
  if (screenshotsSection) {
    lines.push(screenshotsSection);
  }

  // All findings count
  const allFindings = [
    ...reviewResult.parallelResults.flatMap((r) => r.findings),
    ...(reviewResult.refactoringResult?.findings ?? []),
    ...(reviewResult.testHardeningResult?.findings ?? []),
    ...(reviewResult.securityResult?.findings ?? []),
    ...(reviewResult.qaResult?.findings ?? []),
  ];

  lines.push("## Overall Findings");
  lines.push("");
  lines.push(`**Total Findings:** ${allFindings.length}`);
  lines.push("");
  lines.push(formatFindingsSummary(allFindings));

  const markdown = lines.join("\n");

  // Save summary
  const reviewDir = path.join(projectDir, ".boop", "reviews", `epic-${epicNumber}`);
  fs.mkdirSync(reviewDir, { recursive: true });
  const summaryPath = path.join(reviewDir, "summary.md");
  fs.writeFileSync(summaryPath, markdown, "utf-8");

  return {
    epicNumber,
    markdown,
    canAdvance: reviewResult.canAdvance,
    blockingIssues: [...reviewResult.blockingIssues],
    summaryPath,
  };
}

// ---------------------------------------------------------------------------
// Fix Cycle (rejection flow)
// ---------------------------------------------------------------------------

/**
 * Run the fix cycle: refactoring → test-hardener → test-suite → security → QA.
 * This is a subset of the full review pipeline, triggered on rejection.
 */
export async function runFixCycle(
  context: ReviewContext,
  feedback: string,
  previousFindings: ReviewFinding[],
  agents: FixCycleAgents,
): Promise<ReviewPhaseResult> {
  const result: ReviewPhaseResult = {
    epicNumber: context.epicNumber,
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

  // Add user feedback as a finding so the refactoring agent addresses it
  const feedbackFindings: ReviewFinding[] = [
    ...previousFindings,
    {
      title: "User feedback during sign-off",
      severity: "high",
      description: feedback,
    },
  ];

  // Step 1: Refactoring agent with user feedback
  const refactoring = await agents.refactoringAgent(context, feedbackFindings);
  result.refactoringResult = refactoring;
  result.blockingIssues.push(...refactoring.blockingIssues);
  result.lastCompletedPhase = "refactoring";

  // Step 2: Test hardener
  const testHardening = await agents.testHardener(context);
  result.testHardeningResult = testHardening;
  result.blockingIssues.push(...testHardening.blockingIssues);
  result.lastCompletedPhase = "test-hardening";

  // Step 3: Test suite
  const testSuite = await agents.testSuiteRunner(context.projectDir);
  result.testSuiteResult = testSuite;
  if (!testSuite.passed) {
    result.blockingIssues.push("Test suite failed after fix cycle");
    result.canAdvance = false;
    result.lastCompletedPhase = "test-suite";
    return result;
  }
  result.lastCompletedPhase = "test-suite";

  // Step 4: Security scanner
  const security = await agents.securityScanner(context);
  result.securityResult = security;
  const blockingVulns = security.findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .map((f) => `[${f.severity}] ${f.title}`);
  result.blockingIssues.push(...blockingVulns);
  result.blockingIssues.push(...security.blockingIssues);
  result.lastCompletedPhase = "security-scan";

  // Step 5: QA smoke test
  const qa = await agents.qaSmokeTester(context);
  result.qaResult = qa;
  if (!qa.success) {
    result.blockingIssues.push("QA smoke test failed during fix cycle");
  }
  result.blockingIssues.push(...qa.blockingIssues);
  result.lastCompletedPhase = "qa-smoke-test";

  result.canAdvance = result.blockingIssues.length === 0;
  return result;
}

// ---------------------------------------------------------------------------
// Epic Loop (sign-off gate)
// ---------------------------------------------------------------------------

export interface EpicLoopResult {
  /** Final summary after all cycles. */
  summary: EpicSummary;
  /** Whether the user approved (or autonomous mode). */
  approved: boolean;
  /** Number of rejection/fix cycles that ran. */
  rejectionCycles: number;
}

/**
 * Run the epic sign-off loop.
 *
 * 1. Generates an epic summary from the review result.
 * 2. If autonomous mode, returns immediately (auto-approved).
 * 3. Otherwise, prompts the user for sign-off.
 * 4. If rejected, runs a fix cycle with user feedback, regenerates summary, re-prompts.
 * 5. Repeats until approved or max cycles reached.
 */
export async function runEpicSignOff(options: EpicLoopOptions): Promise<EpicLoopResult> {
  const {
    projectDir,
    epicNumber,
    autonomous = false,
    signOffPrompt,
    fixCycleAgents,
    maxRejectionCycles = 3,
  } = options;

  let currentReviewResult = options.reviewResult;
  let rejectionCycles = 0;

  // Generate initial summary
  let summary = generateEpicSummary(projectDir, epicNumber, currentReviewResult);

  // Autonomous mode: skip sign-off
  if (autonomous) {
    return { summary, approved: true, rejectionCycles: 0 };
  }

  // Interactive sign-off loop
  if (!signOffPrompt) {
    // No prompt function provided — treat as approval (for non-interactive contexts)
    return { summary, approved: true, rejectionCycles: 0 };
  }

  while (rejectionCycles < maxRejectionCycles) {
    const decision = await signOffPrompt(summary);

    if (decision.action === "approve") {
      return { summary, approved: true, rejectionCycles };
    }

    // Rejection: run fix cycle
    if (!fixCycleAgents) {
      // No agents to fix — just return unapproved
      return { summary, approved: false, rejectionCycles };
    }

    rejectionCycles++;

    const reviewDir = path.join(projectDir, ".boop", "reviews", `epic-${epicNumber}`);
    const context: ReviewContext = { projectDir, epicNumber, reviewDir };

    // Collect all previous findings for the fix cycle
    const previousFindings = [
      ...currentReviewResult.parallelResults.flatMap((r) => r.findings),
      ...(currentReviewResult.refactoringResult?.findings ?? []),
      ...(currentReviewResult.testHardeningResult?.findings ?? []),
      ...(currentReviewResult.securityResult?.findings ?? []),
      ...(currentReviewResult.qaResult?.findings ?? []),
    ];

    currentReviewResult = await runFixCycle(
      context,
      decision.feedback,
      previousFindings,
      fixCycleAgents,
    );

    // Regenerate summary with new results
    summary = generateEpicSummary(projectDir, epicNumber, currentReviewResult);
  }

  // Max cycles reached — return unapproved
  return { summary, approved: false, rejectionCycles };
}
