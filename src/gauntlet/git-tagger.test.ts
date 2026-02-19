/**
 * Tests for gauntlet git tagger.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTag,
  commitFiles,
  tagExists,
  deleteTag,
  isCleanWorkingTree,
  getDiffStats,
  getCurrentCommit,
} from "./git-tagger.js";

describe("git-tagger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-git-"));
    // Initialize a git repo with an initial commit
    execSync("git init", { cwd: tmpDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: tmpDir, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: tmpDir, stdio: "pipe" });
    fs.writeFileSync(path.join(tmpDir, "init.txt"), "init", "utf-8");
    execSync("git add . && git commit -m 'init'", { cwd: tmpDir, stdio: "pipe" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- createTag ---
  it("creates a lightweight tag and returns commit hash", () => {
    const hash = createTag("test-tag", tmpDir);
    expect(hash).toMatch(/^[a-f0-9]{40}$/);

    // Verify tag exists
    const tagRef = execSync('git rev-parse "refs/tags/test-tag"', {
      cwd: tmpDir,
      encoding: "utf-8",
    }).trim();
    expect(tagRef).toBe(hash);
  });

  // --- tagExists ---
  it("returns true for existing tag", () => {
    execSync('git tag "my-tag"', { cwd: tmpDir, stdio: "pipe" });
    expect(tagExists("my-tag", tmpDir)).toBe(true);
  });

  it("returns false for non-existing tag", () => {
    expect(tagExists("no-such-tag", tmpDir)).toBe(false);
  });

  // --- deleteTag ---
  it("deletes an existing tag", () => {
    execSync('git tag "to-delete"', { cwd: tmpDir, stdio: "pipe" });
    expect(tagExists("to-delete", tmpDir)).toBe(true);

    deleteTag("to-delete", tmpDir);
    expect(tagExists("to-delete", tmpDir)).toBe(false);
  });

  // --- isCleanWorkingTree ---
  it("returns true for clean working tree", () => {
    expect(isCleanWorkingTree(tmpDir)).toBe(true);
  });

  it("returns false for dirty working tree", () => {
    fs.writeFileSync(path.join(tmpDir, "dirty.txt"), "dirty", "utf-8");
    expect(isCleanWorkingTree(tmpDir)).toBe(false);
  });

  // --- commitFiles ---
  it("stages and commits specific files", () => {
    fs.writeFileSync(path.join(tmpDir, "file1.txt"), "content1", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "file2.txt"), "content2", "utf-8");

    const hash = commitFiles(["file1.txt", "file2.txt"], "test commit", tmpDir);
    expect(hash).toMatch(/^[a-f0-9]{40}$/);

    // Verify commit message
    const msg = execSync("git log -1 --format=%s", { cwd: tmpDir, encoding: "utf-8" }).trim();
    expect(msg).toBe("test commit");
  });

  // --- getDiffStats ---
  it("returns diff stats between two refs", () => {
    createTag("before", tmpDir);

    fs.writeFileSync(path.join(tmpDir, "new-file.txt"), "hello\nworld\n", "utf-8");
    execSync("git add . && git commit -m 'add file'", { cwd: tmpDir, stdio: "pipe" });

    const stats = getDiffStats("before", "HEAD", tmpDir);
    expect(stats.filesChanged).toBe(1);
    expect(stats.insertions).toBeGreaterThan(0);
  });

  it("returns zeros for identical refs", () => {
    createTag("same-point", tmpDir);
    const stats = getDiffStats("same-point", "HEAD", tmpDir);
    expect(stats.filesChanged).toBe(0);
    expect(stats.insertions).toBe(0);
    expect(stats.deletions).toBe(0);
  });

  // --- getCurrentCommit ---
  it("returns current HEAD commit hash", () => {
    const hash = getCurrentCommit(tmpDir);
    expect(hash).toMatch(/^[a-f0-9]{40}$/);
  });
});
