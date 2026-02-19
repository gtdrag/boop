/**
 * Benchmark runner — executes cases against the pipeline.
 *
 * For dry-run mode, uses mock responses from fixtures.
 * For live mode, calls real pipeline functions.
 * Collects metrics via MetricsCollector.
 */
import { execSync } from "node:child_process";
import { MetricsCollector } from "./metrics-collector.js";
import { createMockSendMessage, resolveFixturesDir } from "./mock-provider.js";
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkExpectation,
  BenchmarkMode,
  BenchmarkResult,
  BenchmarkSuite,
  BenchmarkSummary,
  ExpectationResult,
} from "./types.js";
import type { PlanningSubPhase } from "../shared/types.js";
import { PLANNING_SUB_PHASES } from "../shared/types.js";
import { extractRecommendation } from "../planning/viability.js";
import { VERSION } from "../version.js";

/** Options for running a benchmark suite. */
export interface RunOptions {
  /** Override the mode from the suite definition. */
  mode?: BenchmarkMode;
  /** Project root for resolving fixtures. */
  projectRoot: string;
  /** Callback for progress reporting. */
  onProgress?: (caseId: string, phase: string, status: string) => void;
}

/** Get the current git commit hash, or "unknown" if not in a git repo. */
export function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Run a single benchmark case in dry-run mode.
 *
 * Feeds mock responses through the metrics collector to simulate
 * the planning chain without making real API calls.
 */
export async function runCaseDryRun(
  benchmarkCase: BenchmarkCase,
  projectRoot: string,
  onProgress?: RunOptions["onProgress"],
): Promise<BenchmarkCaseResult> {
  const collector = new MetricsCollector();
  const fixturesDir = resolveFixturesDir(projectRoot);
  const mockSend = createMockSendMessage(fixturesDir);

  const stopAfter = benchmarkCase.stopAfter ?? "PLANNING";
  const phasesToRun = getPhasesToRun(stopAfter);

  let viabilityText = "";
  let terminalError: string | undefined;

  for (const phase of phasesToRun) {
    onProgress?.(benchmarkCase.id, phase, "starting");

    try {
      const result = await collector.recordPhase(phase, async () => {
        const response = mockSend(phase);
        // Small delay to simulate API latency in dry-run
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { text: response.text, usage: response.usage };
      });

      if (phase === "viability") {
        viabilityText = result.text;
      }

      onProgress?.(benchmarkCase.id, phase, "completed");
    } catch (err: unknown) {
      terminalError = err instanceof Error ? err.message : String(err);
      onProgress?.(benchmarkCase.id, phase, "failed");
      break;
    }
  }

  const phases = collector.getPhases();
  const success = !terminalError && phases.every((p) => p.success);

  const expectationResults = evaluateExpectations(
    benchmarkCase.expectations ?? [],
    success,
    collector.getLastPhaseReached(),
    viabilityText,
  );

  return {
    caseId: benchmarkCase.id,
    success,
    lastPhaseReached: collector.getLastPhaseReached(),
    mode: "dry-run",
    totalDurationMs: collector.getTotalDurationMs(),
    phases,
    totalTokenUsage: collector.getTotalTokenUsage(),
    totalRetries: collector.getTotalRetries(),
    terminalError,
    expectationResults,
  };
}

/**
 * Run a single benchmark case in live mode.
 *
 * Calls real planning functions with the Claude API.
 * This costs money and requires a valid API key.
 */
