import { describe, expect, it } from "vitest";
import { retry, RetryError } from "./retry.js";

describe("retry", () => {
  it("returns result on first success", async () => {
    const result = await retry(async () => 42);
    expect(result).toBe(42);
  });

  it("retries on failure and succeeds", async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("not yet");
        return "done";
      },
      { maxRetries: 3, initialDelayMs: 1, jitter: false },
    );
    expect(result).toBe("done");
    expect(calls).toBe(3);
  });

  it("throws RetryError after all attempts fail", async () => {
    const fn = async () => {
      throw new Error("always fails");
    };

    await expect(retry(fn, { maxRetries: 2, initialDelayMs: 1, jitter: false })).rejects.toThrow(
      RetryError,
    );

    try {
      await retry(fn, { maxRetries: 2, initialDelayMs: 1, jitter: false });
    } catch (err) {
      expect(err).toBeInstanceOf(RetryError);
      const retryErr = err as RetryError;
      expect(retryErr.attempts).toBe(3);
      expect(retryErr.cause).toBeInstanceOf(Error);
      expect(retryErr.message).toBe("All 3 attempts failed");
    }
  });

  it("respects isRetryable predicate", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("non-retryable");
    };

    await expect(
      retry(fn, {
        maxRetries: 5,
        initialDelayMs: 1,
        isRetryable: () => false,
      }),
    ).rejects.toThrow(RetryError);

    // Should only call once — not retryable
    expect(calls).toBe(1);
  });

  it("calls onRetry callback before each retry", async () => {
    let calls = 0;
    const retryLog: Array<{ attempt: number; delay: number }> = [];

    await retry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("fail");
        return "ok";
      },
      {
        maxRetries: 3,
        initialDelayMs: 10,
        jitter: false,
        onRetry: (_err, attempt, delay) => {
          retryLog.push({ attempt, delay });
        },
      },
    );

    expect(retryLog).toHaveLength(2);
    expect(retryLog[0]!.attempt).toBe(1);
    expect(retryLog[0]!.delay).toBe(10);
    expect(retryLog[1]!.attempt).toBe(2);
    expect(retryLog[1]!.delay).toBe(20); // 10 * 2 backoff
  });

  it("applies exponential backoff", async () => {
    const delays: number[] = [];
    const fn = async () => {
      throw new Error("fail");
    };

    await retry(fn, {
      maxRetries: 3,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      jitter: false,
      onRetry: (_err, _attempt, delay) => {
        delays.push(delay);
      },
    }).catch(() => {});

    expect(delays).toEqual([100, 200, 400]);
  });

  it("caps delay at maxDelayMs", async () => {
    const delays: number[] = [];
    const fn = async () => {
      throw new Error("fail");
    };

    await retry(fn, {
      maxRetries: 4,
      initialDelayMs: 100,
      backoffMultiplier: 10,
      maxDelayMs: 500,
      jitter: false,
      onRetry: (_err, _attempt, delay) => {
        delays.push(delay);
      },
    }).catch(() => {});

    // 100, 500 (1000 capped), 500 (5000 capped), 500 (50000 capped)
    expect(delays).toEqual([100, 500, 500, 500]);
  });

  it("works with maxRetries=0 (no retries)", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new Error("fail");
        },
        { maxRetries: 0 },
      ),
    ).rejects.toThrow(RetryError);
    expect(calls).toBe(1);
  });
});
