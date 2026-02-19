/**
 * Benchmark run persistence.
 *
 * Stores results to ~/.boop/benchmarks/ with an index.json
 * for fast listing and individual run JSON/markdown files.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { BenchmarkResult, BenchmarkRunEntry } from "./types.js";
import { toJson, toMarkdown } from "./scorecard.js";

const BENCHMARKS_DIR = "benchmarks";
const RUNS_DIR = "runs";
const INDEX_FILE = "index.json";

/** Resolve the benchmarks directory inside ~/.boop/. */
export function resolveBenchmarksDir(globalConfigDir?: string): string {
  const base = globalConfigDir ?? path.join(os.homedir(), ".boop");
  return path.join(base, BENCHMARKS_DIR);
}

/** Generate a run ID from suite ID and timestamp. */
export function generateRunId(suiteId: string, startedAt: string): string {
  const date = new Date(startedAt);
  const ts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ].join("-");
  return `${suiteId}-${ts}`;
}

/**
 * Save a benchmark result to disk.
 *
 * Writes:
 * - ~/.boop/benchmarks/runs/{runId}.json  — full result
 * - ~/.boop/benchmarks/runs/{runId}.md    — human-readable scorecard
 * - Updates ~/.boop/benchmarks/index.json — run metadata index
 *
 * @returns The generated run ID.
 */
export function saveResult(result: BenchmarkResult, globalConfigDir?: string): string {
  const benchDir = resolveBenchmarksDir(globalConfigDir);
  const runsDir = path.join(benchDir, RUNS_DIR);

  fs.mkdirSync(runsDir, { recursive: true });

  const runId = generateRunId(result.suiteId, result.startedAt);

  // Write JSON result
  const jsonPath = path.join(runsDir, `${runId}.json`);
  fs.writeFileSync(jsonPath, toJson(result), "utf-8");

  // Write markdown scorecard
  const mdPath = path.join(runsDir, `${runId}.md`);
  fs.writeFileSync(mdPath, toMarkdown(result), "utf-8");

  // Update index
  const entry: BenchmarkRunEntry = {
    runId,
    suiteId: result.suiteId,
    startedAt: result.startedAt,
    mode: result.mode,
    passed: result.summary.passed,
    failed: result.summary.failed,
    gitCommit: result.gitCommit,
  };

  const index = loadIndex(globalConfigDir);
  index.push(entry);
  const indexPath = path.join(benchDir, INDEX_FILE);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");

  return runId;
}

/**
 * Load a benchmark result by run ID.
 *
 * @returns The full BenchmarkResult, or null if not found.
 */
export function loadResult(
  runId: string,
  globalConfigDir?: string,
): BenchmarkResult | null {
  const benchDir = resolveBenchmarksDir(globalConfigDir);
  const jsonPath = path.join(benchDir, RUNS_DIR, `${runId}.json`);

  if (!fs.existsSync(jsonPath)) {
    return null;
  }

  const raw = fs.readFileSync(jsonPath, "utf-8");
  return JSON.parse(raw) as BenchmarkResult;
}

/**
 * Load the index of all benchmark runs.
 */
export function loadIndex(globalConfigDir?: string): BenchmarkRunEntry[] {
  const benchDir = resolveBenchmarksDir(globalConfigDir);
  const indexPath = path.join(benchDir, INDEX_FILE);

  if (!fs.existsSync(indexPath)) {
    return [];
  }

  const raw = fs.readFileSync(indexPath, "utf-8");
  return JSON.parse(raw) as BenchmarkRunEntry[];
}

/**
 * List all runs, optionally filtered by suite ID.
 */
export function listRuns(
  globalConfigDir?: string,
  suiteId?: string,
): BenchmarkRunEntry[] {
  const index = loadIndex(globalConfigDir);
  if (suiteId) {
    return index.filter((e) => e.suiteId === suiteId);
  }
  return index;
}

/**
 * Get the most recent run for a suite.
 */
export function getLatestRun(
  suiteId: string,
  globalConfigDir?: string,
): BenchmarkRunEntry | null {
  const runs = listRuns(globalConfigDir, suiteId);
  if (runs.length === 0) return null;
  // Index is append-only, so the last entry is the most recent
  return runs[runs.length - 1]!;
}
