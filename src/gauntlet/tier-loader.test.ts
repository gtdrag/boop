/**
 * Tests for gauntlet tier loader.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadGauntletDefinition,
  loadGauntletByName,
  listAvailableGauntlets,
  resolveGauntletDir,
} from "./tier-loader.js";

describe("tier-loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-loader-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const validYaml = `
id: test-gauntlet
name: Test Gauntlet
description: A test gauntlet.
tiers:
  - id: t1-test
    label: "T1: Test"
    level: 1
    idea: Build a simple app
    stack: React
    rationale: Basic test
    successCriteria:
      minPhaseReached: PLANNING
      planningMustPass: true
`;

  // --- resolveGauntletDir ---
  it("resolves gauntlet directory from project root", () => {
    const result = resolveGauntletDir("/my/project");
    expect(result).toBe(path.join("/my/project", "benchmarks", "gauntlet"));
  });

  // --- loadGauntletDefinition ---
  it("loads and validates a gauntlet definition from YAML", () => {
    const filePath = path.join(tmpDir, "test.yaml");
    fs.writeFileSync(filePath, validYaml, "utf-8");

    const def = loadGauntletDefinition(filePath);
    expect(def.id).toBe("test-gauntlet");
    expect(def.name).toBe("Test Gauntlet");
    expect(def.tiers).toHaveLength(1);
    expect(def.tiers[0]!.id).toBe("t1-test");
    expect(def.tiers[0]!.level).toBe(1);
    expect(def.tiers[0]!.successCriteria.minPhaseReached).toBe("PLANNING");
    expect(def.tiers[0]!.successCriteria.planningMustPass).toBe(true);
  });

  it("throws if file does not exist", () => {
    expect(() => loadGauntletDefinition("/nope/nope.yaml")).toThrow("not found");
  });

  it("throws if id is missing", () => {
    const filePath = path.join(tmpDir, "bad.yaml");
    fs.writeFileSync(filePath, "name: X\ndescription: Y\ntiers:\n  - id: t1\n", "utf-8");
    expect(() => loadGauntletDefinition(filePath)).toThrow("id");
  });

  it("throws if tiers is empty", () => {
    const filePath = path.join(tmpDir, "bad.yaml");
    fs.writeFileSync(filePath, "id: x\nname: X\ndescription: Y\ntiers: []\n", "utf-8");
    expect(() => loadGauntletDefinition(filePath)).toThrow("at least one tier");
  });

  it("throws if tier level is out of range", () => {
    const yaml = validYaml.replace("level: 1", "level: 0");
    const filePath = path.join(tmpDir, "bad.yaml");
    fs.writeFileSync(filePath, yaml, "utf-8");
    expect(() => loadGauntletDefinition(filePath)).toThrow("level");
  });

  it("throws if minPhaseReached is invalid", () => {
    const yaml = validYaml.replace("minPhaseReached: PLANNING", "minPhaseReached: INVALID");
    const filePath = path.join(tmpDir, "bad.yaml");
    fs.writeFileSync(filePath, yaml, "utf-8");
    expect(() => loadGauntletDefinition(filePath)).toThrow("not a valid pipeline phase");
  });

  it("parses profileOverrides when present", () => {
    const yaml =
      validYaml +
      "    profileOverrides:\n      frontendFramework: next\n      database: postgresql\n";
    const filePath = path.join(tmpDir, "overrides.yaml");
    fs.writeFileSync(filePath, yaml, "utf-8");

    const def = loadGauntletDefinition(filePath);
    expect(def.tiers[0]!.profileOverrides).toEqual({
      frontendFramework: "next",
      database: "postgresql",
    });
  });

  // --- loadGauntletByName ---
  it("loads a gauntlet by name from directory", () => {
    const gauntletDir = path.join(tmpDir, "gauntlets");
    fs.mkdirSync(gauntletDir, { recursive: true });
    fs.writeFileSync(path.join(gauntletDir, "my-test.yaml"), validYaml, "utf-8");

    const def = loadGauntletByName("my-test", gauntletDir);
    expect(def.id).toBe("test-gauntlet");
  });

  // --- listAvailableGauntlets ---
  it("lists available gauntlets in a directory", () => {
    const gauntletDir = path.join(tmpDir, "gauntlets");
    fs.mkdirSync(gauntletDir, { recursive: true });
    fs.writeFileSync(path.join(gauntletDir, "alpha.yaml"), validYaml, "utf-8");
    fs.writeFileSync(path.join(gauntletDir, "beta.yml"), validYaml, "utf-8");
    fs.writeFileSync(path.join(gauntletDir, "readme.txt"), "ignored", "utf-8");

    const list = listAvailableGauntlets(gauntletDir);
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe("alpha");
    expect(list[1]!.name).toBe("beta");
  });

  it("returns empty array if directory does not exist", () => {
    const list = listAvailableGauntlets("/nonexistent/path");
    expect(list).toEqual([]);
  });
});
