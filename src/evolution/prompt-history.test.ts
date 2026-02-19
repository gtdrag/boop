import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getCurrentVersion,
  listVersions,
  loadVersion,
  rollback,
  saveVersion,
} from "./prompt-history.js";

describe("prompt-history", () => {
  let tmpDir: string;
  let memoryDir: string;
  let promptsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-test-"));
    memoryDir = path.join(tmpDir, "memory");
    promptsDir = path.join(tmpDir, "prompts");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveVersion creates directory structure and files", () => {
    const entry = saveVersion("viability", "# Prompt v1", "Initial version", memoryDir);

    expect(entry.phase).toBe("viability");
    expect(entry.version).toBe(1);
    expect(entry.changeSummary).toBe("Initial version");
    expect(entry.createdAt).toBeTruthy();

    const contentPath = path.join(memoryDir, "prompt-versions", "viability", "v1.md");
    expect(fs.existsSync(contentPath)).toBe(true);
    expect(fs.readFileSync(contentPath, "utf-8")).toBe("# Prompt v1");

    const indexPath = path.join(memoryDir, "prompt-versions", "viability", "index.json");
    expect(fs.existsSync(indexPath)).toBe(true);
  });

  it("saveVersion auto-increments version number", () => {
    saveVersion("prd", "v1 content", "First", memoryDir);
    const second = saveVersion("prd", "v2 content", "Second", memoryDir);
    const third = saveVersion("prd", "v3 content", "Third", memoryDir);

    expect(second.version).toBe(2);
    expect(third.version).toBe(3);
  });

  it("loadVersion returns content for existing version", () => {
    saveVersion("architecture", "arch content", "Initial", memoryDir);

    const content = loadVersion("architecture", 1, memoryDir);
    expect(content).toBe("arch content");
  });

  it("loadVersion returns null for missing version", () => {
    const content = loadVersion("stories", 99, memoryDir);
    expect(content).toBeNull();
  });

  it("getCurrentVersion returns latest version", () => {
    saveVersion("viability", "v1", "First", memoryDir);
    saveVersion("viability", "v2", "Second", memoryDir);

    const current = getCurrentVersion("viability", memoryDir);
    expect(current).not.toBeNull();
    expect(current!.version).toBe(2);
    expect(current!.changeSummary).toBe("Second");
  });

  it("getCurrentVersion returns null when no versions exist", () => {
    const current = getCurrentVersion("prd", memoryDir);
    expect(current).toBeNull();
  });

  it("rollback writes content to prompts dir", () => {
    saveVersion("architecture", "original prompt", "v1", memoryDir);
    saveVersion("architecture", "updated prompt", "v2", memoryDir);

    rollback("architecture", 1, promptsDir, memoryDir);

    const target = path.join(promptsDir, "architecture", "system.md");
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toBe("original prompt");
  });

  it("rollback throws when version does not exist", () => {
    expect(() => rollback("stories", 42, promptsDir, memoryDir)).toThrow(
      'Version 42 not found for phase "stories"',
    );
  });

  it("listVersions returns all versions", () => {
    saveVersion("prd", "a", "First", memoryDir);
    saveVersion("prd", "b", "Second", memoryDir);
    saveVersion("prd", "c", "Third", memoryDir);

    const versions = listVersions("prd", memoryDir);
    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("listVersions returns empty array when no index exists", () => {
    const versions = listVersions("viability", memoryDir);
    expect(versions).toEqual([]);
  });
});
