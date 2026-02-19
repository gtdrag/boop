import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector } from "./metrics-collector.js";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  it("records a successful phase with timing and tokens", async () => {
    const result = await collector.recordPhase("viability", async () => ({
      assessment: "looks good",
      usage: { inputTokens: 100, outputTokens: 200 },
    }));

    expect(result.assessment).toBe("looks good");

    const phases = collector.getPhases();
    expect(phases).toHaveLength(1);
    expect(phases[0]!.phase).toBe("viability");
    expect(phases[0]!.success).toBe(true);
    expect(phases[0]!.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 200 });
    expect(phases[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(phases[0]!.error).toBeUndefined();
  });

  it("records a failed phase with error", async () => {
    await expect(
      collector.recordPhase("prd", async () => {
        throw new Error("API rate limit");
      }),
    ).rejects.toThrow("API rate limit");

    const phases = collector.getPhases();
    expect(phases).toHaveLength(1);
    expect(phases[0]!.phase).toBe("prd");
    expect(phases[0]!.success).toBe(false);
    expect(phases[0]!.error).toBe("API rate limit");
    expect(phases[0]!.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("tracks retries via recordPhaseWithRetries", async () => {
    // Simulate a function that retries internally: onRetry is called
    // by the retry wrapper's onRetry callback, not by the fn itself.
    const result = await collector.recordPhaseWithRetries("architecture", async () => {
      // Simulate 2 retries happened (e.g., from a retry wrapper calling onRetry)
      collector.onRetry();
      collector.onRetry();
      return { architecture: "done", usage: { inputTokens: 50, outputTokens: 150 } };
    });

    expect(result.architecture).toBe("done");

    const phases = collector.getPhases();
    expect(phases).toHaveLength(1);
    expect(phases[0]!.retryCount).toBe(2);
  });

  it("accumulates multiple phases", async () => {
    await collector.recordPhase("viability", async () => ({
      usage: { inputTokens: 100, outputTokens: 200 },
    }));
    await collector.recordPhase("prd", async () => ({
      usage: { inputTokens: 300, outputTokens: 400 },
    }));

    expect(collector.getPhases()).toHaveLength(2);
    expect(collector.getTotalTokenUsage()).toEqual({
      inputTokens: 400,
      outputTokens: 600,
    });
  });

  it("computes total retries across phases", async () => {
    await collector.recordPhaseWithRetries("viability", async () => {
      collector.onRetry();
      return { usage: { inputTokens: 10, outputTokens: 20 } };
    });

    await collector.recordPhaseWithRetries("prd", async () => {
      collector.onRetry();
      collector.onRetry();
      return { usage: { inputTokens: 30, outputTokens: 40 } };
    });

    expect(collector.getTotalRetries()).toBe(3);
  });

  it("computes total duration", async () => {
    await collector.recordPhase("viability", async () => ({
      usage: { inputTokens: 0, outputTokens: 0 },
    }));
    await collector.recordPhase("prd", async () => ({
      usage: { inputTokens: 0, outputTokens: 0 },
    }));

    expect(collector.getTotalDurationMs()).toBeGreaterThanOrEqual(0);
  });

  it("returns last phase reached", async () => {
    await collector.recordPhase("viability", async () => ({
      usage: { inputTokens: 0, outputTokens: 0 },
    }));
    await collector.recordPhase("prd", async () => ({
      usage: { inputTokens: 0, outputTokens: 0 },
    }));
    await expect(
      collector.recordPhase("architecture", async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();

    expect(collector.getLastPhaseReached()).toBe("prd");
  });

  it("returns 'none' when no phases succeeded", async () => {
    await expect(
      collector.recordPhase("viability", async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();

    expect(collector.getLastPhaseReached()).toBe("none");
  });

  it("resets all metrics", async () => {
    await collector.recordPhase("viability", async () => ({
      usage: { inputTokens: 100, outputTokens: 200 },
    }));

    collector.reset();
    expect(collector.getPhases()).toHaveLength(0);
    expect(collector.getTotalTokenUsage()).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
