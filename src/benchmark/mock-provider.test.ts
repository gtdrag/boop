import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estimateTokens, loadFixture, createMockSendMessage, resolveFixturesDir } from "./mock-provider.js";

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 characters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("loadFixture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-mock-"));
    fs.writeFileSync(path.join(tmpDir, "viability-proceed.md"), "# Viability\n\n**PROCEED**\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads a fixture file for a known phase", () => {
    const text = loadFixture("viability", tmpDir);
    expect(text).toContain("**PROCEED**");
  });

  it("throws for missing fixture", () => {
    expect(() => loadFixture("prd", tmpDir)).toThrow("Mock fixture not found");
  });
});

describe("createMockSendMessage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-mock-"));
    fs.writeFileSync(path.join(tmpDir, "viability-proceed.md"), "# Viability\n\n**PROCEED**\n");
    fs.writeFileSync(path.join(tmpDir, "prd-basic.md"), "# PRD\nBasic PRD content\n");
    fs.writeFileSync(path.join(tmpDir, "architecture-basic.md"), "# Architecture\nBasic arch\n");
    fs.writeFileSync(path.join(tmpDir, "stories-1-epic.md"), "# Stories\n## Epic 1\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a ClaudeResponse-shaped object", () => {
    const mock = createMockSendMessage(tmpDir);
    const response = mock("viability");

    expect(response.text).toContain("**PROCEED**");
    expect(response.model).toBe("mock-dry-run");
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.usage.outputTokens).toBeGreaterThan(0);
  });

  it("caches loaded fixtures", () => {
    const mock = createMockSendMessage(tmpDir);

    const r1 = mock("viability");
    const r2 = mock("viability");
    expect(r1.text).toBe(r2.text);
  });

  it("returns different fixtures per phase", () => {
    const mock = createMockSendMessage(tmpDir);

    const v = mock("viability");
    const p = mock("prd");
    expect(v.text).not.toBe(p.text);
  });
});

describe("resolveFixturesDir", () => {
  it("returns the expected path", () => {
    const result = resolveFixturesDir("/my/project");
    expect(result).toBe(path.join("/my/project", "benchmarks", "fixtures", "mock-responses"));
  });
});
