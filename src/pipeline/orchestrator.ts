/**
 * Pipeline state machine orchestrator.
 *
 * Manages phase transitions following the sequence:
 * IDLE → PLANNING → BRIDGING → SCAFFOLDING → BUILDING → REVIEWING → SIGN_OFF → DEPLOYING → RETROSPECTIVE → COMPLETE
 *
 * SCAFFOLDING runs once per project (first epic only) — subsequent epics skip to BUILDING.
 * DEPLOYING runs once after all epics complete (not per-epic) and requires cloudProvider config.
 */
import type {
  DeveloperProfile,
  PipelinePhase,
  PipelineState,
  PlanningSubPhase,
} from "../shared/types.js";
import { PIPELINE_PHASES } from "../shared/types.js";
import { loadState, saveState, defaultState } from "./state.js";
import { assessViability } from "../planning/viability.js";
import type { ViabilityResult } from "../planning/viability.js";
import { generatePrd } from "../planning/prd.js";
import type { PrdResult } from "../planning/prd.js";
import { generateArchitecture } from "../planning/architecture.js";
import type { ArchitectureResult } from "../planning/architecture.js";
import { generateStories } from "../planning/stories.js";
import type { StoriesResult } from "../planning/stories.js";
import { retry } from "../shared/retry.js";
import { isRetryableApiError } from "../shared/claude-client.js";
import { createMessagingDispatcher, messagingConfigFromProfile } from "../channels/messaging.js";
import type { MessagingDispatcher, PipelineEvent } from "../channels/messaging.js";
import { loadReviewRules } from "../review/adversarial/review-rules.js";
import { loadDecisionStore, queryRelevantDecisions } from "../evolution/arch-decisions.js";
import { loadHeuristicStore, queryForPhase } from "../evolution/consolidator.js";

/** Result of the full planning chain. */
export interface PlanningResult {
  viability: ViabilityResult;
  prd: PrdResult;
  architecture: ArchitectureResult;
  stories: StoriesResult;
}

/** Error from a failed planning sub-phase. */
export class PlanningPhaseError extends Error {
  readonly phase: PlanningSubPhase;
  readonly cause: unknown;

