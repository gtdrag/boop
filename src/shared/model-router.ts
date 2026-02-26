/**
 * Model routing — selects the cheapest model that works for each pipeline phase.
 *
 * Resolution order:
 *   1. profile.modelOverrides?.[phase] (explicit per-phase override)
 *   2. Smart default: Sonnet for planning/review/retrospective, Opus for building
 *   3. profile.aiModel (global fallback)
 *   4. "claude-opus-4-6" (hardcoded last resort)
 *
 * Building uses Opus because it spawns Claude Code CLI sessions that need
 * the strongest reasoning. Planning and review are Messages API calls where
 * Sonnet performs comparably at ~82% lower cost.
 */
import type { DeveloperProfile } from "../profile/schema.js";

/** Pipeline phase groups for model routing. */
export type PipelinePhaseGroup = "planning" | "building" | "review" | "retrospective" | "analysis";

const SMART_DEFAULTS: Record<PipelinePhaseGroup, string> = {
  planning: "claude-sonnet-4-5-20250929",
  building: "claude-opus-4-6",
  review: "claude-sonnet-4-5-20250929",
  retrospective: "claude-sonnet-4-5-20250929",
  analysis: "claude-sonnet-4-5-20250929",
};

const HARDCODED_FALLBACK = "claude-opus-4-6";

/**
 * Resolve the model to use for a given pipeline phase.
 */
export function resolveModel(phase: PipelinePhaseGroup, profile: DeveloperProfile): string {
  // 1. Explicit per-phase override
  const override = profile.modelOverrides?.[phase];
  if (override) return override;

  // 2. Smart default
  return SMART_DEFAULTS[phase] ?? profile.aiModel ?? HARDCODED_FALLBACK;
}
