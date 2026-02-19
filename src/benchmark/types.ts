/**
 * Benchmark harness type definitions.
 *
 * All interfaces for suite definitions, case results, metrics,
 * and comparison outputs.
 */
import type { PlanningSubPhase } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Suite Definition
// ---------------------------------------------------------------------------

/** Complexity hint for a benchmark idea. */
export type BenchmarkComplexity = "trivial" | "simple" | "moderate" | "complex";

/** The pipeline phase to stop after (inclusive). */
export type StopAfterPhase = "PLANNING" | "BRIDGING" | "BUILDING" | "REVIEWING";

/** Expected outcome for a benchmark case. */
export interface BenchmarkExpectation {
  /** The metric to check. */
  metric: "viability_recommendation" | "phase_reached" | "success";
  /** Expected value. */
  expected: string | boolean;
}

/** A single benchmark case — one idea to run through the pipeline. */
export interface BenchmarkCase {
  /** Unique ID within the suite. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** The project idea to feed to the pipeline. */
  idea: string;
  /** Complexity hint for categorisation. */
  complexity: BenchmarkComplexity;
  /** Stop the pipeline after this phase. Defaults to "PLANNING". */
  stopAfter?: StopAfterPhase;
  /** Optional assertions on the result. */
  expectations?: BenchmarkExpectation[];
}

/** Execution mode. */
export type BenchmarkMode = "dry-run" | "live";

/** A suite of benchmark cases to run together. */
export interface BenchmarkSuite {
  /** Unique suite ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this suite tests. */
  description: string;
  /** Default mode for this suite. Can be overridden at CLI. */
  mode: BenchmarkMode;
  /** Ordered list of cases. */
  cases: BenchmarkCase[];
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Token usage from a single API call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Metrics captured for a single pipeline phase. */
export interface PhaseMetrics {
  /** The phase that was measured. */
  phase: PlanningSubPhase;
  /** Whether the phase succeeded. */
  success: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Token usage from Claude API. */
  tokenUsage: TokenUsage;
  /** Number of retries before success/failure. */
  retryCount: number;
  /** Error message if the phase failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Result of evaluating a single expectation. */
export interface ExpectationResult {
  /** The expectation that was evaluated. */
  expectation: BenchmarkExpectation;
  /** Whether the expectation was met. */
  passed: boolean;
  /** Actual value observed. */
  actual: string | boolean;
}

/** Result of running a single benchmark case. */
export interface BenchmarkCaseResult {
  /** Case ID from the suite. */
  caseId: string;
  /** Whether the case completed without terminal errors. */
  success: boolean;
  /** The last pipeline phase that completed. */
  lastPhaseReached: PlanningSubPhase | "none";
  /** Mode the case ran in. */
  mode: BenchmarkMode;
  /** Total wall-clock duration in milliseconds. */
  totalDurationMs: number;
  /** Per-phase metrics. */
  phases: PhaseMetrics[];
  /** Aggregate token usage. */
  totalTokenUsage: TokenUsage;
  /** Aggregate retry count. */
  totalRetries: number;
  /** Terminal error if the case failed. */
  terminalError?: string;
  /** Results of expectation checks. */
  expectationResults: ExpectationResult[];
}

/** Summary statistics for a benchmark run. */
export interface BenchmarkSummary {
  /** Total cases in the suite. */
  totalCases: number;
  /** Cases that succeeded. */
  passed: number;
  /** Cases that failed. */
  failed: number;
  /** Total wall-clock duration across all cases. */
  totalDurationMs: number;
  /** Aggregate token usage across all cases. */
  totalTokenUsage: TokenUsage;
  /** Aggregate retry count across all cases. */
  totalRetries: number;
}

/** Result of running a full benchmark suite. */
export interface BenchmarkResult {
  /** Suite ID. */
  suiteId: string;
  /** ISO-8601 timestamp when the run started. */
  startedAt: string;
  /** ISO-8601 timestamp when the run completed. */
  completedAt: string;
  /** Git commit hash at time of run. */
  gitCommit: string;
  /** Boop version at time of run. */
  boopVersion: string;
  /** Mode the suite ran in. */
  mode: BenchmarkMode;
  /** Per-case results. */
  cases: BenchmarkCaseResult[];
  /** Aggregate summary. */
  summary: BenchmarkSummary;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Comparison of a single case between two runs. */
export interface CaseComparison {
  /** Case ID. */
  caseId: string;
  /** Duration change in milliseconds (positive = slower). */
  durationDeltaMs: number;
  /** Duration change as a percentage. */
  durationDeltaPct: number;
  /** Token change (positive = more tokens). */
  tokenDelta: number;
  /** Token change as a percentage. */
  tokenDeltaPct: number;
  /** Whether success status changed. */
  statusChanged: boolean;
  /** Baseline success. */
  baselineSuccess: boolean;
  /** Current success. */
  currentSuccess: boolean;
}

/** A detected regression between two runs. */
export interface Regression {
  /** Case ID. */
  caseId: string;
  /** What regressed. */
  metric: "duration" | "tokens" | "status";
  /** Human-readable description. */
  message: string;
}

/** Comparison of two benchmark runs. */
export interface BenchmarkComparison {
  /** Baseline run suite ID. */
  baselineId: string;
  /** Current run suite ID. */
  currentId: string;
  /** Per-case comparisons. */
  cases: CaseComparison[];
  /** Detected regressions. */
  regressions: Regression[];
}

// ---------------------------------------------------------------------------
// History Index
// ---------------------------------------------------------------------------

/** Metadata entry for a persisted benchmark run. */
export interface BenchmarkRunEntry {
  /** Unique run ID (filename stem). */
  runId: string;
  /** Suite ID. */
  suiteId: string;
  /** ISO-8601 start timestamp. */
  startedAt: string;
  /** Mode. */
  mode: BenchmarkMode;
  /** Passed case count. */
  passed: number;
  /** Failed case count. */
  failed: number;
  /** Git commit. */
  gitCommit: string;
}
