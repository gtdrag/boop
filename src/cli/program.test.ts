import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram, handleCli } from "./program.js";
import type { CliOptions } from "./program.js";

// Use vi.hoisted for mock fns that need to survive resetAllMocks
const { mockAssessViability } = vi.hoisted(() => ({
  mockAssessViability: vi.fn(),
}));

// Mock the config module to avoid real interactive prompts
vi.mock("../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/index.js")>();
  return {
    ...actual,
    runOnboarding: vi.fn().mockResolvedValue(undefined),
    editProfile: vi.fn().mockResolvedValue(undefined),
    loadProfileFromDisk: vi.fn().mockReturnValue(undefined),
  };
});

// Mock the viability module to avoid real API calls
vi.mock("../planning/viability.js", () => ({
  assessViability: mockAssessViability,
}));

// Mock @clack/prompts to avoid interactive prompts hanging tests
vi.mock("@clack/prompts", () => ({
  confirm: vi.fn().mockResolvedValue(true),
  text: vi.fn().mockResolvedValue("test idea"),
  select: vi.fn().mockResolvedValue("proceed"),
  isCancel: vi.fn().mockReturnValue(false),
}));

describe("CLI program", () => {
  it("creates a program with name boop", () => {
    const program = buildProgram();
    expect(program.name()).toBe("boop");
  });

  it("has expected options", () => {
    const program = buildProgram();
    const optionFlags = program.options.map((o) => o.long);
    expect(optionFlags).toContain("--profile");
    expect(optionFlags).toContain("--status");
    expect(optionFlags).toContain("--review");
    expect(optionFlags).toContain("--resume");
    expect(optionFlags).toContain("--autonomous");
  });

  it("accepts an optional idea argument", () => {
    const program = buildProgram();
    const args = program.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0]!.name()).toBe("idea");
    expect(args[0]!.required).toBe(false);
  });
});

describe("handleCli", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-cli-test-"));
    // Reset mock implementations and call history
    const config = await import("../config/index.js");
    (config.runOnboarding as ReturnType<typeof vi.fn>).mockClear();
    (config.editProfile as ReturnType<typeof vi.fn>).mockClear();
    (config.loadProfileFromDisk as ReturnType<typeof vi.fn>).mockClear();
    (config.runOnboarding as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (config.editProfile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (config.loadProfileFromDisk as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    // Reset viability mock with default return value
    mockAssessViability.mockReset();
    mockAssessViability.mockResolvedValue({
      idea: "test",
      assessment: "## Viability Assessment\n**PROCEED**",
      recommendation: "PROCEED",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("logs pipeline start when idea is provided", async () => {
    // Pre-create profile so onboarding doesn't trigger
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "profile.yaml"), "name: test\n");
    const { loadProfileFromDisk } = await import("../config/index.js");
    (loadProfileFromDisk as ReturnType<typeof vi.fn>).mockReturnValue({ name: "test" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli("build a todo app", {}, undefined, configDir);
    expect(spy).toHaveBeenCalledWith('[boop] Starting pipeline with idea: "build a todo app"');
    spy.mockRestore();
  });

  it("logs autonomous mode when --autonomous is set with idea", async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "profile.yaml"), "name: test\n");
    const { loadProfileFromDisk } = await import("../config/index.js");
    (loadProfileFromDisk as ReturnType<typeof vi.fn>).mockReturnValue({ name: "test" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli("build a todo app", { autonomous: true }, undefined, configDir);
    expect(spy).toHaveBeenCalledWith('[boop] Starting pipeline with idea: "build a todo app"');
    expect(spy).toHaveBeenCalledWith("[boop] Running in autonomous mode.");
    spy.mockRestore();
  });

  it("handles --profile flag by calling runOnboarding when no profile exists", async () => {
    const { runOnboarding } = await import("../config/index.js");
    await handleCli(undefined, { profile: true }, undefined, configDir);
    expect(runOnboarding).toHaveBeenCalled();
  });

  it("handles --profile flag by calling editProfile when profile exists", async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "profile.yaml"), "name: test\n");
    const { editProfile } = await import("../config/index.js");
    await handleCli(undefined, { profile: true }, undefined, configDir);
    expect(editProfile).toHaveBeenCalled();
  });

  it("handles --status flag", async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "profile.yaml"), "name: test\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(undefined, { status: true }, "/tmp/boop-test-nonexistent", configDir);
    expect(spy).toHaveBeenCalledWith("No active pipeline. Run 'boop <idea>' to start.");
    spy.mockRestore();
  });

  it("handles --review flag", async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "profile.yaml"), "name: test\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(undefined, { review: true }, undefined, configDir);
    expect(spy).toHaveBeenCalledWith("[boop] Review phase — not yet implemented.");
    spy.mockRestore();
  });

  it("handles --resume flag with no active pipeline", async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "profile.yaml"), "name: test\n");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(undefined, { resume: true }, "/tmp/boop-test-nonexistent", configDir);
    expect(spy).toHaveBeenCalledWith("No interrupted pipeline to resume.");
    spy.mockRestore();
  });

  it("flags are checked in priority order: profile > status > review > resume", async () => {
    const { runOnboarding } = await import("../config/index.js");
    const opts: CliOptions = {
      profile: true,
      status: true,
      review: true,
      resume: true,
    };
    await handleCli(undefined, opts, undefined, configDir);
    // profile takes priority — triggers onboarding since no profile exists
    expect(runOnboarding).toHaveBeenCalled();
  });

  it("triggers onboarding when profile.yaml does not exist", async () => {
    const { runOnboarding } = await import("../config/index.js");
    await handleCli("test idea", {}, undefined, configDir);
    expect(runOnboarding).toHaveBeenCalled();
  });

  it("skips onboarding when profile.yaml exists", async () => {
    // Pre-create profile
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "profile.yaml"), "name: test\n");
    const { runOnboarding } = await import("../config/index.js");
    await handleCli("test idea", {}, undefined, configDir);
    expect(runOnboarding).not.toHaveBeenCalled();
  });

  it("refuses to start pipeline when no profile is loaded", async () => {
    // Profile.yaml exists (so onboarding is skipped) but loadProfileFromDisk returns undefined
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "profile.yaml"), "name: test\n");
    const { loadProfileFromDisk } = await import("../config/index.js");
    (loadProfileFromDisk as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli("test idea", {}, undefined, configDir);
    expect(spy).toHaveBeenCalledWith(
      "[boop] No developer profile found. Please run onboarding first.",
    );
    spy.mockRestore();
  });

  it("starts pipeline when profile is loaded", async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "profile.yaml"), "name: test\n");
    const { loadProfileFromDisk } = await import("../config/index.js");
    (loadProfileFromDisk as ReturnType<typeof vi.fn>).mockReturnValue({ name: "Alice" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli("my app", {}, undefined, configDir);
    expect(spy).toHaveBeenCalledWith('[boop] Starting pipeline with idea: "my app"');
    spy.mockRestore();
  });
});
