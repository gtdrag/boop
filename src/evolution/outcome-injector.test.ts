import { describe, it, expect } from "vitest";
import { getRelevantRules, buildOutcomeSection, augmentPrompt } from "./outcome-injector.js";
import type { DeveloperProfile } from "../profile/schema.js";
import type { ReviewRule } from "../review/adversarial/review-rules.js";

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

function makeRule(overrides: Partial<ReviewRule> = {}): ReviewRule {
  return {
    key: "test--rule",
    description: "Missing input validation on API endpoints",
    severity: "medium",
    sourceAgent: "code-quality",
    timesSeen: 5,
    projects: ["project-a", "project-b"],
    firstSeen: "2025-01-01T00:00:00Z",
    lastSeen: "2025-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("getRelevantRules", () => {
  it("filters rules below the threshold", () => {
    const rules = [makeRule({ timesSeen: 2 }), makeRule({ timesSeen: 5, key: "high" })];
    const result = getRelevantRules(rules, testProfile, 3);
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("high");
  });

  it("uses default threshold of 3", () => {
    const rules = [makeRule({ timesSeen: 3 }), makeRule({ timesSeen: 2, key: "low" })];
    const result = getRelevantRules(rules, testProfile);
    expect(result).toHaveLength(1);
  });

  it("filters out rules for unrelated stacks", () => {
    const rules = [
      makeRule({ description: "Angular change detection issues", timesSeen: 5 }),
    ];
    const result = getRelevantRules(rules, testProfile);
    expect(result).toHaveLength(0);
  });

  it("includes generic rules", () => {
    const rules = [
      makeRule({ description: "Missing input validation on endpoints", timesSeen: 5 }),
    ];
    const result = getRelevantRules(rules, testProfile);
    expect(result).toHaveLength(1);
  });

  it("sorts by timesSeen descending", () => {
    const rules = [
      makeRule({ key: "a", timesSeen: 3 }),
      makeRule({ key: "b", timesSeen: 7 }),
      makeRule({ key: "c", timesSeen: 5 }),
    ];
    const result = getRelevantRules(rules, testProfile);
    expect(result.map((r) => r.key)).toEqual(["b", "c", "a"]);
  });
});

describe("buildOutcomeSection", () => {
  it("returns empty string for no rules", () => {
    expect(buildOutcomeSection([], "architecture")).toBe("");
  });

  it("builds markdown section grouped by severity", () => {
    const rules = [
      makeRule({ severity: "high", description: "SQL injection risk" }),
      makeRule({ severity: "medium", description: "Missing error handling" }),
    ];
    const section = buildOutcomeSection(rules, "architecture");
    expect(section).toContain("## Lessons from Past Reviews (architecture)");
    expect(section).toContain("### High Issues");
    expect(section).toContain("### Medium Issues");
    expect(section).toContain("SQL injection risk");
    expect(section).toContain("Missing error handling");
  });

  it("includes timesSeen and project count", () => {
    const rules = [
      makeRule({ timesSeen: 5, projects: ["a", "b", "c"] }),
    ];
    const section = buildOutcomeSection(rules, "prd");
    expect(section).toContain("seen 5 times across 3 projects");
  });

  it("truncates to max rules", () => {
    const rules = Array.from({ length: 20 }, (_, i) =>
      makeRule({ key: `rule-${i}`, description: `Rule ${i}`, timesSeen: 20 - i }),
    );
    const section = buildOutcomeSection(rules, "viability");
    // Count bullet points (lines starting with "- **")
    const bulletCount = (section.match(/^- \*\*/gm) ?? []).length;
    expect(bulletCount).toBeLessThanOrEqual(12);
  });
});

describe("augmentPrompt", () => {
  it("returns original prompt when no rules qualify", () => {
    const base = "You are an architecture assistant.";
    const result = augmentPrompt(base, [], "architecture", testProfile);
    expect(result).toBe(base);
  });

  it("returns original prompt when all rules below threshold", () => {
    const base = "You are an architecture assistant.";
    const rules = [makeRule({ timesSeen: 1 })];
    const result = augmentPrompt(base, rules, "architecture", testProfile);
    expect(result).toBe(base);
  });

  it("appends outcome section when rules qualify", () => {
    const base = "You are an architecture assistant.";
    const rules = [makeRule({ timesSeen: 5 })];
    const result = augmentPrompt(base, rules, "architecture", testProfile);
    expect(result).toContain(base);
    expect(result).toContain("## Lessons from Past Reviews");
    expect(result.length).toBeGreaterThan(base.length);
  });

  it("preserves the original prompt content", () => {
    const base = "Line 1\nLine 2\nLine 3";
    const rules = [makeRule({ timesSeen: 5 })];
    const result = augmentPrompt(base, rules, "prd", testProfile);
    expect(result.startsWith(base)).toBe(true);
  });
});
