/**
 * Review team orchestrator — coordinates specialized review agents.
 *
 * Executes the review pipeline in a defined sequence:
 *   1. Parallel phase: code-reviewer + gap-analyst + tech-debt-auditor
 *   2. Refactoring agent (takes combined findings from step 1)
 *   3. Test hardener (runs after refactoring)
 *   4. Full test suite (validates everything still passes)
 *   5. Security scanner (SAST + dependency audit)
 *   6. Browser QA smoke test
 *   7. Sign-off gate (blocks on unresolved gaps, critical vulns, or QA crashes)
 */
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Review Sub-Phase Definitions
// ---------------------------------------------------------------------------

export const REVIEW_SUB_PHASES = [
  "code-review",
  "gap-analysis",
  "tech-debt",
  "refactoring",
  "test-hardening",
  "test-suite",
  "security-scan",
  "qa-smoke-test",
] as const;

export type ReviewSubPhase = (typeof REVIEW_SUB_PHASES)[number];

// ---------------------------------------------------------------------------
// Finding / Result Types
// ---------------------------------------------------------------------------

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ReviewFinding {
  /** Short title for the finding. */
  title: string;
  /** Severity level. */
  severity: FindingSeverity;
  /** File path involved (if applicable). */
  file?: string;
  /** Detailed description. */
  description: string;
}

export interface AgentResult {
  /** Which agent produced this result. */
  agent: ReviewSubPhase;
  /** Whether the agent completed successfully. */
  success: boolean;
  /** Markdown report content. */
  report: string;
  /** Structured findings. */
  findings: ReviewFinding[];
  /** Blocking issues (critical/high that prevent advancement). */
  blockingIssues: string[];
}

export interface TestSuiteResult {
  /** Whether all tests passed. */
  passed: boolean;
  /** Raw output from the test runner. */
  output: string;
}

export interface ReviewPhaseResult {
  /** Epic number that was reviewed. */
  epicNumber: number;
  /** Results from the parallel phase (code-review, gap-analysis, tech-debt). */
  parallelResults: AgentResult[];
  /** Result from the refactoring agent. */
  refactoringResult: AgentResult | null;
  /** Result from the test hardener. */
  testHardeningResult: AgentResult | null;
  /** Result from the post-fix test suite run. */
  testSuiteResult: TestSuiteResult | null;
  /** Result from the security scanner. */
  securityResult: AgentResult | null;
  /** Result from the QA smoke test. */
  qaResult: AgentResult | null;
  /** Whether the epic can advance (no blocking issues). */
  canAdvance: boolean;
  /** All blocking issues collected across all agents. */
  blockingIssues: string[];
  /** Last completed sub-phase. */
  lastCompletedPhase: ReviewSubPhase | null;
}

// ---------------------------------------------------------------------------
// Agent Function Signatures
// ---------------------------------------------------------------------------

/**
 * Context passed to every review agent.
 */
export interface ReviewContext {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Epic number being reviewed. */
  epicNumber: number;
  /** Directory to save review artifacts. */
  reviewDir: string;
}

/**
 * Function signature for a review agent.
 * Each agent receives context and returns a result.
 */
export type ReviewAgentFn = (context: ReviewContext) => Promise<AgentResult>;

/**
 * Function signature for the refactoring agent.
 * Receives combined findings from the parallel phase.
 */
export type RefactoringAgentFn = (
  context: ReviewContext,
  findings: ReviewFinding[],
) => Promise<AgentResult>;

/**
 * Function signature for running the project's test suite.
 */
export type TestSuiteRunnerFn = (projectDir: string) => Promise<TestSuiteResult>;

// ---------------------------------------------------------------------------
// Error Type
// ---------------------------------------------------------------------------

export class ReviewPhaseError extends Error {
  readonly phase: ReviewSubPhase | "parallel";
  readonly cause: unknown;

