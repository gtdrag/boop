import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runGit,
  getCurrentBranch,
  branchExists,
  ensureBranch,
  validateBranchName,
  buildStoryCommitMessage,
  buildReviewCommitMessage,
  stageAndCommit,
  commitStory,
  commitReview,
} from "./git.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function git(args: string): string {
  return execSync(`git ${args}`, {
    cwd: tmpDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trimEnd();
}

function initRepo(): void {
  git("init");
  git("config user.name 'Test'");
  git("config user.email 'test@test.com'");
  // Create an initial commit on main so branches can be created
  fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test\n", "utf-8");
  git("add -A");
  git("commit -m 'Initial commit'");
  // Ensure we're on main
  try {
    git("branch -M main");
  } catch {
    // Already on main
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-git-"));
  initRepo();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// runGit
// ---------------------------------------------------------------------------

describe("runGit", () => {
  it("returns success for a valid git command", () => {
    const result = runGit(["status"], tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("On branch");
  });

  it("returns failure for an invalid git command", () => {
    const result = runGit(["not-a-command"], tmpDir);
    expect(result.success).toBe(false);
    expect(result.output.length).toBeGreaterThan(0);
  });

  it("returns failure for a bad directory", () => {
    const result = runGit(["status"], path.join(tmpDir, "nonexistent"));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCurrentBranch
// ---------------------------------------------------------------------------

describe("getCurrentBranch", () => {
  it("returns the current branch name", () => {
    expect(getCurrentBranch(tmpDir)).toBe("main");
  });

  it("returns a newly created branch after checkout", () => {
    git("checkout -b feature/test");
    expect(getCurrentBranch(tmpDir)).toBe("feature/test");
  });

  it("throws when not in a git repo", () => {
    const noGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-nogit-"));
    try {
      expect(() => getCurrentBranch(noGitDir)).toThrow(
        "Failed to get current branch",
      );
    } finally {
      fs.rmSync(noGitDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// branchExists
// ---------------------------------------------------------------------------

describe("branchExists", () => {
  it("returns true for an existing branch", () => {
    expect(branchExists("main", tmpDir)).toBe(true);
  });

  it("returns false for a non-existent branch", () => {
    expect(branchExists("does-not-exist", tmpDir)).toBe(false);
  });

  it("returns true for a newly created branch", () => {
    git("branch new-branch");
    expect(branchExists("new-branch", tmpDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureBranch
// ---------------------------------------------------------------------------

describe("ensureBranch", () => {
  it("returns no-op message when already on the target branch", () => {
    const result = ensureBranch("main", tmpDir);
    expect(result).toContain("Already on branch");
    expect(getCurrentBranch(tmpDir)).toBe("main");
  });

  it("checks out an existing branch", () => {
    git("branch feature/existing");
    const result = ensureBranch("feature/existing", tmpDir);
    expect(result).toContain("Switched to existing branch");
    expect(getCurrentBranch(tmpDir)).toBe("feature/existing");
  });

  it("creates a new branch from main when it does not exist", () => {
    const result = ensureBranch("feature/new", tmpDir);
    expect(result).toContain("Created and switched to new branch");
    expect(result).toContain("from main");
    expect(getCurrentBranch(tmpDir)).toBe("feature/new");
  });

  it("creates a new branch from HEAD when main does not exist", () => {
    // Rename main to something else
    git("branch -m main old-main");
    const result = ensureBranch("feature/no-main", tmpDir);
    expect(result).toContain("Created and switched to new branch");
    expect(result).toContain("from HEAD");
    expect(getCurrentBranch(tmpDir)).toBe("feature/no-main");
  });

  it("rejects invalid branch names", () => {
    expect(() => ensureBranch("branch;rm -rf /", tmpDir)).toThrow(
      "Invalid branch name",
    );
  });
});

// ---------------------------------------------------------------------------
// validateBranchName
// ---------------------------------------------------------------------------

describe("validateBranchName", () => {
  it("accepts valid branch names", () => {
    expect(() => validateBranchName("main")).not.toThrow();
    expect(() => validateBranchName("feature/new-thing")).not.toThrow();
    expect(() => validateBranchName("ralph/epic-4")).not.toThrow();
    expect(() => validateBranchName("release/1.0.0")).not.toThrow();
    expect(() => validateBranchName("my_branch")).not.toThrow();
  });

  it("rejects branch names with spaces", () => {
    expect(() => validateBranchName("my branch")).toThrow("Invalid branch name");
  });

  it("rejects branch names with shell metacharacters", () => {
    expect(() => validateBranchName("branch;rm -rf /")).toThrow("Invalid branch name");
    expect(() => validateBranchName("branch$(whoami)")).toThrow("Invalid branch name");
    expect(() => validateBranchName("branch`id`")).toThrow("Invalid branch name");
  });

  it("rejects empty branch names", () => {
    expect(() => validateBranchName("")).toThrow("Invalid branch name");
  });
});

// ---------------------------------------------------------------------------
// buildStoryCommitMessage
// ---------------------------------------------------------------------------

describe("buildStoryCommitMessage", () => {
  it("formats story commit message correctly", () => {
    expect(buildStoryCommitMessage("4.5", "Git branch management")).toBe(
      "feat: [4.5] - Git branch management",
    );
  });

  it("handles multi-word titles", () => {
    expect(
      buildStoryCommitMessage("1.1", "Fork and strip OpenClaw"),
    ).toBe("feat: [1.1] - Fork and strip OpenClaw");
  });
});

// ---------------------------------------------------------------------------
// buildReviewCommitMessage
// ---------------------------------------------------------------------------

describe("buildReviewCommitMessage", () => {
  it("formats review commit message correctly", () => {
    expect(buildReviewCommitMessage(4, "Code cleanup")).toBe(
      "refactor: Epic 4 review - Code cleanup",
    );
  });

  it("handles longer descriptions", () => {
    expect(
      buildReviewCommitMessage(1, "Resolve tech debt and add missing tests"),
    ).toBe("refactor: Epic 1 review - Resolve tech debt and add missing tests");
  });
});

// ---------------------------------------------------------------------------
// stageAndCommit
// ---------------------------------------------------------------------------

describe("stageAndCommit", () => {
  it("stages and commits changes", () => {
    fs.writeFileSync(path.join(tmpDir, "new-file.txt"), "content\n", "utf-8");

    const result = stageAndCommit("test: add new file", tmpDir);
    expect(result.success).toBe(true);

    // Verify the commit was created
    const log = git("log --oneline -1");
    expect(log).toContain("test: add new file");
  });

  it("returns success with 'Nothing to commit' when there are no changes", () => {
    const result = stageAndCommit("empty commit", tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toBe("Nothing to commit");
  });

  it("handles commit messages with double quotes", () => {
    fs.writeFileSync(path.join(tmpDir, "quoted.txt"), "data\n", "utf-8");

    const result = stageAndCommit('test: handle "quotes"', tmpDir);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// commitStory
// ---------------------------------------------------------------------------

describe("commitStory", () => {
  it("commits with the correct story message format", () => {
    fs.writeFileSync(
      path.join(tmpDir, "feature.ts"),
      "export const x = 1;\n",
      "utf-8",
    );

    const result = commitStory("4.5", "Git branch management", tmpDir);
    expect(result.success).toBe(true);

    const log = git("log --oneline -1");
    expect(log).toContain("feat: [4.5] - Git branch management");
  });
});

// ---------------------------------------------------------------------------
// commitReview
// ---------------------------------------------------------------------------

describe("commitReview", () => {
  it("commits with the correct review message format", () => {
    fs.writeFileSync(
      path.join(tmpDir, "refactored.ts"),
      "export const y = 2;\n",
      "utf-8",
    );

    const result = commitReview(4, "Code cleanup", tmpDir);
    expect(result.success).toBe(true);

    const log = git("log --oneline -1");
    expect(log).toContain("refactor: Epic 4 review - Code cleanup");
  });
});
