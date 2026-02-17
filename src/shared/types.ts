/**
 * Shared TypeScript types for Boop.
 *
 * Defines the core data structures used across all pipeline phases:
 * pipeline state, developer profile, and story format.
 */

// ---------------------------------------------------------------------------
// Pipeline State
// ---------------------------------------------------------------------------

export const PIPELINE_PHASES = [
  "IDLE",
  "PLANNING",
  "BRIDGING",
  "SCAFFOLDING",
  "BUILDING",
  "REVIEWING",
  "SIGN_OFF",
  "DEPLOYING",
  "RETROSPECTIVE",
  "COMPLETE",
] as const;

export type PipelinePhase = (typeof PIPELINE_PHASES)[number];

export const PLANNING_SUB_PHASES = ["viability", "prd", "architecture", "stories"] as const;

export type PlanningSubPhase = (typeof PLANNING_SUB_PHASES)[number];

export interface PipelineState {
  /** Current phase of the pipeline. */
  phase: PipelinePhase;
  /** Epic number currently being processed (1-based). */
  epicNumber: number;
  /** Story ID currently being processed (e.g. "1.3"). */
  currentStory: string | null;
  /** Last completed step within the current phase. */
  lastCompletedStep: string | null;
  /** Whether SCAFFOLDING has already run for this project. */
  scaffoldingComplete: boolean;
  /** ISO-8601 timestamp of last state update. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Developer Profile (canonical definition in src/profile/schema.ts)
// ---------------------------------------------------------------------------

export type { DeveloperProfile, ProfileCategory } from "../profile/schema.js";

// ---------------------------------------------------------------------------
// Story Format
// ---------------------------------------------------------------------------

export interface Story {
  /** Story ID (e.g. "1.3"). */
  id: string;
  /** Short human-readable title. */
  title: string;
  /** Full description (user-story format). */
  description: string;
  /** List of acceptance criteria. */
  acceptanceCriteria: string[];
  /** Priority (lower = higher priority). */
  priority: number;
  /** Whether the story passes all quality checks. */
  passes: boolean;
  /** Optional implementation notes. */
  notes?: string;
}

export interface Prd {
  /** Project name. */
  project: string;
  /** Git branch name for this epic. */
  branchName: string;
  /** Epic description. */
  description: string;
  /** Ordered list of user stories. */
  userStories: Story[];
}

// ---------------------------------------------------------------------------
// Log Entry
// ---------------------------------------------------------------------------

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface LogEntry {
  /** ISO-8601 timestamp. */
  ts: string;
  /** Severity level. */
  level: LogLevel;
  /** Pipeline phase that emitted the log. */
  phase: string;
  /** Epic identifier (e.g. "1"). */
  epic: string;
  /** Story identifier (e.g. "1.3"). */
  story: string;
  /** Human-readable message. */
  msg: string;
}
