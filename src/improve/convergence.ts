/**
 * Convergence tracking — decides when the improve loop should stop.
 *
 * Tracks per-cycle finding counts and applies three stop conditions:
 *   1. Max depth reached
 *   2. Remaining findings below threshold (converged)
 *   3. Two consecutive cycles with identical remaining count (diminishing returns)
 */
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CycleResult {
  cycle: number;
  totalFindings: number;
  fixed: number;
  remaining: number;
  timestamp: string;
}

export interface ConvergenceState {
  cycles: CycleResult[];
  maxDepth: number;
  threshold: number;
}

export interface StopDecision {
  stop: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createConvergenceState(maxDepth: number, threshold = 2): ConvergenceState {
  return { cycles: [], maxDepth, threshold };
}

export function recordCycle(state: ConvergenceState, result: CycleResult): void {
  state.cycles.push(result);
}

export function shouldStop(state: ConvergenceState): StopDecision {
  const { cycles, maxDepth, threshold } = state;

  if (cycles.length === 0) {
    return { stop: false, reason: "no-cycles" };
  }

  // 1. Max depth
  if (cycles.length >= maxDepth) {
    return { stop: true, reason: "max-depth" };
  }

  const last = cycles[cycles.length - 1]!;

  // 2. Converged — remaining findings below threshold
  if (last.remaining <= threshold) {
    return { stop: true, reason: "converged" };
  }

  // 3. Diminishing returns — same remaining as previous cycle
  if (cycles.length >= 2) {
    const prev = cycles[cycles.length - 2]!;
    if (prev.remaining === last.remaining) {
      return { stop: true, reason: "diminishing-returns" };
    }
  }

  return { stop: false, reason: "continue" };
}

export function formatTrend(state: ConvergenceState): string {
  if (state.cycles.length === 0) return "No cycles completed.";

  const lines: string[] = ["Cycle | Findings | Fixed | Remaining", "------|----------|-------|----------"];

  for (const c of state.cycles) {
    lines.push(`  ${c.cycle}   |    ${c.totalFindings}     |   ${c.fixed}   |     ${c.remaining}`);
  }

  return lines.join("\n");
}

const CONVERGENCE_FILE = "convergence.json";

export function saveConvergenceState(projectDir: string, state: ConvergenceState): void {
  const dir = path.join(projectDir, ".boop");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, CONVERGENCE_FILE), JSON.stringify(state, null, 2), "utf-8");
}

export function loadConvergenceState(projectDir: string): ConvergenceState | null {
  const filePath = path.join(projectDir, ".boop", CONVERGENCE_FILE);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ConvergenceState;
  } catch {
    return null;
  }
}
