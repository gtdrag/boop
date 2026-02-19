/**
 * Git tagging utilities for the gauntlet.
 *
 * Creates lightweight tags at checkpoints, commits evolution changes,
 * and provides diff stats for drift tracking.
 */
import { execSync } from "node:child_process";

/**
 * Create a lightweight git tag.
 *
 * @param name - Tag name (e.g. "gauntlet/v1-t1-post").
 * @param cwd - Working directory for the git command.
 * @returns The commit hash the tag points to.
 */
export function createTag(name: string, cwd: string): string {
  execSync(`git tag "${name}"`, { cwd, stdio: "pipe" });
  const hash = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim();
  return hash;
}

/**
 * Stage specific files and commit them.
 *
 * @param files - Array of file paths (relative to cwd) to stage.
 * @param message - Commit message.
 * @param cwd - Working directory for the git command.
 * @returns The new commit hash.
 */
export function commitFiles(files: string[], message: string, cwd: string): string {
  for (const file of files) {
    execSync(`git add "${file}"`, { cwd, stdio: "pipe" });
  }
  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, stdio: "pipe" });
  const hash = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim();
  return hash;
}

/**
 * Check whether a tag exists.
 *
 * @param name - Tag name.
 * @param cwd - Working directory.
 */
export function tagExists(name: string, cwd: string): boolean {
  try {
    execSync(`git rev-parse "refs/tags/${name}"`, { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a tag (for re-runs).
 *
 * @param name - Tag name.
 * @param cwd - Working directory.
 */
export function deleteTag(name: string, cwd: string): void {
  execSync(`git tag -d "${name}"`, { cwd, stdio: "pipe" });
}

/**
 * Check whether the working tree is clean (no uncommitted changes).
 *
 * @param cwd - Working directory.
 */
export function isCleanWorkingTree(cwd: string): boolean {
  const status = execSync("git status --porcelain", { cwd, encoding: "utf-8" }).trim();
  return status.length === 0;
}

/** Diff statistics between two tags. */
export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/**
 * Get diff statistics between two git references.
 *
 * @param fromRef - Starting reference (tag, branch, or commit).
 * @param toRef - Ending reference.
 * @param cwd - Working directory.
 */
export function getDiffStats(fromRef: string, toRef: string, cwd: string): DiffStats {
  try {
    const output = execSync(`git diff --stat "${fromRef}" "${toRef}"`, {
      cwd,
      encoding: "utf-8",
    }).trim();

    if (!output) {
      return { filesChanged: 0, insertions: 0, deletions: 0 };
    }

    // Parse the summary line: "N files changed, M insertions(+), K deletions(-)"
    const lines = output.split("\n");
    const summaryLine = lines[lines.length - 1] ?? "";

    const filesMatch = summaryLine.match(/(\d+)\s+files?\s+changed/);
    const insertMatch = summaryLine.match(/(\d+)\s+insertions?\(\+\)/);
    const deleteMatch = summaryLine.match(/(\d+)\s+deletions?\(-\)/);

    return {
      filesChanged: filesMatch ? Number.parseInt(filesMatch[1]!, 10) : 0,
      insertions: insertMatch ? Number.parseInt(insertMatch[1]!, 10) : 0,
      deletions: deleteMatch ? Number.parseInt(deleteMatch[1]!, 10) : 0,
    };
  } catch {
    return { filesChanged: 0, insertions: 0, deletions: 0 };
  }
}

/**
 * Get the current HEAD commit hash.
 *
 * @param cwd - Working directory.
 */
export function getCurrentCommit(cwd: string): string {
  return execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim();
}
