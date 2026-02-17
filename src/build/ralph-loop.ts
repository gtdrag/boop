/**
 * Ralph build loop — the core autonomous story execution engine.
 *
 * Reads a prd.json, picks the highest-priority incomplete story, runs it
 * through the Claude CLI via {@link runStory}, executes quality checks
 * (typecheck, tests, reality check), and on success commits + marks the
 * story as done. On failure it retries once, then pauses and reports.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { Prd, Story } from "../shared/types.js";
import { runStory } from "./story-runner.js";
import {
  checkDirectory,
  formatViolations,
  type RealityCheckResult,
} from "./reality-check.js";
import {
  appendProgress,
  buildProgressEntry,
  extractClaudeMdUpdates,
  appendToClaudeMd,
} from "./progress.js";
import { ensureBranch, commitStory } from "./git.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RalphLoopOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Path to prd.json (defaults to .boop/prd.json in projectDir). */
  prdPath?: string;
  /** Model to use for the Claude CLI agent. */
  model?: string;
  /** Maximum retries per story on failure. Defaults to 1. */
  maxRetries?: number;
}

export type StoryOutcome = "passed" | "failed" | "no-stories";

export interface LoopResult {
  /** The outcome of the loop iteration. */
  outcome: StoryOutcome;
  /** The story that was processed (if any). */
  story?: Story;
  /** Error message if outcome is "failed". */
  error?: string;
  /** Whether all stories in the PRD are now complete. */
  allComplete: boolean;
}

export interface QualityCheckResult {
  passed: boolean;
  typecheckOutput?: string;
  testOutput?: string;
  realityCheck?: RealityCheckResult;
}

// ---------------------------------------------------------------------------
// PRD I/O
// ---------------------------------------------------------------------------

/**
 * Validate that a parsed object conforms to the Prd schema at runtime.
 * Throws a descriptive error if validation fails.
 */
function validatePrd(data: unknown): asserts data is Prd {
  if (data === null || typeof data !== "object") {
    throw new Error("PRD must be a JSON object");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.project !== "string") {
    throw new Error("PRD 'project' must be a string");
  }
  if (typeof obj.branchName !== "string") {
    throw new Error("PRD 'branchName' must be a string");
  }
  if (typeof obj.description !== "string") {
    throw new Error("PRD 'description' must be a string");
  }

  if (!Array.isArray(obj.userStories)) {
    throw new Error("PRD 'userStories' must be an array");
  }

  for (let i = 0; i < obj.userStories.length; i++) {
    const story = obj.userStories[i] as Record<string, unknown>;
    const prefix = `PRD userStories[${i}]`;

    if (typeof story.id !== "string") {
      throw new Error(`${prefix} 'id' must be a string`);
    }
    if (typeof story.title !== "string") {
      throw new Error(`${prefix} 'title' must be a string`);
    }
    if (typeof story.description !== "string") {
      throw new Error(`${prefix} 'description' must be a string`);
    }
    if (!Array.isArray(story.acceptanceCriteria)) {
      throw new Error(`${prefix} 'acceptanceCriteria' must be an array`);
    }
    if (typeof story.priority !== "number") {
      throw new Error(`${prefix} 'priority' must be a number`);
    }
    if (typeof story.passes !== "boolean") {
      throw new Error(`${prefix} 'passes' must be a boolean`);
    }
  }
}

/**
 * Read and parse the prd.json file.
 * Validates the structure at runtime to catch malformed input early.
 */
