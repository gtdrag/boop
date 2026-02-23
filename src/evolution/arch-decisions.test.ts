import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import type { DeveloperProfile } from "../profile/schema.js";
import type { RetrospectiveData } from "../retrospective/analyzer.js";
import type { ArchDecision, ArchDecisionStore } from "./arch-decisions.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ text: "[]", usage: { inputTokens: 0, outputTokens: 0 }, model: "test" }),
);

vi.mock("../shared/index.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: vi.fn(),
  retry: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

const {
  loadDecisionStore,
  saveDecisionStore,
  mergeDecisions,
  queryRelevantDecisions,
  formatDecisionsForPrompt,
  extractDecisions,
  parseDecisionsFromResponse,
} = await import("./arch-decisions.js");

// ---------------------------------------------------------------------------
// Test helpers
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
  sourceControl: "github",
  packageManager: "pnpm",
  testRunner: "vitest",
  linter: "oxlint",
  projectStructure: "single-repo",
  errorTracker: "sentry",
  aiModel: "claude-opus-4-6",
  autonomousByDefault: false,
};

function makeDecision(overrides?: Partial<ArchDecision>): ArchDecision {
  return {
    id: "use-drizzle-orm",
    project: "ProjectA",
    date: "2026-01-15",
    category: "orm",
    title: "Use Drizzle ORM",
    decision: "Chose Drizzle over Prisma for type-safe SQL",
    outcome: "Faster queries and better DX",
    outcomeType: "positive",
    stackComponents: ["typescript", "postgresql"],
    confidence: 0.8,
    ...overrides,
  };
}

