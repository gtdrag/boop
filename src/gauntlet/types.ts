/**
 * Gauntlet type definitions.
 *
 * All interfaces for tier definitions, run results, evolution tracking,
 * and runner configuration.
 */
import type { DeveloperProfile, PipelinePhase } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Tier Definitions (from YAML)
// ---------------------------------------------------------------------------

/** Profile field overrides for a specific tier. */
export type ProfileOverrides = Partial<DeveloperProfile>;

/** Success criteria for a tier run. */
export interface TierSuccessCriteria {
  /** Minimum pipeline phase that must be reached. */
  minPhaseReached: PipelinePhase;
  /** Whether planning must complete successfully. */
  planningMustPass: boolean;
}

/** A single tier in the gauntlet — one project complexity level. */
export interface GauntletTier {
  /** Tier identifier (e.g. "t1-todo-app"). */
  id: string;
  /** Short human-readable label. */
  label: string;
  /** Numeric tier level (1-6). */
  level: number;
  /** The project idea to feed to the pipeline. */
  idea: string;
  /** Stack / tech description for context. */
  stack: string;
  /** Why this tier exists at this level. */
  rationale: string;
  /** Profile overrides for this tier. */
  profileOverrides?: ProfileOverrides;
  /** Success criteria for this tier. */
  successCriteria: TierSuccessCriteria;
}

/** Full gauntlet definition parsed from YAML. */
export interface GauntletDefinition {
  /** Unique gauntlet ID (e.g. "gauntlet-v1"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this gauntlet tests. */
  description: string;
  /** Ordered list of tiers. */
  tiers: GauntletTier[];
}

// ---------------------------------------------------------------------------
// Self-Assessment Notes
// ---------------------------------------------------------------------------

/** Category of a note collected after a tier run. */
export type NoteCategory = "struggle" | "success" | "observation";

/** A self-assessment note from a tier run. */
export interface GauntletNote {
  /** Pipeline phase this note relates to. */
  phase: string;
  /** Classification. */
  category: NoteCategory;
  /** Human-readable note text. */
  text: string;
}

// ---------------------------------------------------------------------------
// Tier Results
// ---------------------------------------------------------------------------

/** Result of running a single tier. */
export interface GauntletTierResult {
  /** Tier ID. */
  tierId: string;
  /** Tier level (1-6). */
  level: number;
  /** Whether the tier succeeded per its criteria. */
  success: boolean;
  /** The furthest pipeline phase reached. */
  phaseReached: PipelinePhase;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Errors encountered during the run. */
  errors: string[];
  /** Self-assessment notes. */
  notes: GauntletNote[];
  /** Git tags created for this tier. */
  tags: { post: string; evolved?: string };
}

// ---------------------------------------------------------------------------
// Evolution
// ---------------------------------------------------------------------------

/** Result of an evolution step after a tier. */
export interface EvolutionStepResult {
  /** Tier that triggered the evolution. */
  tierId: string;
  /** Prompt files that were modified. */
  promptsChanged: string[];
  /** Number of new heuristics added. */
  heuristicsAdded: number;
  /** Number of architecture decisions added. */
  archDecisionsAdded: number;
  /** Files that were changed (committed). */
  filesChanged: string[];
  /** Whether evolution was approved. */
  approved: boolean;
  /** Whether evolution was skipped by user. */
  skipped: boolean;
}

/** Entry in the evolution log (evolution-log.yaml). */
export interface EvolutionLogEntry {
  /** Tier ID. */
  tier: string;
  /** ISO-8601 timestamp. */
  date: string;
  /** Prompt files changed. */
  promptsChanged: string[];
  /** Number of heuristics added. */
  heuristicsAdded: number;
  /** Number of architecture decisions added. */
  archDecisionsAdded: number;
  /** Cumulative diff lines from baseline. */
  cumulativeDiffLines: number;
  /** Any regressions detected. */
  regressions: string[];
}

// ---------------------------------------------------------------------------
// Full Run Result
// ---------------------------------------------------------------------------

/** Summary of a gauntlet run. */
export interface GauntletSummary {
  /** Total tiers attempted. */
  totalTiers: number;
  /** Tiers that passed. */
  passed: number;
  /** Tiers that failed. */
  failed: number;
  /** Total duration across all tiers. */
  totalDurationMs: number;
  /** Number of evolution steps applied. */
  evolutionSteps: number;
}

/** Full result of a gauntlet run. */
export interface GauntletResult {
  /** Gauntlet definition ID. */
  gauntletId: string;
  /** Unique run ID. */
  runId: string;
  /** ISO-8601 start timestamp. */
  startedAt: string;
  /** ISO-8601 completion timestamp. */
  completedAt: string;
  /** Git commit hash at time of run. */
  gitCommit: string;
  /** Per-tier results. */
  tiers: GauntletTierResult[];
  /** Evolution steps applied. */
  evolutionSteps: EvolutionStepResult[];
  /** Aggregate summary. */
  summary: GauntletSummary;
}

/** Metadata entry for a persisted gauntlet run. */
export interface GauntletRunEntry {
  /** Unique run ID. */
  runId: string;
  /** Gauntlet definition ID. */
  gauntletId: string;
  /** ISO-8601 start timestamp. */
  startedAt: string;
  /** Tiers passed. */
  passed: number;
  /** Tiers failed. */
  failed: number;
  /** Git commit hash. */
  gitCommit: string;
}

// ---------------------------------------------------------------------------
// Runner Options
// ---------------------------------------------------------------------------

/** User response at the approval gate between tiers. */
export type ApprovalAction = "approve" | "skip" | "stop";

/** Callback presented to the user between tiers. */
export type ApprovalCallback = (
  tierResult: GauntletTierResult,
  report: string,
  driftStats: { filesChanged: number; insertions: number; deletions: number },
) => Promise<ApprovalAction>;

/** Configuration for running a gauntlet. */
export interface GauntletRunOptions {
  /** Path to the gauntlet YAML definition. */
  definitionPath: string;
  /** Root workspace directory for tier project dirs. */
  workspaceDir: string;
  /** Base developer profile. */
  baseProfile: DeveloperProfile;
  /** Project root (boop repo) for tagging and evolution. */
  projectRoot: string;
  /** Only run up to this tier number (inclusive). */
  maxTier?: number;
  /** Start from this tier number (for resuming). */
  startTier?: number;
  /** Approval callback. If not provided, auto-approves (dangerous). */
  approvalCallback?: ApprovalCallback;
  /** Progress callback. */
  onProgress?: (tierId: string, message: string) => void;
}
