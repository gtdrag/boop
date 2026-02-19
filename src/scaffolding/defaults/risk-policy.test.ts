import { describe, expect, it } from "vitest";
import type { DeveloperProfile } from "../../profile/schema.js";
import { DEFAULT_PROFILE } from "../../profile/defaults.js";
import { generateRiskPolicyDefaults } from "./risk-policy.js";
import type { RiskPolicy } from "../../review/adversarial/risk-policy.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<DeveloperProfile> = {}): DeveloperProfile {
  return { ...DEFAULT_PROFILE, name: "Test Dev", ...overrides };
}

function parsePolicy(files: { filepath: string; content: string }[]): RiskPolicy {
  const file = files.find((f) => f.filepath.includes("risk-policy.json"));
  if (!file) throw new Error("No risk-policy.json found");
  return JSON.parse(file.content) as RiskPolicy;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateRiskPolicyDefaults", () => {
  it("always generates exactly one file", () => {
    const files = generateRiskPolicyDefaults(makeProfile());
    expect(files).toHaveLength(1);
    expect(files[0]!.filepath).toBe(".boop/risk-policy.json");
  });

  it("generates valid JSON", () => {
    const files = generateRiskPolicyDefaults(makeProfile());
    expect(() => JSON.parse(files[0]!.content)).not.toThrow();
  });

  it("includes database paths for postgresql profile", () => {
    const profile = makeProfile({
      backendFramework: "express",
      database: "postgresql",
    });
    const policy = parsePolicy(generateRiskPolicyDefaults(profile));
    expect(policy.tiers.high.paths).toContain("db/**");
    expect(policy.tiers.high.paths).toContain("prisma/**");
  });

  it("includes Next.js API routes and middleware for next profile", () => {
    const profile = makeProfile({
      frontendFramework: "next",
      backendFramework: "express",
    });
    const policy = parsePolicy(generateRiskPolicyDefaults(profile));
    expect(policy.tiers.high.paths).toContain("app/api/**");
    expect(policy.tiers.high.paths).toContain("middleware.ts");
  });

  it("includes frontend component paths as medium risk", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const policy = parsePolicy(generateRiskPolicyDefaults(profile));
    expect(policy.tiers.medium.paths).toContain("src/components/**");
    expect(policy.tiers.medium.paths).toContain("app/**");
  });

  it("low tier always has wildcard catch-all", () => {
    const policy = parsePolicy(generateRiskPolicyDefaults(makeProfile()));
    expect(policy.tiers.low.paths).toContain("**");
  });

  it("uses fallback paths when backend is none and no database", () => {
    const profile = makeProfile({
      backendFramework: "none",
      database: "none",
      frontendFramework: "none",
    });
    const policy = parsePolicy(generateRiskPolicyDefaults(profile));
    // Fallback high paths
    expect(policy.tiers.high.paths).toContain("src/api/**");
    // Fallback medium paths
    expect(policy.tiers.medium.paths).toContain("src/components/**");
  });
});