function makeRetroData(overrides?: Partial<RetrospectiveData>): RetrospectiveData {
  return {
    projectName: "TestProject",
    totalEpics: 1,
    totalStories: 2,
    epics: [],
    topFindingPatterns: [],
    codebasePatterns: ["Use path aliases"],
    allLearnings: ["vitest needs resolve.alias config"],
    mostComplexStory: null,
    avgFilesPerStory: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-arch-dec-"));
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue({
    text: "[]",
    usage: { inputTokens: 0, outputTokens: 0 },
    model: "test",
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadDecisionStore
// ---------------------------------------------------------------------------

describe("loadDecisionStore", () => {
  it("returns empty store when file is missing", () => {
    const store = loadDecisionStore(path.join(tmpDir, "nonexistent"));
    expect(store).toEqual({ version: "1", decisions: [] });
  });

  it("loads existing store from YAML", () => {
    const data: ArchDecisionStore = {
      version: "1",
      decisions: [makeDecision()],
    };
    fs.writeFileSync(path.join(tmpDir, "arch-decisions.yaml"), YAML.stringify(data), "utf-8");
    const store = loadDecisionStore(tmpDir);
    expect(store.decisions).toHaveLength(1);
    expect(store.decisions[0]!.title).toBe("Use Drizzle ORM");
  });
});

// ---------------------------------------------------------------------------
// saveDecisionStore
// ---------------------------------------------------------------------------

describe("saveDecisionStore", () => {
  it("creates file and directory", () => {
    const nestedDir = path.join(tmpDir, "deep", "memory");
    const store: ArchDecisionStore = { version: "1", decisions: [makeDecision()] };
    const filePath = saveDecisionStore(store, nestedDir);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toContain("arch-decisions.yaml");

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(content) as ArchDecisionStore;
    expect(parsed.decisions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeDecisions
// ---------------------------------------------------------------------------

describe("mergeDecisions", () => {
  it("deduplicates by normalized title", () => {
    const existing = [makeDecision({ title: "Use Drizzle ORM" })];
    const incoming = [makeDecision({ title: "  use drizzle orm  " })];
    const result = mergeDecisions(existing, incoming);
    expect(result).toHaveLength(1);
  });

  it("increments confidence on duplicate (capped at 1.0)", () => {
    const existing = [makeDecision({ confidence: 0.95 })];
    const incoming = [makeDecision({ confidence: 0.5 })];
    const result = mergeDecisions(existing, incoming);
    expect(result[0]!.confidence).toBe(1.0);
  });

  it("adds project on cross-project duplicate", () => {
    const existing = [makeDecision({ project: "ProjectA" })];
    const incoming = [makeDecision({ project: "ProjectB" })];
    const result = mergeDecisions(existing, incoming);
    expect(result[0]!.project).toBe("ProjectA, ProjectB");
  });

  it("does not duplicate same project", () => {
    const existing = [makeDecision({ project: "ProjectA" })];
    const incoming = [makeDecision({ project: "ProjectA" })];
    const result = mergeDecisions(existing, incoming);
    expect(result[0]!.project).toBe("ProjectA");
  });

  it("adds new decisions that do not match existing titles", () => {
    const existing = [makeDecision()];
    const incoming = [makeDecision({ title: "Use Redis caching" })];
    const result = mergeDecisions(existing, incoming);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// queryRelevantDecisions
// ---------------------------------------------------------------------------

describe("queryRelevantDecisions", () => {
  it("filters by stack overlap", () => {
    const store: ArchDecisionStore = {
      version: "1",
      decisions: [
        makeDecision({ stackComponents: ["typescript", "postgresql"] }),
        makeDecision({ title: "Use DynamoDB", stackComponents: ["dynamodb", "aws"], id: "use-dynamodb" }),
      ],
    };
    const result = queryRelevantDecisions(store, testProfile);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Use Drizzle ORM");
  });

  it("includes universal decisions (empty stackComponents)", () => {
    const store: ArchDecisionStore = {
      version: "1",
      decisions: [
        makeDecision({ stackComponents: [], title: "Always use feature flags", id: "always-feature-flags" }),
        makeDecision({ stackComponents: ["python"], title: "Use Django", id: "use-django" }),
      ],
    };
    const result = queryRelevantDecisions(store, testProfile);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Always use feature flags");
  });

  it("sorts by confidence desc then date desc", () => {
    const store: ArchDecisionStore = {
      version: "1",
      decisions: [
        makeDecision({ confidence: 0.6, date: "2026-01-01", title: "A", stackComponents: ["typescript"] }),
        makeDecision({ confidence: 0.9, date: "2026-01-01", title: "B", stackComponents: ["typescript"] }),
        makeDecision({ confidence: 0.9, date: "2026-02-01", title: "C", stackComponents: ["typescript"] }),
      ],
    };
    const result = queryRelevantDecisions(store, testProfile);
    expect(result.map((d) => d.title)).toEqual(["C", "B", "A"]);
  });

  it("caps at maxResults", () => {
    const decisions = Array.from({ length: 20 }, (_, i) =>
      makeDecision({ title: `Decision ${i}`, id: `decision-${i}`, stackComponents: ["typescript"] }),
    );
    const store: ArchDecisionStore = { version: "1", decisions };
    const result = queryRelevantDecisions(store, testProfile, 5);
    expect(result).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// formatDecisionsForPrompt
// ---------------------------------------------------------------------------

describe("formatDecisionsForPrompt", () => {
  it("returns empty string for empty array", () => {
    expect(formatDecisionsForPrompt([])).toBe("");
  });

  it("formats decisions correctly", () => {
    const result = formatDecisionsForPrompt([makeDecision()]);
    expect(result).toContain("## Architecture Decisions from Previous Projects");
    expect(result).toContain("### Use Drizzle ORM");
    expect(result).toContain("**Category:** orm");
    expect(result).toContain("**Decision:** Chose Drizzle over Prisma");
    expect(result).toContain("**Outcome:** Faster queries and better DX (positive)");
    expect(result).toContain("**Confidence:** 0.8");
    expect(result).toContain("**Stack:** typescript, postgresql");
  });

  it("omits stack line when stackComponents empty", () => {
    const result = formatDecisionsForPrompt([makeDecision({ stackComponents: [] })]);
    expect(result).not.toContain("**Stack:**");
  });
});

// ---------------------------------------------------------------------------
// extractDecisions
// ---------------------------------------------------------------------------

describe("extractDecisions", () => {
  it("calls sendMessage and parses JSON response", async () => {
    const decisions = [
      {
        id: "use-drizzle",
        project: "TestProject",
        date: "2026-02-19",
        category: "orm",
        title: "Use Drizzle",
        decision: "Chose Drizzle",
        outcome: "Good DX",
        outcomeType: "positive",
        stackComponents: ["typescript"],
        confidence: 0.8,
      },
    ];
    mockSendMessage.mockResolvedValueOnce({
      text: JSON.stringify(decisions),
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "test",
    });

    const result = await extractDecisions(makeRetroData(), "# Architecture\nUsing Drizzle.", testProfile);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Use Drizzle");
  });

  it("handles malformed response gracefully", async () => {
    mockSendMessage.mockResolvedValueOnce({
      text: "I could not extract any decisions, sorry!",
      usage: { inputTokens: 100, outputTokens: 10 },
      model: "test",
    });

    const result = await extractDecisions(makeRetroData(), "# Arch", testProfile);
    expect(result).toEqual([]);
  });

  it("handles API error gracefully", async () => {
    mockSendMessage.mockRejectedValueOnce(new Error("API connection failed"));
    const result = await extractDecisions(makeRetroData(), "# Arch", testProfile);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseDecisionsFromResponse
// ---------------------------------------------------------------------------

describe("parseDecisionsFromResponse", () => {
  it("validates category and outcomeType", () => {
    const json = JSON.stringify([
      { title: "Test", decision: "D", category: "invalid", outcomeType: "invalid" },
    ]);
    const result = parseDecisionsFromResponse(json, "P", "2026-01-01");
    expect(result[0]!.category).toBe("other");
    expect(result[0]!.outcomeType).toBe("neutral");
  });

  it("clamps confidence to 0.0-1.0", () => {
    const json = JSON.stringify([
      { title: "High", decision: "D", confidence: 5.0 },
      { title: "Low", decision: "D", confidence: -1.0 },
    ]);
    const result = parseDecisionsFromResponse(json, "P", "2026-01-01");
    expect(result[0]!.confidence).toBe(1.0);
    expect(result[1]!.confidence).toBe(0.0);
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("save then load preserves data", () => {
    const store: ArchDecisionStore = {
      version: "1",
      decisions: [
        makeDecision(),
        makeDecision({ title: "Use Redis", id: "use-redis", stackComponents: ["redis"] }),
      ],
    };

    saveDecisionStore(store, tmpDir);
    const loaded = loadDecisionStore(tmpDir);

    expect(loaded.version).toBe("1");
    expect(loaded.decisions).toHaveLength(2);
    expect(loaded.decisions[0]!.title).toBe("Use Drizzle ORM");
    expect(loaded.decisions[1]!.title).toBe("Use Redis");
    expect(loaded.decisions[0]!.confidence).toBe(0.8);
    expect(loaded.decisions[0]!.stackComponents).toEqual(["typescript", "postgresql"]);
  });
});