export async function runCaseLive(
  benchmarkCase: BenchmarkCase,
  projectRoot: string,
  onProgress?: RunOptions["onProgress"],
): Promise<BenchmarkCaseResult> {
  const collector = new MetricsCollector();
  const stopAfter = benchmarkCase.stopAfter ?? "PLANNING";
  const phasesToRun = getPhasesToRun(stopAfter);

  // Dynamic imports to avoid loading heavy modules in dry-run
  const { assessViability } = await import("../planning/viability.js");
  const { generatePrd } = await import("../planning/prd.js");
  const { generateArchitecture } = await import("../planning/architecture.js");
  const { generateStories } = await import("../planning/stories.js");
  const { loadProfileFromDisk } = await import("../config/index.js");

  const profile = loadProfileFromDisk();
  if (!profile) {
    return {
      caseId: benchmarkCase.id,
      success: false,
      lastPhaseReached: "none",
      mode: "live",
      totalDurationMs: 0,
      phases: [],
      totalTokenUsage: { inputTokens: 0, outputTokens: 0 },
      totalRetries: 0,
      terminalError: "No developer profile found. Run 'boop --profile' first.",
      expectationResults: [],
    };
  }

  let viabilityText = "";
  let prdText = "";
  let architectureText = "";
  let terminalError: string | undefined;

  for (const phase of phasesToRun) {
    onProgress?.(benchmarkCase.id, phase, "starting");

    try {
      if (phase === "viability") {
        const result = await collector.recordPhase(phase, () =>
          assessViability(benchmarkCase.idea, profile, { projectDir: projectRoot }),
        );
        viabilityText = result.assessment;
      } else if (phase === "prd") {
        const result = await collector.recordPhase(phase, () =>
          generatePrd(benchmarkCase.idea, profile, viabilityText, { projectDir: projectRoot }),
        );
        prdText = result.prd;
      } else if (phase === "architecture") {
        const result = await collector.recordPhase(phase, () =>
          generateArchitecture(benchmarkCase.idea, profile, prdText, {
            projectDir: projectRoot,
          }),
        );
        architectureText = result.architecture;
      } else if (phase === "stories") {
        await collector.recordPhase(phase, () =>
          generateStories(benchmarkCase.idea, profile, prdText, architectureText, {
            projectDir: projectRoot,
          }),
        );
      }

      onProgress?.(benchmarkCase.id, phase, "completed");
    } catch (err: unknown) {
      terminalError = err instanceof Error ? err.message : String(err);
      onProgress?.(benchmarkCase.id, phase, "failed");
      break;
    }
  }

  const phases = collector.getPhases();
  const success = !terminalError && phases.every((p) => p.success);

  const expectationResults = evaluateExpectations(
    benchmarkCase.expectations ?? [],
    success,
    collector.getLastPhaseReached(),
    viabilityText,
  );

  return {
    caseId: benchmarkCase.id,
    success,
    lastPhaseReached: collector.getLastPhaseReached(),
    mode: "live",
    totalDurationMs: collector.getTotalDurationMs(),
    phases,
    totalTokenUsage: collector.getTotalTokenUsage(),
    totalRetries: collector.getTotalRetries(),
    terminalError,
    expectationResults,
  };
}

/**
 * Run a full benchmark suite.
 */
export async function runSuite(
  suite: BenchmarkSuite,
  options: RunOptions,
): Promise<BenchmarkResult> {
  const mode = options.mode ?? suite.mode;
  const startedAt = new Date().toISOString();
  const gitCommit = getGitCommit();

  const caseResults: BenchmarkCaseResult[] = [];

  for (const benchmarkCase of suite.cases) {
    const result =
      mode === "dry-run"
        ? await runCaseDryRun(benchmarkCase, options.projectRoot, options.onProgress)
        : await runCaseLive(benchmarkCase, options.projectRoot, options.onProgress);

    caseResults.push(result);
  }

  const completedAt = new Date().toISOString();

  const summary = computeSummary(caseResults);

  return {
    suiteId: suite.id,
    startedAt,
    completedAt,
    gitCommit,
    boopVersion: VERSION,
    mode,
    cases: caseResults,
    summary,
  };
}

/** Determine which planning sub-phases to run based on stopAfter. */
function getPhasesToRun(stopAfter: string): PlanningSubPhase[] {
  // For stopAfter: "PLANNING", run all 4 planning sub-phases.
  // For stopAfter beyond PLANNING, we still only run planning sub-phases
  // since that's what the benchmark currently supports.
  if (stopAfter === "PLANNING") {
    return [...PLANNING_SUB_PHASES];
  }

  // Future: when build/review benchmarking is added, extend here.
  // For now, always run the full planning chain.
  return [...PLANNING_SUB_PHASES];
}

/** Evaluate expectations against actual results. */
function evaluateExpectations(
  expectations: BenchmarkExpectation[],
  success: boolean,
  lastPhaseReached: PlanningSubPhase | "none",
  viabilityText: string,
): ExpectationResult[] {
  return expectations.map((exp) => {
    if (exp.metric === "success") {
      const actual = success;
      return { expectation: exp, passed: actual === exp.expected, actual };
    }

    if (exp.metric === "phase_reached") {
      const actual = lastPhaseReached;
      return { expectation: exp, passed: actual === exp.expected, actual };
    }

    if (exp.metric === "viability_recommendation") {
      const actual = viabilityText ? extractRecommendation(viabilityText) : "UNKNOWN";
      return { expectation: exp, passed: actual === exp.expected, actual };
    }

    return { expectation: exp, passed: false, actual: "unsupported metric" };
  });
}

/** Compute summary statistics from case results. */
function computeSummary(cases: BenchmarkCaseResult[]): BenchmarkSummary {
  const passed = cases.filter((c) => c.success).length;
  const failed = cases.length - passed;
  const totalDurationMs = cases.reduce((acc, c) => acc + c.totalDurationMs, 0);
  const totalTokenUsage = cases.reduce(
    (acc, c) => ({
      inputTokens: acc.inputTokens + c.totalTokenUsage.inputTokens,
      outputTokens: acc.outputTokens + c.totalTokenUsage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
  const totalRetries = cases.reduce((acc, c) => acc + c.totalRetries, 0);

  return {
    totalCases: cases.length,
    passed,
    failed,
    totalDurationMs,
    totalTokenUsage,
    totalRetries,
  };
}
