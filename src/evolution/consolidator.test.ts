import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { DeveloperProfile } from "../profile/schema.js";
import type { ReviewRule } from "../review/adversarial/review-rules.js";
import type { MemoryEntry } from "../retrospective/reporter.js";
import type { ArchDecision } from "./arch-decisions.js";
import type { Heuristic, HeuristicStore } from "./consolidator.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: '[]',
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "claude-opus-4-6",
  }),
);

vi.mock("../shared/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../shared/index.js")>();
  return {
    ...original,
    sendMessage: mockSendMessage,
    isRetryableApiError: () => false,
  };
});

vi.mock("./stack-matcher.js", () => ({
  extractStackKeywords: vi.fn().mockReturnValue(["typescript", "next", "postgresql", "vercel"]),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testProfile: DeveloperProfile = {
  name: "Test Dev",
  languages: ["typescript"],
  frontendFramework: "next",
  backendFramework: "express",
  database: "postgresql",
  cloudProvider: "vercel",
  styling: "tailwind",
  stateManagement: "zustand",
  analytics: "posthog",
  ciCd: "github-actions",
  packageManager: "pnpm",
  testRunner: "vitest",
  linter: "oxlint",
  projectStructure: "single-repo",
  errorTracker: "sentry",
  aiModel: "claude-opus-4-6",
  autonomousByDefault: false,
};

function makeHeuristic(overrides: Partial<Heuristic> = {}): Heuristic {
  return {
    id: "abc123def456",
    text: "Always add rate limiting to public APIs",
    category: "architecture",
    confidence: 0.8,
    stackComponents: [],
    sourceCount: 3,
    sourceProjects: ["project-a"],
    createdAt: "2026-01-01T00:00:00.000Z",
    lastValidated: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeMemoryEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    type: "coding-pattern",
    description: "Always validate user input at API boundaries",
    project: "test-project",
    date: "2026-02-01",
    ...overrides,
  };
}

function makeReviewRule(overrides: Partial<ReviewRule> = {}): ReviewRule {
  return {
    key: "code-quality--missing-null-check",
    description: "No null check on return value",
    severity: "high",
    sourceAgent: "code-quality",
    timesSeen: 3,
    projects: ["project-a"],
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeArchDecision(overrides: Partial<ArchDecision> = {}): ArchDecision {
  return {
    id: "ad-001",
    project: "project-a",
    date: "2026-01-15",
    category: "database",
    title: "Use connection pooling",
    decision: "Use pgBouncer for connection pooling",
    outcome: "Prevents connection exhaustion in serverless",
    outcomeType: "positive",
    stackComponents: ["postgresql"],
    confidence: 0.8,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consolidator-test-"));
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue({
    text: '[]',
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "claude-opus-4-6",
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadHeuristicStore
// ---------------------------------------------------------------------------

describe("loadHeuristicStore", () => {
  it("returns empty store when file is missing", async () => {
    const { loadHeuristicStore } = await import("./consolidator.js");
    const store = loadHeuristicStore(tmpDir);
    expect(store).toEqual({
      version: "1",
      heuristics: [],
      lastConsolidation: "",
    });
  });
});

// ---------------------------------------------------------------------------
// saveHeuristicStore
// ---------------------------------------------------------------------------

describe("saveHeuristicStore", () => {
  it("creates file and directory", async () => {
    const { saveHeuristicStore } = await import("./consolidator.js");
    const nestedDir = path.join(tmpDir, "nested", "dir");
    const store: HeuristicStore = {
      version: "1",
      heuristics: [makeHeuristic()],
      lastConsolidation: "2026-02-01T00:00:00.000Z",
    };

    const filePath = saveHeuristicStore(store, nestedDir);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toBe(path.join(nestedDir, "heuristics.yaml"));
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("save and load preserves data", async () => {
    const { loadHeuristicStore, saveHeuristicStore } = await import("./consolidator.js");
    const store: HeuristicStore = {
      version: "1",
      heuristics: [
        makeHeuristic({ id: "aaa111", text: "First heuristic" }),
        makeHeuristic({ id: "bbb222", text: "Second heuristic", confidence: 0.9 }),
      ],
      lastConsolidation: "2026-02-15T00:00:00.000Z",
    };

    saveHeuristicStore(store, tmpDir);
    const loaded = loadHeuristicStore(tmpDir);

    expect(loaded.version).toBe("1");
    expect(loaded.heuristics).toHaveLength(2);
    expect(loaded.heuristics[0]!.text).toBe("First heuristic");
    expect(loaded.heuristics[1]!.confidence).toBe(0.9);
    expect(loaded.lastConsolidation).toBe("2026-02-15T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// consolidate
// ---------------------------------------------------------------------------

describe("consolidate", () => {
  it("calls sendMessage and parses response", async () => {
    const { consolidate } = await import("./consolidator.js");
    mockSendMessage.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          text: "Always add rate limiting to public APIs",
          category: "architecture",
          confidence: 0.85,
          stackComponents: [],
          sourceCount: 3,
        },
      ]),
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6",
    });

    const result = await consolidate(
      [makeMemoryEntry()],
      [makeReviewRule()],
      [makeArchDecision()],
      { version: "1", heuristics: [], lastConsolidation: "" },
    );

    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(result.added).toHaveLength(1);
    expect(result.added[0]!.text).toBe("Always add rate limiting to public APIs");
    expect(result.added[0]!.confidence).toBe(0.85);
  });

  it("merges with existing heuristics by normalized text", async () => {
    const { consolidate } = await import("./consolidator.js");
    const existing: HeuristicStore = {
      version: "1",
      heuristics: [makeHeuristic({ text: "Always add rate limiting to public APIs", confidence: 0.7 })],
      lastConsolidation: "2026-01-01T00:00:00.000Z",
    };

    mockSendMessage.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          text: "always add rate limiting to public apis",
          category: "architecture",
          confidence: 0.85,
          stackComponents: [],
          sourceCount: 2,
        },
      ]),
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6",
    });

    const result = await consolidate(
      [makeMemoryEntry()],
      [],
      [],
      existing,
    );

    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]!.text).toBe("Always add rate limiting to public APIs");
  });

  it("increments confidence on duplicate capped at 1.0", async () => {
    const { consolidate } = await import("./consolidator.js");
    const existing: HeuristicStore = {
      version: "1",
      heuristics: [makeHeuristic({ text: "Use connection pooling", confidence: 0.95 })],
      lastConsolidation: "2026-01-01T00:00:00.000Z",
    };

    mockSendMessage.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          text: "use connection pooling",
          category: "architecture",
          confidence: 0.9,
          stackComponents: ["postgresql"],
          sourceCount: 1,
        },
      ]),
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6",
    });

    const result = await consolidate(
      [makeMemoryEntry()],
      [],
      [],
      existing,
    );

    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]!.confidence).toBe(1.0); // 0.95 + 0.1 capped at 1.0
  });
});