  constructor(phase: PlanningSubPhase, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Planning phase "${phase}" failed: ${msg}`);
    this.name = "PlanningPhaseError";
    this.phase = phase;
    this.cause = cause;
  }
}

/** Callback for reporting progress during the planning chain. */
export type PlanningProgressCallback = (
  phase: PlanningSubPhase,
  status: "starting" | "completed" | "failed" | "retrying" | "warning",
) => void;

/**
 * Valid transitions: each phase maps to the set of phases it can move to.
 * BRIDGING can go to SCAFFOLDING (first epic) or BUILDING (subsequent epics).
 */
const TRANSITIONS: Record<PipelinePhase, PipelinePhase[]> = {
  IDLE: ["PLANNING", "BRIDGING"],
  PLANNING: ["BRIDGING"],
  BRIDGING: ["SCAFFOLDING", "BUILDING"],
  SCAFFOLDING: ["BUILDING"],
  BUILDING: ["REVIEWING"],
  REVIEWING: ["SIGN_OFF"],
  SIGN_OFF: ["DEPLOYING", "RETROSPECTIVE"],
  DEPLOYING: ["RETROSPECTIVE"],
  RETROSPECTIVE: ["COMPLETE"],
  COMPLETE: ["IDLE"],
};

export class PipelineOrchestrator {
  private state: PipelineState;
  private readonly projectDir: string;
  private readonly profile: DeveloperProfile | null;
  private readonly messaging: MessagingDispatcher;

  constructor(projectDir: string, profile?: DeveloperProfile) {
    this.projectDir = projectDir;
    this.state = loadState(projectDir) ?? defaultState();
    this.profile = profile ?? null;

    const msgConfig = profile ? messagingConfigFromProfile(profile) : { channel: "none" as const };
    this.messaging = createMessagingDispatcher(msgConfig);
  }

  /**
   * Get the developer profile loaded for this pipeline.
   * Returns null if no profile was provided at construction.
   */
  getProfile(): DeveloperProfile | null {
    return this.profile;
  }

  /**
   * Get the messaging dispatcher for lifecycle management (init, start, stop).
   */
  getMessaging(): MessagingDispatcher {
    return this.messaging;
  }

  /**
   * Send a pipeline event notification via the messaging system.
   * No-op if messaging is disabled.
   */
  notify(event: PipelineEvent, context?: { epic?: number; detail?: string }): void {
    void this.messaging.notify(event, context);
  }

  /**
   * Require a developer profile to be loaded.
   * Throws if no profile is available — callers should trigger onboarding.
   */
  requireProfile(): DeveloperProfile {
    if (!this.profile) {
      throw new Error(
        "No developer profile found. Run 'boop --profile' to set up your profile before starting the pipeline.",
      );
    }
    return this.profile;
  }

  /** Get the current pipeline state (read-only copy). */
  getState(): PipelineState {
    return { ...this.state };
  }

  /**
   * Transition to the next phase.
   * Requires a loaded profile for any transition out of IDLE.
   * Saves state atomically before and after the transition.
   */
  transition(targetPhase: PipelinePhase): void {
    // Require profile for any forward pipeline transition (IDLE → PLANNING, etc.)
    if (this.state.phase === "IDLE" && targetPhase !== "IDLE") {
      this.requireProfile();
    }

    const allowed = TRANSITIONS[this.state.phase];
    if (!allowed?.includes(targetPhase)) {
      throw new Error(
        `Invalid transition: ${this.state.phase} → ${targetPhase}. ` +
          `Allowed: ${allowed?.join(", ") ?? "none"}`,
      );
    }

    // SCAFFOLDING skip: if scaffolding is already done, only allow BUILDING from BRIDGING
    if (targetPhase === "SCAFFOLDING" && this.state.scaffoldingComplete) {
      throw new Error(
        "SCAFFOLDING already complete for this project. Transition to BUILDING instead.",
      );
    }

    this.state = {
      ...this.state,
      phase: targetPhase,
      updatedAt: new Date().toISOString(),
    };
    saveState(this.projectDir, this.state);

    // Fire messaging notifications for key phase transitions
    const epic = this.state.epicNumber;
    if (targetPhase === "BUILDING") {
      void this.messaging.notify("build-started", { epic });
    } else if (targetPhase === "REVIEWING") {
      void this.messaging.notify("build-complete", { epic });
    } else if (targetPhase === "SIGN_OFF") {
      void this.messaging.notify("review-complete", { epic });
    } else if (targetPhase === "DEPLOYING") {
      void this.messaging.notify("deployment-started", { epic });
    } else if (targetPhase === "COMPLETE") {
      void this.messaging.notify("retrospective-complete", { epic });
    }
  }

  /**
   * Advance to the next phase in sequence.
   * Automatically skips SCAFFOLDING if it's already been done.
   */
  advance(): void {
    const currentIndex = PIPELINE_PHASES.indexOf(this.state.phase);
    let nextIndex = currentIndex + 1;

    if (nextIndex >= PIPELINE_PHASES.length) {
      throw new Error("Pipeline is already COMPLETE. Reset to IDLE first.");
    }

    let nextPhase = PIPELINE_PHASES[nextIndex]!;

    // Skip SCAFFOLDING if already done.
    // NOTE: DEPLOYING should be entered via explicit transition(), not advance(),
    // since it depends on cloudProvider configuration set in the developer profile.
    if (nextPhase === "SCAFFOLDING" && this.state.scaffoldingComplete) {
      nextIndex++;
      if (nextIndex >= PIPELINE_PHASES.length) {
        throw new Error("No valid next phase after skipping SCAFFOLDING.");
      }
      nextPhase = PIPELINE_PHASES[nextIndex]!;
    }

    this.transition(nextPhase);
  }

  /** Mark scaffolding as complete. */
  completeScaffolding(): void {
    this.state = {
      ...this.state,
      scaffoldingComplete: true,
      updatedAt: new Date().toISOString(),
    };
    saveState(this.projectDir, this.state);
  }

  /** Start a new epic. Resets phase to IDLE and sets epicNumber. */
  startEpic(epicNumber: number): void {
    this.state = {
      ...this.state,
      phase: "IDLE",
      epicNumber,
      currentStory: null,
      lastCompletedStep: null,
      updatedAt: new Date().toISOString(),
    };
    saveState(this.projectDir, this.state);
  }

  /** Set the current story being processed. */
  setCurrentStory(storyId: string): void {
    this.state = {
      ...this.state,
      currentStory: storyId,
      updatedAt: new Date().toISOString(),
    };
    saveState(this.projectDir, this.state);
  }

  /** Record the last completed step within the current phase. */
  setLastCompletedStep(step: string): void {
    this.state = {
      ...this.state,
      lastCompletedStep: step,
      updatedAt: new Date().toISOString(),
    };
    saveState(this.projectDir, this.state);
  }

  /** Reset the pipeline to IDLE. */
  reset(): void {
    this.state = defaultState();
    saveState(this.projectDir, this.state);
  }

  /**
   * Run the full planning chain: viability → PRD → architecture → stories.
   *
   * Each phase receives the output of the previous phase as context.
   * State is updated after each sub-phase completes.
   * If a phase fails, it retries once (via the retry utility), then
   * throws a PlanningPhaseError so the caller can report.
   */
  async runPlanning(
    idea: string,
    options?: { onProgress?: PlanningProgressCallback; autonomous?: boolean },
  ): Promise<PlanningResult> {
    const profile = this.requireProfile();
    const onProgress = options?.onProgress;

    // Ensure we're in PLANNING phase
    if (this.state.phase === "IDLE") {
      this.transition("PLANNING");
    }
    if (this.state.phase !== "PLANNING") {
      throw new Error(
        `Cannot run planning: pipeline is in ${this.state.phase} phase, expected IDLE or PLANNING.`,
      );
    }

    // Load evolution data for prompt augmentation
    const reviewRules = loadReviewRules();
    const archStore = loadDecisionStore();
    const relevantDecisions = queryRelevantDecisions(archStore, profile);
    const heuristicStore = loadHeuristicStore();
    const viabilityHeuristics = queryForPhase(heuristicStore, "viability", profile);
    const prdHeuristics = queryForPhase(heuristicStore, "prd", profile);
    const archHeuristics = queryForPhase(heuristicStore, "architecture", profile);
    const storiesHeuristics = queryForPhase(heuristicStore, "stories", profile);

    // --- Viability ---
    const viability = await this.runPlanningSubPhase<ViabilityResult>(
      "viability",
      () =>
        assessViability(idea, profile, {
          projectDir: this.projectDir,
          reviewRules: reviewRules.length > 0 ? reviewRules : undefined,
          heuristics: viabilityHeuristics.length > 0 ? viabilityHeuristics : undefined,
        }),
      onProgress,
    );

    // If RECONSIDER in interactive mode, halt so the user can decide.
    // In autonomous mode, log the warning and continue — the user
    // explicitly chose to run without gates.
    if (viability.recommendation === "RECONSIDER") {
      if (options?.autonomous) {
        onProgress?.("viability", "warning");
      } else {
        throw new PlanningPhaseError(
          "viability",
          new Error(`Recommendation is RECONSIDER — stopping pipeline.`),
        );
      }
    }

    // --- PRD ---
    const prd = await this.runPlanningSubPhase<PrdResult>(
      "prd",
      () =>
        generatePrd(idea, profile, viability.assessment, {
          projectDir: this.projectDir,
          reviewRules: reviewRules.length > 0 ? reviewRules : undefined,
          heuristics: prdHeuristics.length > 0 ? prdHeuristics : undefined,
        }),
      onProgress,
    );

    // --- Architecture ---
    const architecture = await this.runPlanningSubPhase<ArchitectureResult>(
      "architecture",
      () =>
        generateArchitecture(idea, profile, prd.prd, {
          projectDir: this.projectDir,
          reviewRules: reviewRules.length > 0 ? reviewRules : undefined,
          archDecisions: relevantDecisions.length > 0 ? relevantDecisions : undefined,
          heuristics: archHeuristics.length > 0 ? archHeuristics : undefined,
        }),
      onProgress,
    );

    // --- Stories ---
    const stories = await this.runPlanningSubPhase<StoriesResult>(
      "stories",
      () =>
        generateStories(idea, profile, prd.prd, architecture.architecture, {
          projectDir: this.projectDir,
          reviewRules: reviewRules.length > 0 ? reviewRules : undefined,
          heuristics: storiesHeuristics.length > 0 ? storiesHeuristics : undefined,
        }),
      onProgress,
    );

    await this.messaging.notify("planning-complete", { epic: this.state.epicNumber });

    return { viability, prd, architecture, stories };
  }

  /**
   * Run a single planning sub-phase with retry (1 retry = 2 total attempts).
   * Updates lastCompletedStep on success.
   */
  private async runPlanningSubPhase<T>(
    phase: PlanningSubPhase,
    fn: () => Promise<T>,
    onProgress?: PlanningProgressCallback,
  ): Promise<T> {
    onProgress?.(phase, "starting");

    try {
      const result = await retry(fn, {
        maxRetries: 1,
        isRetryable: isRetryableApiError,
        onRetry: () => {
          onProgress?.(phase, "retrying");
        },
      });

      this.setLastCompletedStep(phase);
      onProgress?.(phase, "completed");
      return result;
    } catch (error: unknown) {
      onProgress?.(phase, "failed");
      throw new PlanningPhaseError(phase, error);
    }
  }

  /** Format state as a human-readable status string. */
  formatStatus(): string {
    const s = this.state;
    const lines: string[] = [];

    if (s.phase === "IDLE" && s.epicNumber === 0) {
      lines.push("No active pipeline. Run 'boop <idea>' to start.");
      return lines.join("\n");
    }

    lines.push(`Phase:    ${s.phase}`);
    lines.push(`Epic:     ${s.epicNumber}`);

    if (this.profile) {
      lines.push(`Profile:  ${this.profile.name}`);
    }

    if (s.currentStory) {
      lines.push(`Story:    ${s.currentStory}`);
    }

    if (s.lastCompletedStep) {
      lines.push(`Step:     ${s.lastCompletedStep}`);
    }

    lines.push(`Updated:  ${s.updatedAt}`);

    return lines.join("\n");
  }

  /** Format resume context for the --resume command. */
  formatResumeContext(): string {
    const s = this.state;

    if (s.phase === "IDLE" && s.epicNumber === 0) {
      return "No interrupted pipeline to resume.";
    }

    const lines: string[] = [
      "Pipeline state:",
      `  Phase:          ${s.phase}`,
      `  Epic:           ${s.epicNumber}`,
      `  Story:          ${s.currentStory ?? "(none)"}`,
      `  Last step:      ${s.lastCompletedStep ?? "(none)"}`,
      `  Last updated:   ${s.updatedAt}`,
    ];

    if (this.profile) {
      lines.push(`  Profile:        ${this.profile.name}`);
    }

    lines.push("", "Continue from this point?");

    return lines.join("\n");
  }
}