export function loadPrd(prdPath: string): Prd {
  try {
    const raw = fs.readFileSync(prdPath, "utf-8");
    const data: unknown = JSON.parse(raw);
    validatePrd(data);
    return data;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load PRD from '${prdPath}': ${msg}`);
  }
}

/**
 * Write the prd.json back to disk (after marking a story as passed).
 */
export function savePrdFile(prd: Prd, prdPath: string): void {
  fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2) + "\n", "utf-8");
}

/**
 * Pick the highest-priority incomplete story from the PRD.
 * Stories are sorted by priority (lower = higher priority).
 * Returns undefined if all stories are complete.
 */
export function pickNextStory(prd: Prd): Story | undefined {
  const incomplete = prd.userStories.filter((s) => !s.passes);
  if (incomplete.length === 0) return undefined;

  // Sort by priority ascending (lowest number = highest priority)
  incomplete.sort((a, b) => a.priority - b.priority);
  return incomplete[0];
}

/**
 * Mark a story as passed in the PRD.
 */
export function markStoryPassed(prd: Prd, storyId: string): void {
  const story = prd.userStories.find((s) => s.id === storyId);
  if (story) {
    story.passes = true;
  }
}

/**
 * Check if all stories in the PRD are complete.
 */
export function allStoriesComplete(prd: Prd): boolean {
  return prd.userStories.every((s) => s.passes);
}

// ---------------------------------------------------------------------------
// Quality checks
// ---------------------------------------------------------------------------

/**
 * Run a shell command and return its output. Returns null on failure.
 */
function runCommand(
  cmd: string,
  cwd: string,
  timeout: number = 120_000,
): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
    });
    return { success: true, output };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string };
    const output = [execError.stdout ?? "", execError.stderr ?? ""]
      .filter(Boolean)
      .join("\n");
    return { success: false, output };
  }
}

/**
 * Run typecheck, tests, and reality check on the project.
 */
export function runQualityChecks(
  projectDir: string,
  options?: { timeout?: number },
): QualityCheckResult {
  const timeout = options?.timeout;

  // 1. Typecheck
  const typecheck = runCommand("pnpm typecheck", projectDir, timeout);
  if (!typecheck.success) {
    return {
      passed: false,
      typecheckOutput: typecheck.output,
    };
  }

  // 2. Tests
  const tests = runCommand("pnpm test", projectDir, timeout);
  if (!tests.success) {
    return {
      passed: false,
      typecheckOutput: typecheck.output,
      testOutput: tests.output,
    };
  }

  // 3. Reality check
  const srcDir = path.join(projectDir, "src");
  const realityCheck = checkDirectory(srcDir);
  if (!realityCheck.passed) {
    return {
      passed: false,
      typecheckOutput: typecheck.output,
      testOutput: tests.output,
      realityCheck,
    };
  }

  return {
    passed: true,
    typecheckOutput: typecheck.output,
    testOutput: tests.output,
    realityCheck,
  };
}

/**
 * Format quality check failures into a human-readable report.
 */
export function formatQualityFailure(result: QualityCheckResult): string {
  const parts: string[] = ["Quality checks FAILED:"];

  if (result.typecheckOutput && !result.testOutput) {
    parts.push("\n--- Typecheck ---", result.typecheckOutput);
  }
  if (result.testOutput) {
    parts.push("\n--- Tests ---", result.testOutput);
  }
  if (result.realityCheck && !result.realityCheck.passed) {
    parts.push(
      "\n--- Reality Check ---",
      formatViolations(result.realityCheck.violations),
    );
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

/**
 * Execute a single iteration of the Ralph build loop.
 *
 * 1. Loads the PRD and picks the next incomplete story.
 * 2. Runs the story through Claude API.
 * 3. Runs quality checks (typecheck, tests, reality check).
 * 4. On pass: marks the story as done in the PRD.
 * 5. On fail: retries once, then reports the failure.
 *
 * @returns The loop result indicating what happened.
 */
export async function runLoopIteration(
  options: RalphLoopOptions,
): Promise<LoopResult> {
  const prdPath =
    options.prdPath ??
    path.join(options.projectDir, ".boop", "prd.json");

  // Load PRD
  const prd = loadPrd(prdPath);

  // Ensure we're on the correct branch before building
  ensureBranch(prd.branchName, options.projectDir);

  // Pick next story
  const story = pickNextStory(prd);
  if (!story) {
    return {
      outcome: "no-stories",
      allComplete: true,
    };
  }

  const maxRetries = options.maxRetries ?? 1;

  const progressPath = path.join(options.projectDir, ".boop", "progress.txt");
  const claudeMdPath = path.join(options.projectDir, "CLAUDE.md");

  // Attempt the story (initial + retries)
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Run the story through Claude
    let responseText = "";
    try {
      const result = await runStory(story, prd, {
        projectDir: options.projectDir,
        model: options.model,
      });
      responseText = result.output;
    } catch (error: unknown) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);

      if (attempt < maxRetries) continue;

      return {
        outcome: "failed",
        story,
        error: `Claude CLI error: ${errorMsg}`,
        allComplete: false,
      };
    }

    // Run quality checks
    const qualityResult = runQualityChecks(options.projectDir);

    if (qualityResult.passed) {
      // Commit the story changes
      commitStory(story.id, story.title, options.projectDir);

      // Mark story as passed and save
      markStoryPassed(prd, story.id);
      savePrdFile(prd, prdPath);

      // Record progress
      const entry = buildProgressEntry(
        story,
        [`Completed story ${story.id}: ${story.title}`],
        [],
        [],
      );
      appendProgress(progressPath, entry);

      // Extract and apply CLAUDE.md updates from agent response
      const claudeMdUpdate = extractClaudeMdUpdates(responseText);
      if (claudeMdUpdate) {
        appendToClaudeMd(claudeMdPath, claudeMdUpdate);
      }

      return {
        outcome: "passed",
        story,
        allComplete: allStoriesComplete(prd),
      };
    }

    // Quality checks failed
    if (attempt < maxRetries) continue;

    return {
      outcome: "failed",
      story,
      error: formatQualityFailure(qualityResult),
      allComplete: false,
    };
  }

  // Should not reach here, but TypeScript needs the return
  return {
    outcome: "failed",
    story,
    error: "Unexpected loop termination",
    allComplete: false,
  };
}