// ---------------------------------------------------------------------------
// applyDecay
// ---------------------------------------------------------------------------

describe("applyDecay", () => {
  it("reduces confidence based on months since lastValidated", async () => {
    const { applyDecay } = await import("./consolidator.js");
    // 4 months old => 0.05 * 4 = 0.20 decay
    const h = makeHeuristic({
      confidence: 0.8,
      lastValidated: "2026-01-01T00:00:00.000Z",
    });

    const result = applyDecay([h], new Date("2026-05-01T00:00:00.000Z"));

    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBeCloseTo(0.6, 5);
  });

  it("removes heuristics below 0.3 confidence", async () => {
    const { applyDecay } = await import("./consolidator.js");
    // 12 months => 0.6 decay, 0.5 - 0.6 = -0.1 < 0.3
    const h = makeHeuristic({
      confidence: 0.5,
      lastValidated: "2025-01-01T00:00:00.000Z",
    });

    const result = applyDecay([h], new Date("2026-01-01T00:00:00.000Z"));
    expect(result).toHaveLength(0);
  });

  it("does not decay recently validated heuristics", async () => {
    const { applyDecay } = await import("./consolidator.js");
    const h = makeHeuristic({
      confidence: 0.8,
      lastValidated: "2026-02-01T00:00:00.000Z",
    });

    const result = applyDecay([h], new Date("2026-02-15T00:00:00.000Z"));

    expect(result).toHaveLength(1);
    // Same month = 0 months diff = no decay
    expect(result[0]!.confidence).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// queryForPhase
// ---------------------------------------------------------------------------

describe("queryForPhase", () => {
  it("filters by category and stack overlap", async () => {
    const { queryForPhase } = await import("./consolidator.js");
    const store: HeuristicStore = {
      version: "1",
      heuristics: [
        makeHeuristic({
          id: "h1",
          text: "Plan carefully",
          category: "planning",
          confidence: 0.8,
          stackComponents: ["typescript"],
        }),
        makeHeuristic({
          id: "h2",
          text: "Review code",
          category: "review",
          confidence: 0.9,
          stackComponents: ["typescript"],
        }),
      ],
      lastConsolidation: "",
    };

    const result = queryForPhase(store, "viability", testProfile);

    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("Plan carefully");
  });

  it("includes universal heuristics (empty stackComponents)", async () => {
    const { queryForPhase } = await import("./consolidator.js");
    const store: HeuristicStore = {
      version: "1",
      heuristics: [
        makeHeuristic({
          id: "h1",
          text: "Universal planning tip",
          category: "planning",
          confidence: 0.8,
          stackComponents: [], // universal
        }),
        makeHeuristic({
          id: "h2",
          text: "Stack-specific tip",
          category: "planning",
          confidence: 0.7,
          stackComponents: ["ruby"], // no overlap
        }),
      ],
      lastConsolidation: "",
    };

    const result = queryForPhase(store, "viability", testProfile);

    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("Universal planning tip");
  });

  it("excludes low confidence and caps at max 8", async () => {
    const { queryForPhase } = await import("./consolidator.js");
    const heuristics: Heuristic[] = [];

    // 10 planning heuristics with varied confidence
    for (let i = 0; i < 10; i++) {
      heuristics.push(
        makeHeuristic({
          id: `h${i}`,
          text: `Planning tip ${i}`,
          category: "planning",
          confidence: 0.3 + i * 0.07, // 0.3, 0.37, 0.44, 0.51, 0.58, 0.65, 0.72, 0.79, 0.86, 0.93
          stackComponents: [],
        }),
      );
    }

    const store: HeuristicStore = {
      version: "1",
      heuristics,
      lastConsolidation: "",
    };

    const result = queryForPhase(store, "viability", testProfile);

    // confidence >= 0.5: indices 3-9 = 7 heuristics (all under max of 8)
    expect(result.length).toBeLessThanOrEqual(8);
    // All should be >= 0.5
    for (const h of result) {
      expect(h.confidence).toBeGreaterThanOrEqual(0.5);
    }
    // Should be sorted by confidence DESC
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.confidence).toBeGreaterThanOrEqual(result[i]!.confidence);
    }
  });
});

// ---------------------------------------------------------------------------
// formatHeuristicsForPrompt
// ---------------------------------------------------------------------------

describe("formatHeuristicsForPrompt", () => {
  it("formats heuristics correctly", async () => {
    const { formatHeuristicsForPrompt } = await import("./consolidator.js");
    const heuristics = [
      makeHeuristic({
        text: "Always add rate limiting to public APIs",
        confidence: 0.9,
        sourceProjects: ["proj-a", "proj-b", "proj-c", "proj-d"],
      }),
      makeHeuristic({
        text: "Use connection pooling with serverless PostgreSQL",
        confidence: 0.8,
        sourceProjects: ["proj-a", "proj-b", "proj-c"],
      }),
    ];

    const result = formatHeuristicsForPrompt(heuristics);

    expect(result).toContain("## Validated Heuristics");
    expect(result).toContain("High-confidence patterns from past projects:");
    expect(result).toContain("Always add rate limiting to public APIs (confidence: 0.9, 4 projects)");
    expect(result).toContain("Use connection pooling with serverless PostgreSQL (confidence: 0.8, 3 projects)");
  });

  it("returns empty string for no heuristics", async () => {
    const { formatHeuristicsForPrompt } = await import("./consolidator.js");
    const result = formatHeuristicsForPrompt([]);
    expect(result).toBe("");
  });
});
