import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  normalizeToKey,
  extractRuleCandidates,
  mergeRules,
  loadReviewRules,
  saveReviewRules,
  buildRulesPromptSection,
} from "./review-rules.js";
import type { ReviewRule } from "./review-rules.js";
import type { AdversarialLoopResult } from "./loop.js";
import type { AdversarialAgentResult, AdversarialFinding } from "./runner.js";
import type { VerificationResult } from "./verifier.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

const mockFs = vi.mocked((await import("node:fs")).default);

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<AdversarialFinding> = {}): AdversarialFinding {
  return {
    id: "cq-1",
    title: "Missing null check",
    severity: "high",
    source: "code-quality",
    file: "src/foo.ts",
    description: "No null check on return value",
    ...overrides,
  };
}

function makeAgentResult(
  agent: AdversarialFinding["source"],
  findings: AdversarialFinding[],
): AdversarialAgentResult {
  return {
    agent,
    findings,
    report: "report",
    success: true,
  };
}

function makeLoopResult(overrides: Partial<AdversarialLoopResult> = {}): AdversarialLoopResult {
  const defaultVerification: VerificationResult = {
    verified: [],
    discarded: [],
    stats: { total: 0, verified: 0, discarded: 0 },
  };

  return {
    iterations: [
      {
        iteration: 1,
        agentResults: [
          makeAgentResult("code-quality", [makeFinding()]),
          makeAgentResult("test-coverage", [
            makeFinding({
              id: "tc-1",
              title: "Untested error path",
              source: "test-coverage",
              severity: "medium",
              description: "Error path has no test",
            }),
          ]),
          makeAgentResult("security", []),
        ],
        verification: defaultVerification,
        fixResult: null,
        testsPass: true,
        unresolvedIds: [],
      },
    ],
    converged: true,
    exitReason: "converged",
    totalFindings: 2,
    totalFixed: 0,
    totalDiscarded: 0,
    unresolvedFindings: [],
    allFixResults: [],
    deferredFindings: [],
    ...overrides,
  };
}

function makeRule(overrides: Partial<ReviewRule> = {}): ReviewRule {
  return {
    key: "code-quality--missing-null-check",
    description: "No null check on return value",
    severity: "high",
    sourceAgent: "code-quality",
    timesSeen: 1,
    projects: ["my-project"],
    firstSeen: "2026-02-18T00:00:00.000Z",
    lastSeen: "2026-02-18T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeToKey
// ---------------------------------------------------------------------------

describe("normalizeToKey", () => {
  it("creates a key from agent type and slugified title", () => {
    expect(normalizeToKey("code-quality", "Missing null check")).toBe(
      "code-quality--missing-null-check",
    );
  });

  it("handles special characters", () => {
    expect(normalizeToKey("security", "SQL Injection via user_input()")).toBe(
      "security--sql-injection-via-user-input",
    );
  });

  it("strips leading and trailing dashes", () => {
    expect(normalizeToKey("test-coverage", "  --hello world--  ")).toBe(
      "test-coverage--hello-world",
    );
  });

  it("collapses multiple non-alphanumeric chars into single dash", () => {
    expect(normalizeToKey("code-quality", "error!!!handling...missing")).toBe(
      "code-quality--error-handling-missing",
    );
  });
});

// ---------------------------------------------------------------------------
// extractRuleCandidates
// ---------------------------------------------------------------------------

describe("extractRuleCandidates", () => {
  it("extracts candidates from loop result findings", () => {
    const result = makeLoopResult();
    const candidates = extractRuleCandidates(result, "my-app");

    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.key)).toContain("code-quality--missing-null-check");
    expect(candidates.map((c) => c.key)).toContain("test-coverage--untested-error-path");
  });

  it("deduplicates findings with the same normalized key", () => {
    const finding1 = makeFinding({ id: "cq-1", title: "Missing null check" });
    const finding2 = makeFinding({ id: "cq-2", title: "Missing null check" });

    const result = makeLoopResult({
      iterations: [
        {
          iteration: 1,
          agentResults: [makeAgentResult("code-quality", [finding1, finding2])],
          verification: { verified: [], discarded: [], stats: { total: 0, verified: 0, discarded: 0 } },
          fixResult: null,
          testsPass: true,
          unresolvedIds: [],
        },
      ],
    });

    const candidates = extractRuleCandidates(result, "my-app");
    const nullCheck = candidates.find((c) => c.key === "code-quality--missing-null-check");
    expect(nullCheck).toBeDefined();
    expect(nullCheck!.timesSeen).toBe(2);
  });

  it("includes deferred findings", () => {
    const deferred = makeFinding({
      id: "cq-3",
      title: "Deferred issue",
      severity: "low",
    });

    const result = makeLoopResult({ deferredFindings: [deferred] });
    const candidates = extractRuleCandidates(result, "my-app");
    expect(candidates.map((c) => c.key)).toContain("code-quality--deferred-issue");
  });

  it("includes unresolved findings", () => {
    const unresolved = makeFinding({
      id: "cq-4",
      title: "Unresolved problem",
    });

    const result = makeLoopResult({ unresolvedFindings: [unresolved] });
    const candidates = extractRuleCandidates(result, "my-app");
    expect(candidates.map((c) => c.key)).toContain("code-quality--unresolved-problem");
  });

  it("sets project name on candidates", () => {
    const result = makeLoopResult();
    const candidates = extractRuleCandidates(result, "vinyl-tracker");
    expect(candidates[0]!.projects).toEqual(["vinyl-tracker"]);
  });
});

