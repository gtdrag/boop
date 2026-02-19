import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  loadRiskPolicy,
  resolveRiskTier,
  getDefaultRiskPolicy,
} from "./risk-policy.js";
import type { RiskPolicy } from "./risk-policy.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(),
  },
}));

const mockFs = vi.mocked((await import("node:fs")).default);

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// getDefaultRiskPolicy
// ---------------------------------------------------------------------------

describe("getDefaultRiskPolicy", () => {
  it("returns a valid policy with high, medium, low tiers", () => {
    const policy = getDefaultRiskPolicy();
    expect(policy.version).toBe("1");
    expect(policy.tiers.high).toBeDefined();
    expect(policy.tiers.medium).toBeDefined();
    expect(policy.tiers.low).toBeDefined();
  });

  it("high tier has all three agents", () => {
    const policy = getDefaultRiskPolicy();
    expect(policy.tiers.high.agents).toEqual(["code-quality", "test-coverage", "security"]);
  });

  it("low tier catches all files with wildcard", () => {
    const policy = getDefaultRiskPolicy();
    expect(policy.tiers.low.paths).toContain("**");
  });
});

// ---------------------------------------------------------------------------
// loadRiskPolicy
// ---------------------------------------------------------------------------

describe("loadRiskPolicy", () => {
  it("returns parsed policy when file exists", () => {
    const policy = getDefaultRiskPolicy();
    mockFs.readFileSync.mockReturnValue(JSON.stringify(policy));

    const result = loadRiskPolicy("/project");
    expect(result).toEqual(policy);
    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      "/project/.boop/risk-policy.json",
      "utf-8",
    );
  });

  it("returns null when file does not exist", () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = loadRiskPolicy("/project");
    expect(result).toBeNull();
  });

  it("returns null when file contains invalid JSON", () => {
    mockFs.readFileSync.mockReturnValue("not-json");

    const result = loadRiskPolicy("/project");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveRiskTier
// ---------------------------------------------------------------------------

describe("resolveRiskTier", () => {
  const policy: RiskPolicy = {
    version: "1",
    tiers: {
      high: {
        paths: ["src/api/**", "src/auth/**"],
        maxIterations: 3,
        minFixSeverity: "medium",
        agents: ["code-quality", "test-coverage", "security"],
      },
      medium: {
        paths: ["src/components/**", "src/pages/**"],
        maxIterations: 2,
        minFixSeverity: "high",
        agents: ["code-quality", "test-coverage"],
      },
      low: {
        paths: ["**"],
        maxIterations: 1,
        minFixSeverity: "critical",
        agents: ["code-quality"],
      },
    },
  };

  it("returns high tier when any file matches high-risk paths", () => {
    const result = resolveRiskTier(policy, [
      "src/api/routes.ts",
      "src/components/button.tsx",
    ]);
    expect(result.tierName).toBe("high");
    expect(result.tier.maxIterations).toBe(3);
  });

  it("returns medium tier when files match medium but not high", () => {
    const result = resolveRiskTier(policy, [
      "src/components/button.tsx",
      "src/pages/home.tsx",
    ]);
    expect(result.tierName).toBe("medium");
    expect(result.tier.maxIterations).toBe(2);
  });

  it("returns low tier for unmatched paths", () => {
    const result = resolveRiskTier(policy, ["README.md", "docs/guide.md"]);
    expect(result.tierName).toBe("low");
    expect(result.tier.maxIterations).toBe(1);
  });

  it("returns high tier when only one file is high-risk among many", () => {
    const result = resolveRiskTier(policy, [
      "README.md",
      "src/utils/helpers.ts",
      "src/auth/login.ts",
    ]);
    expect(result.tierName).toBe("high");
  });

  it("returns low tier for empty file list", () => {
    const result = resolveRiskTier(policy, []);
    expect(result.tierName).toBe("low");
  });

  it("matches deeply nested paths within high-risk globs", () => {
    const result = resolveRiskTier(policy, [
      "src/api/v2/internal/handler.ts",
    ]);
    expect(result.tierName).toBe("high");
  });

  it("uses the tier's agents correctly", () => {
    const high = resolveRiskTier(policy, ["src/api/foo.ts"]);
    expect(high.tier.agents).toEqual(["code-quality", "test-coverage", "security"]);

    const medium = resolveRiskTier(policy, ["src/components/foo.tsx"]);
    expect(medium.tier.agents).toEqual(["code-quality", "test-coverage"]);

    const low = resolveRiskTier(policy, ["package.json"]);
    expect(low.tier.agents).toEqual(["code-quality"]);
  });
});
