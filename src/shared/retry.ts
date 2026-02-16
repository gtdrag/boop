/**
 * Retry utility for Boop.
 *
 * Supports configurable max retries with exponential backoff and jitter.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts. Defaults to 3. */
  maxRetries?: number;
  /** Initial delay in milliseconds before the first retry. Defaults to 1000. */
  initialDelayMs?: number;
  /** Multiplier applied to the delay after each retry. Defaults to 2. */
  backoffMultiplier?: number;
  /** Maximum delay in milliseconds. Defaults to 30000. */
  maxDelayMs?: number;
  /** Whether to add random jitter to the delay. Defaults to true. */
  jitter?: boolean;
  /** Optional predicate to decide if an error is retryable. Defaults to always true. */
  isRetryable?: (error: unknown) => boolean;
  /** Optional callback invoked before each retry. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export class RetryError extends Error {
  /** The last error that caused the final failure. */
  readonly cause: unknown;
  /** Total number of attempts made (initial + retries). */
  readonly attempts: number;

  constructor(message: string, cause: unknown, attempts: number) {
    super(message);
    this.name = "RetryError";
    this.cause = cause;
    this.attempts = attempts;
  }
}

/**
 * Execute a function with retries and exponential backoff.
 *
 * @param fn - The async function to execute.
 * @param options - Retry configuration.
 * @returns The result of the function.
 * @throws RetryError if all attempts fail.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    backoffMultiplier = 2,
    maxDelayMs = 30_000,
    jitter = true,
    isRetryable = () => true,
    onRetry,
  } = options;

  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      if (attempt >= maxRetries || !isRetryable(error)) {
        break;
      }

      const actualDelay = jitter ? delay * (0.5 + Math.random()) : delay;

      onRetry?.(error, attempt + 1, actualDelay);

      await sleep(actualDelay);

      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw new RetryError(
    `All ${maxRetries + 1} attempts failed`,
    lastError,
    maxRetries + 1,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
