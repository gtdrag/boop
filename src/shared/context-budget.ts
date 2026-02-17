/**
 * Context budget tracker — estimates token usage and signals rotation.
 *
 * Uses a simple heuristic: characters / 4 ≈ tokens. The 70% threshold
 * (140k of 200k) gives plenty of margin — precision isn't critical,
 * just needs to prevent the quality cliff.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetConfig {
  /** Max context tokens. Defaults to 200_000. */
  maxTokens?: number;
  /** Rotation threshold (0–1). Defaults to 0.7 (70%). */
  threshold?: number;
}

export interface BudgetStatus {
  /** Estimated tokens consumed so far. */
  estimatedTokens: number;
  /** Max tokens allowed. */
  maxTokens: number;
  /** Threshold ratio (0–1). */
  threshold: number;
  /** Absolute token count that triggers rotation. */
  triggerAt: number;
  /** Whether rotation should happen now. */
  shouldRotate: boolean;
  /** Usage as a fraction (0–1). */
  usage: number;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 200_000;
const DEFAULT_THRESHOLD = 0.7;
const CHARS_PER_TOKEN = 4;

/**
 * Create a context budget tracker.
 *
 * Accumulates character counts from prompts and responses, estimates
 * token usage, and signals when rotation is needed.
 */
export function createBudgetTracker(config?: BudgetConfig) {
  const maxTokens = config?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const threshold = config?.threshold ?? DEFAULT_THRESHOLD;
  const triggerAt = Math.floor(maxTokens * threshold);

  let totalChars = 0;

  return {
    /**
     * Add characters to the running total.
     * Call this with each prompt sent and response received.
     */
    add(text: string): void {
      totalChars += text.length;
    },

    /**
     * Add a raw character count (when you don't have the string).
     */
    addChars(chars: number): void {
      totalChars += chars;
    },

    /**
     * Get the current budget status.
     */
    status(): BudgetStatus {
      const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
      return {
        estimatedTokens,
        maxTokens,
        threshold,
        triggerAt,
        shouldRotate: estimatedTokens >= triggerAt,
        usage: estimatedTokens / maxTokens,
      };
    },

    /**
     * Check if rotation should happen now.
     * Convenience shorthand for `status().shouldRotate`.
     */
    shouldRotate(): boolean {
      return Math.ceil(totalChars / CHARS_PER_TOKEN) >= triggerAt;
    },

    /**
     * Reset the tracker (after a rotation).
     */
    reset(): void {
      totalChars = 0;
    },
  };
}

/**
 * Estimate token count for a string.
 * Simple heuristic: chars / 4.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Format a rotation log message.
 */
export function formatRotationMessage(status: BudgetStatus): string {
  const kTokens = Math.round(status.estimatedTokens / 1000);
  return `Context rotation triggered at ~${kTokens}k tokens (${Math.round(status.usage * 100)}% of ${Math.round(status.maxTokens / 1000)}k). Resuming in fresh session.`;
}
