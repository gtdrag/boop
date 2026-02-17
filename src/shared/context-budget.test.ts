import { describe, expect, it } from "vitest";

import { createBudgetTracker, estimateTokens, formatRotationMessage } from "./context-budget.js";

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("estimates 1 token per 4 characters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("rounds up", () => {
    expect(estimateTokens("abc")).toBe(1); // 3/4 = 0.75 → ceil = 1
    expect(estimateTokens("abcde")).toBe(2); // 5/4 = 1.25 → ceil = 2
  });

  it("handles empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createBudgetTracker
// ---------------------------------------------------------------------------

describe("createBudgetTracker", () => {
  it("starts with zero usage", () => {
    const tracker = createBudgetTracker();
    const status = tracker.status();

    expect(status.estimatedTokens).toBe(0);
    expect(status.shouldRotate).toBe(false);
    expect(status.usage).toBe(0);
  });

  it("accumulates tokens from add()", () => {
    const tracker = createBudgetTracker({ maxTokens: 100, threshold: 0.5 });

    // 200 chars = 50 tokens = 50% of 100 → at threshold
    tracker.add("x".repeat(200));
    const status = tracker.status();

    expect(status.estimatedTokens).toBe(50);
    expect(status.shouldRotate).toBe(true);
    expect(status.usage).toBe(0.5);
  });

  it("accumulates tokens from addChars()", () => {
    const tracker = createBudgetTracker({ maxTokens: 100, threshold: 0.7 });

    tracker.addChars(280); // 280/4 = 70 tokens = 70% of 100
    expect(tracker.shouldRotate()).toBe(true);
  });

  it("does not trigger rotation below threshold", () => {
    const tracker = createBudgetTracker({ maxTokens: 1000, threshold: 0.7 });

    // 2000 chars = 500 tokens = 50% of 1000 → below 70%
    tracker.add("x".repeat(2000));
    expect(tracker.shouldRotate()).toBe(false);
  });

  it("triggers rotation at threshold", () => {
    const tracker = createBudgetTracker({ maxTokens: 1000, threshold: 0.7 });

    // 2800 chars = 700 tokens = 70% of 1000 → at threshold
    tracker.add("x".repeat(2800));
    expect(tracker.shouldRotate()).toBe(true);
  });

  it("uses default config (200k tokens, 70%)", () => {
    const tracker = createBudgetTracker();
    const status = tracker.status();

    expect(status.maxTokens).toBe(200_000);
    expect(status.threshold).toBe(0.7);
    expect(status.triggerAt).toBe(140_000);
  });

  it("reset() clears accumulated tokens", () => {
    const tracker = createBudgetTracker({ maxTokens: 100, threshold: 0.5 });

    tracker.add("x".repeat(400)); // 100 tokens → over threshold
    expect(tracker.shouldRotate()).toBe(true);

    tracker.reset();
    expect(tracker.shouldRotate()).toBe(false);
    expect(tracker.status().estimatedTokens).toBe(0);
  });

  it("accumulates across multiple add() calls", () => {
    const tracker = createBudgetTracker({ maxTokens: 100, threshold: 0.7 });

    tracker.add("x".repeat(100)); // 25 tokens
    tracker.add("x".repeat(100)); // 25 more → 50 total
    tracker.addChars(80); // 20 more → 70 total

    expect(tracker.status().estimatedTokens).toBe(70);
    expect(tracker.shouldRotate()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatRotationMessage
// ---------------------------------------------------------------------------

describe("formatRotationMessage", () => {
  it("formats a human-readable rotation message", () => {
    const msg = formatRotationMessage({
      estimatedTokens: 140_000,
      maxTokens: 200_000,
      threshold: 0.7,
      triggerAt: 140_000,
      shouldRotate: true,
      usage: 0.7,
    });

    expect(msg).toContain("~140k tokens");
    expect(msg).toContain("70%");
    expect(msg).toContain("200k");
    expect(msg).toContain("Resuming in fresh session");
  });
});
