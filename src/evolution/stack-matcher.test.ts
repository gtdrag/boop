import { describe, it, expect } from "vitest";
import { extractStackKeywords, isStackRelevant } from "./stack-matcher.js";
import type { DeveloperProfile } from "../profile/schema.js";
import type { ReviewRule } from "../review/adversarial/review-rules.js";

const testProfile: DeveloperProfile = {
  name: "Test Dev",
  languages: ["typescript", "python"],
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

function makeRule(overrides: Partial<ReviewRule> = {}): ReviewRule {
  return {
    key: "test--rule",
    description: "Test rule description",
    severity: "medium",
    sourceAgent: "code-quality",
    timesSeen: 3,
    projects: ["test-project"],
    firstSeen: "2025-01-01T00:00:00Z",
    lastSeen: "2025-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("extractStackKeywords", () => {
  it("extracts all tech-stack fields from a profile", () => {
    const keywords = extractStackKeywords(testProfile);
    expect(keywords).toContain("typescript");
    expect(keywords).toContain("python");
    expect(keywords).toContain("next");
    expect(keywords).toContain("express");
    expect(keywords).toContain("postgresql");
    expect(keywords).toContain("vercel");
    expect(keywords).toContain("tailwind");
  });

  it("excludes 'none' values", () => {
    const profile = { ...testProfile, backendFramework: "none" as const };
    const keywords = extractStackKeywords(profile);
    expect(keywords).not.toContain("none");
  });

  it("lowercases all keywords", () => {
    const profile = { ...testProfile, frontendFramework: "Next" };
    const keywords = extractStackKeywords(profile);
    expect(keywords).toContain("next");
    expect(keywords).not.toContain("Next");
  });

  it("trims whitespace", () => {
    const profile = { ...testProfile, frontendFramework: "  next  " };
    const keywords = extractStackKeywords(profile);
    expect(keywords).toContain("next");
  });
});

describe("isStackRelevant", () => {
  it("returns true when rule description contains a stack keyword", () => {
    const rule = makeRule({ description: "Missing rate limiting on Express routes" });
    const keywords = extractStackKeywords(testProfile);
    expect(isStackRelevant(rule, keywords)).toBe(true);
  });

  it("returns true for generic rules with no tech terms", () => {
    const rule = makeRule({ description: "Missing error handling in API endpoints" });
    const keywords = extractStackKeywords(testProfile);
    expect(isStackRelevant(rule, keywords)).toBe(true);
  });

  it("returns false for rules about unrelated tech", () => {
    const rule = makeRule({ description: "Angular component lifecycle hooks are misused" });
    // Profile has "next" not "angular"
    const keywords = extractStackKeywords(testProfile);
    expect(isStackRelevant(rule, keywords)).toBe(false);
  });

  it("is case-insensitive", () => {
    const rule = makeRule({ description: "POSTGRESQL connection pooling is missing" });
    const keywords = extractStackKeywords(testProfile);
    expect(isStackRelevant(rule, keywords)).toBe(true);
  });
});
