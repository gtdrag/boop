/**
 * Metrics collector for benchmark runs.
 *
 * Accumulates per-phase timing, token usage, and retry counts.
 * Designed to wrap pipeline function calls and read their return values.
 */
import type { PlanningSubPhase } from "../shared/types.js";
import type { PhaseMetrics, TokenUsage } from "./types.js";

/** Collector that accumulates metrics for each planning sub-phase. */
export class MetricsCollector {
  private readonly phases: PhaseMetrics[] = [];

  /**
   * Record a phase execution.
   *
   * Wraps `fn` with timing, captures token usage from the return value,
   * and records retry count from the optional callback.
   */
  async recordPhase<T extends { usage: TokenUsage }>(
    phase: PlanningSubPhase,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now();
    let retryCount = 0;
    let success = false;
    let error: string | undefined;
    let tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    try {
      const result = await fn();
      success = true;
      tokenUsage = result.usage;
      return result;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const durationMs = performance.now() - start;
      this.phases.push({
        phase,
        success,
        durationMs,
        tokenUsage,
        retryCount,
        error,
      });
    }
  }

  /** Increment the retry count for the phase currently being recorded. */
  onRetry(): void {
    // This is called during recordPhase — the phase entry is added in finally,
    // so we track retries in a pending counter. We use a simpler approach:
    // the caller increments before the phase entry is finalized.
    // Since phases are appended in finally, we increment the last entry if present,
    // or track retries that will be applied to the current in-flight phase.
    this._pendingRetries++;
  }

  private _pendingRetries = 0;

  /**
   * Record a phase execution with integrated retry tracking.
   *
   * Same as `recordPhase` but also captures retries via the `onRetry` callback
   * that the caller's retry wrapper should invoke.
   */
  async recordPhaseWithRetries<T extends { usage: TokenUsage }>(
    phase: PlanningSubPhase,
    fn: () => Promise<T>,
  ): Promise<T> {
    this._pendingRetries = 0;
    const start = performance.now();
    let success = false;
    let error: string | undefined;
    let tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    try {
      const result = await fn();
      success = true;
      tokenUsage = result.usage;
      return result;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const durationMs = performance.now() - start;
      this.phases.push({
        phase,
        success,
        durationMs,
        tokenUsage,
        retryCount: this._pendingRetries,
        error,
      });
      this._pendingRetries = 0;
    }
  }

  /** Get all recorded phase metrics. */
  getPhases(): PhaseMetrics[] {
    return [...this.phases];
  }

  /** Get total token usage across all recorded phases. */
  getTotalTokenUsage(): TokenUsage {
    return this.phases.reduce(
      (acc, p) => ({
        inputTokens: acc.inputTokens + p.tokenUsage.inputTokens,
        outputTokens: acc.outputTokens + p.tokenUsage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    );
  }

  /** Get total retry count across all recorded phases. */
  getTotalRetries(): number {
    return this.phases.reduce((acc, p) => acc + p.retryCount, 0);
  }

  /** Get total duration across all recorded phases. */
  getTotalDurationMs(): number {
    return this.phases.reduce((acc, p) => acc + p.durationMs, 0);
  }

  /** Get the last phase that succeeded, or "none" if none did. */
  getLastPhaseReached(): PlanningSubPhase | "none" {
    const succeeded = this.phases.filter((p) => p.success);
    return succeeded.length > 0 ? succeeded[succeeded.length - 1]!.phase : "none";
  }

  /** Reset all collected metrics. */
  reset(): void {
    this.phases.length = 0;
    this._pendingRetries = 0;
  }
}
