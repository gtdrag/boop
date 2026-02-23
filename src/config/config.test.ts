import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initGlobalConfig,
  loadProfileFromDisk,
  resolveHomeDir,
  resolveProfilePath,
  resolveStateDir,
} from "./index.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "boop-config-test-"));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("resolveHomeDir", () => {
  const original = process.env.BOOP_HOME;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BOOP_HOME;
    } else {
      process.env.BOOP_HOME = original;
    }
  });

  it("returns os.homedir() by default", () => {
    delete process.env.BOOP_HOME;
    expect(resolveHomeDir()).toBe(os.homedir());
  });

  it("returns BOOP_HOME override when set", () => {
    process.env.BOOP_HOME = "/tmp/custom-home";
    expect(resolveHomeDir()).toBe("/tmp/custom-home");
  });
});

describe("resolveStateDir", () => {
  it("returns ~/.boop by default", () => {
    const dir = resolveStateDir({} as NodeJS.ProcessEnv);
    expect(dir).toBe(path.join(os.homedir(), ".boop"));
  });

  it("respects BOOP_STATE_DIR override", () => {
    const dir = resolveStateDir({
      BOOP_STATE_DIR: "/tmp/custom-state",
    } as NodeJS.ProcessEnv);
    expect(dir).toBe("/tmp/custom-state");
  });
});

describe("resolveProfilePath", () => {
  it("returns profile.yaml inside state dir", () => {
    expect(resolveProfilePath("/tmp/test")).toBe("/tmp/test/profile.yaml");
  });
});

describe("initGlobalConfig", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmrf(tmpDir);
  });

  it("creates ~/.boop/ with logs/ and credentials/ subdirectories", () => {
    tmpDir = path.join(makeTmpDir(), ".boop");
    const result = initGlobalConfig(tmpDir);

    expect(result.created).toBe(true);
    expect(result.stateDir).toBe(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, "logs"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "credentials"))).toBe(true);
  });

  it("sets credentials directory to owner-only permissions", () => {
    tmpDir = path.join(makeTmpDir(), ".boop");
    initGlobalConfig(tmpDir);

    const credDir = path.join(tmpDir, "credentials");
    const stats = fs.statSync(credDir);
    // 0o700 = owner rwx only (dir needs execute for traversal)
    expect(stats.mode & 0o777).toBe(0o700);
  });

  it("reports needsOnboarding when profile.yaml does not exist", () => {
    tmpDir = path.join(makeTmpDir(), ".boop");
    const result = initGlobalConfig(tmpDir);
    expect(result.needsOnboarding).toBe(true);
  });

  it("reports no onboarding needed when profile.yaml exists", () => {
    tmpDir = path.join(makeTmpDir(), ".boop");
    // Pre-create the dir and profile
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "profile.yaml"), "name: test\n");

    const result = initGlobalConfig(tmpDir);
    expect(result.created).toBe(false);
    expect(result.needsOnboarding).toBe(false);
  });

  it("is idempotent — calling twice does not error", () => {
    tmpDir = path.join(makeTmpDir(), ".boop");
    initGlobalConfig(tmpDir);
    const result = initGlobalConfig(tmpDir);
    expect(result.created).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "logs"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "credentials"))).toBe(true);
  });
});

describe("loadProfileFromDisk", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmrf(tmpDir);
  });

  it("returns undefined when no profile.yaml exists", () => {
    tmpDir = makeTmpDir();
    expect(loadProfileFromDisk(tmpDir)).toBeUndefined();
  });

  it("loads a valid YAML profile from disk", () => {
    tmpDir = makeTmpDir();
    const yaml = [
      "name: Alice",
      "languages:",
      "  - typescript",
      "  - python",
      "frontendFramework: next",
      "backendFramework: express",
      "database: postgresql",
      "cloudProvider: vercel",
      "styling: tailwind",
      "stateManagement: zustand",
      "analytics: posthog",
      "ciCd: github-actions",
      "packageManager: pnpm",
      "testRunner: vitest",
      "linter: oxlint",
      "projectStructure: monorepo",
      "aiModel: claude-opus-4-6",
      "autonomousByDefault: false",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "profile.yaml"), yaml, "utf-8");

    const profile = loadProfileFromDisk(tmpDir);
    expect(profile).toBeDefined();
    expect(profile!.name).toBe("Alice");
    expect(profile!.frontendFramework).toBe("next");
    expect(profile!.languages).toEqual(["typescript", "python"]);
    expect(profile!.autonomousByDefault).toBe(false);
  });

  it("returns undefined for a non-existent directory", () => {
    expect(loadProfileFromDisk("/tmp/nonexistent-boop-dir-12345")).toBeUndefined();
  });
});
