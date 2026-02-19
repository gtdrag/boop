/**
 * Gauntlet run persistence.
 *
 * Stores results to ~/.boop/gauntlet/ with an index.json
 * for fast listing and individual run JSON/markdown files.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GauntletResult, GauntletRunEntry } from "./types.js";
import { generateGauntletReport } from "./report.js";

const GAUNTLET_DIR = "gauntlet";
const RUNS_DIR = "runs";
const INDEX_FILE = "index.json";

/** Resolve the gauntlet history directory inside ~/.boop/. */
export function resolveGauntletHistoryDir(globalConfigDir?: string): string {
  const base = globalConfigDir ?? path.join(os.homedir(), ".boop");
  return path.join(base, GAUNTLET_DIR);
}

/** Generate a run ID from gauntlet ID and timestamp. */
export function generateRunId(gauntletId: string, startedAt: string): string {
  const date = new Date(startedAt);
  const ts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ].join("-");
  return `${gauntletId}-${ts}`;
}

/**
 * Save a gauntlet result to disk.
 *
 * Writes:
 * - ~/.boop/gauntlet/runs/{runId}.json  — full result
 * - ~/.boop/gauntlet/runs/{runId}.md    — human-readable report
 * - Updates ~/.boop/gauntlet/index.json — run metadata index
 *
 * @returns The run ID.
 */
export function saveGauntletResult(result: GauntletResult, globalConfigDir?: string): string {
  const gauntletDir = resolveGauntletHistoryDir(globalConfigDir);
  const runsDir = path.join(gauntletDir, RUNS_DIR);

  fs.mkdirSync(runsDir, { recursive: true });

  // Write JSON result
  const jsonPath = path.join(runsDir, `${result.runId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");

  // Write markdown report
  const mdPath = path.join(runsDir, `${result.runId}.md`);
  fs.writeFileSync(mdPath, generateGauntletReport(result), "utf-8");

  // Update index
  const entry: GauntletRunEntry = {
    runId: result.runId,
    gauntletId: result.gauntletId,
    startedAt: result.startedAt,
    passed: result.summary.passed,
    failed: result.summary.failed,
    gitCommit: result.gitCommit,
  };

  const index = loadGauntletIndex(globalConfigDir);
  index.push(entry);
  const indexPath = path.join(gauntletDir, INDEX_FILE);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");

  return result.runId;
}

/**
 * Load a gauntlet result by run ID.
 *
 * @returns The full GauntletResult, or null if not found.
 */
export function loadGauntletResult(
  runId: string,
  globalConfigDir?: string,
): GauntletResult | null {
  const gauntletDir = resolveGauntletHistoryDir(globalConfigDir);
  const jsonPath = path.join(gauntletDir, RUNS_DIR, `${runId}.json`);

  if (!fs.existsSync(jsonPath)) {
    return null;
  }

  const raw = fs.readFileSync(jsonPath, "utf-8");
  return JSON.parse(raw) as GauntletResult;
}

/**
 * Load the index of all gauntlet runs.
 */
export function loadGauntletIndex(globalConfigDir?: string): GauntletRunEntry[] {
  const gauntletDir = resolveGauntletHistoryDir(globalConfigDir);
  const indexPath = path.join(gauntletDir, INDEX_FILE);

  if (!fs.existsSync(indexPath)) {
    return [];
  }

  const raw = fs.readFileSync(indexPath, "utf-8");
  return JSON.parse(raw) as GauntletRunEntry[];
}

/**
 * List all gauntlet runs, optionally filtered by gauntlet ID.
 */
export function listGauntletRuns(
  globalConfigDir?: string,
  gauntletId?: string,
): GauntletRunEntry[] {
  const index = loadGauntletIndex(globalConfigDir);
  if (gauntletId) {
    return index.filter((e) => e.gauntletId === gauntletId);
  }
  return index;
}

/**
 * Get the most recent gauntlet run.
 */
export function getLatestGauntletRun(
  gauntletId?: string,
  globalConfigDir?: string,
): GauntletRunEntry | null {
  const runs = listGauntletRuns(globalConfigDir, gauntletId);
  if (runs.length === 0) return null;
  return runs[runs.length - 1]!;
}
