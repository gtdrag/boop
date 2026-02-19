/**
 * Risk-tiered review policy.
 *
 * Loads a `.boop/risk-policy.json` contract that defines risk tiers by file
 * path. The adversarial loop adjusts iterations, severity threshold, and
 * agent selection based on the highest-risk tier matched.
 *
 * When no policy file exists, returns `null` so callers fall back to defaults.
 */
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

import type { AdversarialAgentType } from "./runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity levels that can be used as a fix threshold (excludes "info"). */
export type FixSeverityThreshold = "critical" | "high" | "medium" | "low";

export interface RiskTier {
  /** Glob patterns for files in this tier. */
  paths: string[];
  /** Maximum adversarial loop iterations for this tier. */
  maxIterations: number;
  /** Minimum severity to auto-fix. */
  minFixSeverity: FixSeverityThreshold;
  /** Which adversarial agents to run. */
  agents: AdversarialAgentType[];
  /** Require human approval before the fixer runs. Defaults to false. */
  requireApproval?: boolean;
}

export interface RiskPolicy {
  /** Schema version. */
  version: string;
  /** Risk tiers keyed by name. */
  tiers: { high: RiskTier; medium: RiskTier; low: RiskTier };
}

export type RiskTierName = "high" | "medium" | "low";

export interface ResolvedRiskTier {
  /** Which tier matched. */
  tierName: RiskTierName;
  /** The tier configuration. */
  tier: RiskTier;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Returns the built-in default risk policy.
 *
 * Matches the behavior before risk-tiered review was introduced:
 * 3 iterations, minFixSeverity "high", all 3 agents, wildcard paths.
 */
export function getDefaultRiskPolicy(): RiskPolicy {
  return {
    version: "1",
    tiers: {
      high: {
        paths: ["src/api/**", "src/auth/**", "src/middleware/**", "db/**"],
        maxIterations: 3,
        minFixSeverity: "medium",
        agents: ["code-quality", "test-coverage", "security"],
        requireApproval: true,
      },
      medium: {
        paths: ["src/components/**", "src/routes/**", "src/pages/**"],
        maxIterations: 2,
        minFixSeverity: "high",
        agents: ["code-quality", "test-coverage"],
        requireApproval: false,
      },
      low: {
        paths: ["**"],
        maxIterations: 1,
        minFixSeverity: "critical",
        agents: ["code-quality"],
        requireApproval: false,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const RISK_POLICY_FILE = ".boop/risk-policy.json";

/**
 * Load a risk policy from `<projectDir>/.boop/risk-policy.json`.
 * Returns `null` when the file doesn't exist.
 */
export function loadRiskPolicy(projectDir: string): RiskPolicy | null {
  const filePath = path.join(projectDir, RISK_POLICY_FILE);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as RiskPolicy;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tier resolution
// ---------------------------------------------------------------------------

/** Ordered from highest to lowest risk. */
const TIER_ORDER: RiskTierName[] = ["high", "medium", "low"];

/**
 * Resolve which risk tier applies given a set of changed files.
 *
 * Checks tiers in order: high → medium → low. If **any** changed file
 * matches a high-tier glob, the entire review runs at high tier.
 * Falls through to low (which should have `**` as a catch-all).
 */
export function resolveRiskTier(policy: RiskPolicy, changedFiles: string[]): ResolvedRiskTier {
  for (const tierName of TIER_ORDER) {
    const tier = policy.tiers[tierName];
    const isMatch = picomatch(tier.paths);

    for (const file of changedFiles) {
      if (isMatch(file)) {
        return { tierName, tier };
      }
    }
  }

  // Fallback: if nothing matched (shouldn't happen with `**`), use low tier
  return { tierName: "low", tier: policy.tiers.low };
}
