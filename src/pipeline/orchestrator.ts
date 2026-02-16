/**
 * Pipeline state machine orchestrator.
 *
 * Manages phase transitions following the sequence:
 * IDLE → PLANNING → BRIDGING → SCAFFOLDING → BUILDING → REVIEWING → SIGN_OFF → COMPLETE
 *
 * SCAFFOLDING runs once per project (first epic only) — subsequent epics skip to BUILDING.
 */
import type { PipelinePhase, PipelineState } from "../shared/types.js";
import { PIPELINE_PHASES } from "../shared/types.js";
import { loadState, saveState, defaultState } from "./state.js";

/**
 * Valid transitions: each phase maps to the set of phases it can move to.
 * BRIDGING can go to SCAFFOLDING (first epic) or BUILDING (subsequent epics).
 */
const TRANSITIONS: Record<PipelinePhase, PipelinePhase[]> = {
  IDLE: ["PLANNING"],
  PLANNING: ["BRIDGING"],
  BRIDGING: ["SCAFFOLDING", "BUILDING"],
  SCAFFOLDING: ["BUILDING"],
  BUILDING: ["REVIEWING"],
  REVIEWING: ["SIGN_OFF"],
  SIGN_OFF: ["COMPLETE"],
  COMPLETE: ["IDLE"],
};

export class PipelineOrchestrator {
  private state: PipelineState;
  private readonly projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.state = loadState(projectDir) ?? defaultState();
  }

  /** Get the current pipeline state (read-only copy). */
  getState(): PipelineState {
    return { ...this.state };
  }

  /**
   * Transition to the next phase.
   * Saves state atomically before and after the transition.
   */
  transition(targetPhase: PipelinePhase): void {
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

    // Skip SCAFFOLDING if already done
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
      "",
      "Continue from this point?",
    ];

    return lines.join("\n");
  }
}