  constructor(phase: ReviewSubPhase | "parallel", cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Review phase "${phase}" failed: ${msg}`);
    this.name = "ReviewPhaseError";
    this.phase = phase;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Progress Callback
// ---------------------------------------------------------------------------

export type ReviewProgressCallback = (
  phase: ReviewSubPhase | "parallel",
  status: "starting" | "completed" | "failed",
) => void;

// ---------------------------------------------------------------------------
// Orchestrator Options
// ---------------------------------------------------------------------------

export interface ReviewOrchestratorOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Epic number being reviewed. */
  epicNumber: number;
  /** Optional progress callback. */
  onProgress?: ReviewProgressCallback;

  // Agent implementations (injected for testability)
  /** Code review agent. */
  codeReviewer: ReviewAgentFn;
  /** Gap analysis agent. */
  gapAnalyst: ReviewAgentFn;
  /** Tech debt auditor agent. */
  techDebtAuditor: ReviewAgentFn;
  /** Refactoring agent — runs after the parallel phase. */
  refactoringAgent: RefactoringAgentFn;
  /** Test hardening agent. */
  testHardener: ReviewAgentFn;
  /** Test suite runner (e.g. pnpm test). */
  testSuiteRunner: TestSuiteRunnerFn;
  /** Security scanner agent. */
  securityScanner: ReviewAgentFn;
  /** Browser QA smoke test agent. */
  qaSmokeTester: ReviewAgentFn;
}

// ---------------------------------------------------------------------------
// Helper: ensure review directory exists
// ---------------------------------------------------------------------------

function ensureReviewDir(projectDir: string, epicNumber: number): string {
  const reviewDir = path.join(projectDir, ".boop", "reviews", `epic-${epicNumber}`);
  fs.mkdirSync(reviewDir, { recursive: true });
  return reviewDir;
}

// ---------------------------------------------------------------------------
// Helper: save agent report
// ---------------------------------------------------------------------------

function saveAgentReport(reviewDir: string, filename: string, report: string): void {
  const filePath = path.join(reviewDir, filename);
  fs.writeFileSync(filePath, report, "utf-8");
}

// ---------------------------------------------------------------------------
// Helper: collect blocking issues
// ---------------------------------------------------------------------------

function collectBlockingIssues(results: AgentResult[]): string[] {
  const blocking: string[] = [];
  for (const result of results) {
    blocking.push(...result.blockingIssues);
  }
  return blocking;
}

// ---------------------------------------------------------------------------
// Helper: check if any findings are critical or high severity
// ---------------------------------------------------------------------------

function hasBlockingSeverity(findings: ReviewFinding[]): boolean {
  return findings.some((f) => f.severity === "critical" || f.severity === "high");
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full review pipeline for an epic.
 *
 * Sequence:
 *   1. Parallel: code-reviewer + gap-analyst + tech-debt-auditor
 *   2. Refactoring agent (with combined findings)
 *   3. Test hardener
 *   4. Full test suite
 *   5. Security scanner
 *   6. Browser QA smoke test
 *
 * Blocking conditions that prevent advancement:
 *   - Unresolved gaps (from gap analyst)
 *   - Critical/high vulnerabilities (from security scanner)
 *   - QA crashes or failures (from smoke test)
 *   - Test suite failures
 */
export async function runReviewPipeline(
  options: ReviewOrchestratorOptions,
): Promise<ReviewPhaseResult> {
  const { projectDir, epicNumber, onProgress } = options;
  const reviewDir = ensureReviewDir(projectDir, epicNumber);

  const context: ReviewContext = { projectDir, epicNumber, reviewDir };

  const result: ReviewPhaseResult = {
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

  // -----------------------------------------------------------------------
  // Step 1: Parallel phase — code-reviewer + gap-analyst + tech-debt-auditor
  // -----------------------------------------------------------------------
  onProgress?.("parallel", "starting");

  try {
    const [codeReview, gapAnalysis, techDebt] = await Promise.all([
      options.codeReviewer(context),
      options.gapAnalyst(context),
      options.techDebtAuditor(context),
    ]);

    result.parallelResults = [codeReview, gapAnalysis, techDebt];

    // Save individual reports
    saveAgentReport(reviewDir, "code-review.md", codeReview.report);
    saveAgentReport(reviewDir, "gap-analysis.md", gapAnalysis.report);
    saveAgentReport(reviewDir, "tech-debt.md", techDebt.report);

    // Collect blocking issues from parallel phase
    const parallelBlocking = collectBlockingIssues(result.parallelResults);
    result.blockingIssues.push(...parallelBlocking);

    result.lastCompletedPhase = "tech-debt";
    onProgress?.("parallel", "completed");
  } catch (error: unknown) {
    onProgress?.("parallel", "failed");
    throw new ReviewPhaseError("parallel", error);
  }

  // -----------------------------------------------------------------------
  // Step 2: Refactoring agent — takes combined findings from parallel phase
  // -----------------------------------------------------------------------
  onProgress?.("refactoring", "starting");

  try {
    const allFindings = result.parallelResults.flatMap((r) => r.findings);
    const refactoring = await options.refactoringAgent(context, allFindings);
    result.refactoringResult = refactoring;
    saveAgentReport(reviewDir, "refactoring.md", refactoring.report);
    result.blockingIssues.push(...refactoring.blockingIssues);
    result.lastCompletedPhase = "refactoring";
    onProgress?.("refactoring", "completed");
  } catch (error: unknown) {
    onProgress?.("refactoring", "failed");
    throw new ReviewPhaseError("refactoring", error);
  }

  // -----------------------------------------------------------------------
  // Step 3: Test hardener
  // -----------------------------------------------------------------------
  onProgress?.("test-hardening", "starting");

  try {
    const testHardening = await options.testHardener(context);
    result.testHardeningResult = testHardening;
    saveAgentReport(reviewDir, "test-hardening.md", testHardening.report);
    result.blockingIssues.push(...testHardening.blockingIssues);
    result.lastCompletedPhase = "test-hardening";
    onProgress?.("test-hardening", "completed");
  } catch (error: unknown) {
    onProgress?.("test-hardening", "failed");
    throw new ReviewPhaseError("test-hardening", error);
  }

  // -----------------------------------------------------------------------
  // Step 4: Full test suite run
  // -----------------------------------------------------------------------
  onProgress?.("test-suite", "starting");

  try {
    const testSuite = await options.testSuiteRunner(projectDir);
    result.testSuiteResult = testSuite;

    if (!testSuite.passed) {
      result.blockingIssues.push("Test suite failed after review fixes");
      result.canAdvance = false;
    }

    result.lastCompletedPhase = "test-suite";
    onProgress?.("test-suite", "completed");
  } catch (error: unknown) {
    onProgress?.("test-suite", "failed");
    throw new ReviewPhaseError("test-suite", error);
  }

  // If tests failed, stop here — no point running security/QA on broken code
  if (!result.testSuiteResult?.passed) {
    result.canAdvance = false;
    return result;
  }

  // -----------------------------------------------------------------------
  // Step 5: Security scanner (SAST + dependency audit)
  // -----------------------------------------------------------------------
  onProgress?.("security-scan", "starting");

  try {
    const security = await options.securityScanner(context);
    result.securityResult = security;
    saveAgentReport(reviewDir, "security-scan.md", security.report);

    // Critical/high vulnerabilities block advancement
    if (hasBlockingSeverity(security.findings)) {
      const blockingVulns = security.findings
        .filter((f) => f.severity === "critical" || f.severity === "high")
        .map((f) => `[${f.severity}] ${f.title}`);
      result.blockingIssues.push(...blockingVulns);
    }
    result.blockingIssues.push(...security.blockingIssues);

    result.lastCompletedPhase = "security-scan";
    onProgress?.("security-scan", "completed");
  } catch (error: unknown) {
    onProgress?.("security-scan", "failed");
    throw new ReviewPhaseError("security-scan", error);
  }

  // -----------------------------------------------------------------------
  // Step 6: Browser QA smoke test
  // -----------------------------------------------------------------------
  onProgress?.("qa-smoke-test", "starting");

  try {
    const qa = await options.qaSmokeTester(context);
    result.qaResult = qa;

    // QA results go in a subdirectory
    const qaDir = path.join(reviewDir, "qa-smoke-test");
    fs.mkdirSync(qaDir, { recursive: true });
    saveAgentReport(qaDir, "results.md", qa.report);

    // QA failures block advancement
    if (!qa.success) {
      result.blockingIssues.push("QA smoke test failed — app crashes or console errors detected");
    }
    result.blockingIssues.push(...qa.blockingIssues);

    result.lastCompletedPhase = "qa-smoke-test";
    onProgress?.("qa-smoke-test", "completed");
  } catch (error: unknown) {
    onProgress?.("qa-smoke-test", "failed");
    throw new ReviewPhaseError("qa-smoke-test", error);
  }

  // -----------------------------------------------------------------------
  // Final: determine if epic can advance
  // -----------------------------------------------------------------------
  result.canAdvance = result.blockingIssues.length === 0;

  return result;
}
