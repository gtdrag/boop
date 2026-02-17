/**
 * Pipeline state persistence.
 *
 * Reads and writes PipelineState to .boop/state.yaml atomically
 * (write-to-temp then rename) to prevent corruption on crash.
 */
import fs from "node:fs";
import path from "node:path";
import { stringify, parse } from "yaml";
import type { PipelineState } from "../shared/types.js";

const STATE_FILENAME = "state.yaml";
const BOOP_DIR = ".boop";

/** Default state for a brand-new pipeline. */
export function defaultState(): PipelineState {
  return {
    phase: "IDLE",
    epicNumber: 0,
    currentStory: null,
    lastCompletedStep: null,
    scaffoldingComplete: false,
    updatedAt: new Date().toISOString(),
  };
}

/** Resolve the .boop/state.yaml path for a project directory. */
export function stateFilePath(projectDir: string): string {
  return path.join(projectDir, BOOP_DIR, STATE_FILENAME);
}

/**
 * Load pipeline state from .boop/state.yaml.
 * Returns null if the file doesn't exist.
 */
export function loadState(projectDir: string): PipelineState | null {
  const filePath = stateFilePath(projectDir);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return parse(raw) as PipelineState;
  } catch {
    return null;
  }
}

/**
 * Save pipeline state atomically to .boop/state.yaml.
 * Writes to a temp file first, then renames to avoid partial writes.
 */
export function saveState(projectDir: string, state: PipelineState): void {
  const dirPath = path.join(projectDir, BOOP_DIR);
  const filePath = stateFilePath(projectDir);
  const tmpPath = filePath + ".tmp";

  try {
    fs.mkdirSync(dirPath, { recursive: true });

    const updated: PipelineState = {
      ...state,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(tmpPath, stringify(updated), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (error: unknown) {
    // Attempt to clean up the temp file if it exists
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to save pipeline state: ${msg}`);
  }
}