// ---------------------------------------------------------------------------
// mergeRules
// ---------------------------------------------------------------------------

describe("mergeRules", () => {
  it("adds new rules that don't exist", () => {
    const existing: ReviewRule[] = [];
    const candidates = [makeRule({ key: "code-quality--new-issue", timesSeen: 1 })];

    const merged = mergeRules(existing, candidates);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.key).toBe("code-quality--new-issue");
  });

  it("increments timesSeen for matching keys", () => {
    const existing = [makeRule({ timesSeen: 3 })];
    const candidates = [makeRule({ timesSeen: 2 })];

    const merged = mergeRules(existing, candidates);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.timesSeen).toBe(5);
  });

  it("updates lastSeen for matching keys", () => {
    const existing = [makeRule({ lastSeen: "2026-01-01T00:00:00.000Z" })];
    const candidates = [makeRule({ lastSeen: "2026-02-19T00:00:00.000Z" })];

    const merged = mergeRules(existing, candidates);
    expect(merged[0]!.lastSeen).toBe("2026-02-19T00:00:00.000Z");
  });

  it("preserves firstSeen from existing rule", () => {
    const existing = [makeRule({ firstSeen: "2026-01-01T00:00:00.000Z" })];
    const candidates = [makeRule({ firstSeen: "2026-02-19T00:00:00.000Z" })];

    const merged = mergeRules(existing, candidates);
    expect(merged[0]!.firstSeen).toBe("2026-01-01T00:00:00.000Z");
  });

  it("adds new projects without duplicates", () => {
    const existing = [makeRule({ projects: ["app-a"] })];
    const candidates = [makeRule({ projects: ["app-b", "app-a"] })];

    const merged = mergeRules(existing, candidates);
    expect(merged[0]!.projects).toEqual(["app-a", "app-b"]);
  });

  it("does not modify original arrays", () => {
    const existing = [makeRule()];
    const candidates = [makeRule({ timesSeen: 1 })];

    mergeRules(existing, candidates);
    expect(existing[0]!.timesSeen).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// loadReviewRules
// ---------------------------------------------------------------------------

describe("loadReviewRules", () => {
  it("loads rules from YAML file", () => {
    mockFs.readFileSync.mockReturnValue(
      "- key: code-quality--missing-null-check\n  description: No null check on return value\n  severity: high\n  sourceAgent: code-quality\n  timesSeen: 1\n  projects:\n    - my-project\n  firstSeen: '2026-02-18T00:00:00.000Z'\n  lastSeen: '2026-02-18T00:00:00.000Z'\n",
    );

    const loaded = loadReviewRules("/custom/memory");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.key).toBe("code-quality--missing-null-check");
  });

  it("returns empty array when file does not exist", () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const loaded = loadReviewRules("/custom/memory");
    expect(loaded).toEqual([]);
  });

  it("returns empty array when file is not an array", () => {
    mockFs.readFileSync.mockReturnValue("key: value\n");

    const loaded = loadReviewRules("/custom/memory");
    expect(loaded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// saveReviewRules
// ---------------------------------------------------------------------------

describe("saveReviewRules", () => {
  it("writes rules as YAML and creates directory", () => {
    const rules = [makeRule()];
    const resultPath = saveReviewRules(rules, "/custom/memory");

    expect(mockFs.mkdirSync).toHaveBeenCalledWith("/custom/memory", { recursive: true });
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "/custom/memory/review-rules.yaml",
      expect.any(String),
      "utf-8",
    );
    expect(resultPath).toBe("/custom/memory/review-rules.yaml");
  });
});

// ---------------------------------------------------------------------------
// buildRulesPromptSection
// ---------------------------------------------------------------------------

describe("buildRulesPromptSection", () => {
  it("returns empty string when no rules qualify", () => {
    const rules = [makeRule({ timesSeen: 1 })]; // Below threshold
    const section = buildRulesPromptSection(rules, "code-quality");
    expect(section).toBe("");
  });

  it("includes rules at or above promotion threshold", () => {
    const rules = [makeRule({ timesSeen: 2 })];
    const section = buildRulesPromptSection(rules, "code-quality");
    expect(section).toContain("Known Recurring Issues");
    expect(section).toContain("No null check on return value");
    expect(section).toContain("seen 2 times");
  });

  it("filters by agent type", () => {
    const rules = [
      makeRule({ timesSeen: 5, sourceAgent: "code-quality" }),
      makeRule({
        key: "security--sql-injection",
        timesSeen: 3,
        sourceAgent: "security",
        description: "SQL injection risk",
      }),
    ];

    const section = buildRulesPromptSection(rules, "security");
    expect(section).toContain("SQL injection risk");
    expect(section).not.toContain("No null check on return value");
  });

  it("respects custom promotion threshold", () => {
    const rules = [makeRule({ timesSeen: 3 })];

    // Threshold 5 — rule doesn't qualify
    expect(buildRulesPromptSection(rules, "code-quality", 5)).toBe("");

    // Threshold 3 — rule qualifies
    expect(buildRulesPromptSection(rules, "code-quality", 3)).toContain("No null check");
  });

  it("caps at 10 rules", () => {
    const rules = Array.from({ length: 15 }, (_, i) =>
      makeRule({
        key: `code-quality--issue-${i}`,
        timesSeen: 10,
        description: `Issue number ${i}`,
      }),
    );

    const section = buildRulesPromptSection(rules, "code-quality");
    const matches = section.match(/\d+\.\s\*\*/g);
    expect(matches).toHaveLength(10);
  });

  it("sorts by timesSeen descending", () => {
    const rules = [
      makeRule({ key: "code-quality--a", timesSeen: 2, description: "Less seen" }),
      makeRule({ key: "code-quality--b", timesSeen: 10, description: "Most seen" }),
      makeRule({ key: "code-quality--c", timesSeen: 5, description: "Mid seen" }),
    ];

    const section = buildRulesPromptSection(rules, "code-quality");
    const lines = section.split("\n").filter((l) => l.match(/^\d+\./));
    expect(lines[0]).toContain("Most seen");
    expect(lines[1]).toContain("Mid seen");
    expect(lines[2]).toContain("Less seen");
  });
});
