/**
 * Git branch management utilities for the Ralph build loop.
 *
 * Manages branch creation/checkout at build-phase start and enforces
 * commit message formats for story and review commits.
 */

import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitResult {
  /** Whether the command succeeded. */
  success: boolean;
  /** stdout + stderr output from the command. */
  output: string;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command and return the result.
 */
export function runGit(args: string, cwd: string): GitResult {
  try {
    const output = execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
    return { success: true, output: output.trimEnd() };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string };
    const output = [execError.stdout ?? "", execError.stderr ?? ""]
      .filter(Boolean)
      .join("\n")
      .trimEnd();
    return { success: false, output };
  }
}

/**
 * Get the current branch name.
 */
export function getCurrentBranch(cwd: string): string {
  const result = runGit("rev-parse --abbrev-ref HEAD", cwd);
  if (!result.success) {
    throw new Error(`Failed to get current branch: ${result.output}`);
  }
  return result.output;
}

/**
 * Check if a local branch exists.
 */
export function branchExists(branchName: string, cwd: string): boolean {
  const result = runGit(
    `rev-parse --verify refs/heads/${branchName}`,
    cwd,
  );
  return result.success;
}

// ---------------------------------------------------------------------------
// Branch management
// ---------------------------------------------------------------------------

/**
 * Ensure the target branch exists and is checked out.
 *
 * - If already on the branch, no-op.
 * - If the branch exists locally, check it out.
 * - If the branch does not exist, create it from main (or current HEAD).
 *
 * @param branchName - The target branch name (e.g. "ralph/epic-4").
 * @param cwd - The project directory.
 * @returns A description of what happened.
 */
export function ensureBranch(branchName: string, cwd: string): string {
  const current = getCurrentBranch(cwd);

  if (current === branchName) {
    return `Already on branch '${branchName}'`;
  }

  if (branchExists(branchName, cwd)) {
    const result = runGit(`checkout ${branchName}`, cwd);
    if (!result.success) {
      throw new Error(
        `Failed to checkout branch '${branchName}': ${result.output}`,
      );
    }
    return `Switched to existing branch '${branchName}'`;
  }

  // Create the branch from main if it exists, otherwise from HEAD
  const base = branchExists("main", cwd) ? "main" : "HEAD";
  const result = runGit(`checkout -b ${branchName} ${base}`, cwd);
  if (!result.success) {
    throw new Error(
      `Failed to create branch '${branchName}': ${result.output}`,
    );
  }
  return `Created and switched to new branch '${branchName}' from ${base}`;
}

// ---------------------------------------------------------------------------
// Commit message formatting
// ---------------------------------------------------------------------------

/**
 * Build a story commit message.
 *
 * Format: `feat: [Story ID] - [Story Title]`
 */
export function buildStoryCommitMessage(
  storyId: string,
  storyTitle: string,
): string {
  return `feat: [${storyId}] - ${storyTitle}`;
}

/**
 * Build a review-phase commit message.
 *
 * Format: `refactor: Epic N review - [description]`
 */
export function buildReviewCommitMessage(
  epicNumber: number,
  description: string,
): string {
  return `refactor: Epic ${epicNumber} review - ${description}`;
}

// ---------------------------------------------------------------------------
// Staging and committing
// ---------------------------------------------------------------------------

/**
 * Stage all changes and commit with the given message.
 *
 * @returns The git result from the commit command.
 */
export function stageAndCommit(message: string, cwd: string): GitResult {
  // Stage all changes
  const addResult = runGit("add -A", cwd);
  if (!addResult.success) {
    return addResult;
  }

  // Check if there's anything to commit
  const statusResult = runGit("diff --cached --quiet", cwd);
  if (statusResult.success) {
    // Exit code 0 means no staged changes
    return { success: true, output: "Nothing to commit" };
  }

  // Commit (using -- to prevent message from being treated as a path)
  return runGit(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
}

/**
 * Stage all changes and commit with a story commit message.
 */
export function commitStory(
  storyId: string,
  storyTitle: string,
  cwd: string,
): GitResult {
  const message = buildStoryCommitMessage(storyId, storyTitle);
  return stageAndCommit(message, cwd);
}

/**
 * Stage all changes and commit with a review commit message.
 */
export function commitReview(
  epicNumber: number,
  description: string,
  cwd: string,
): GitResult {
  const message = buildReviewCommitMessage(epicNumber, description);
  return stageAndCommit(message, cwd);
}
