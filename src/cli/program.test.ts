import { describe, expect, it, vi } from "vitest";
import { buildProgram, handleCli } from "./program.js";
import type { CliOptions } from "./program.js";

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
  it("logs pipeline start when idea is provided", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli("build a todo app", {});
    expect(spy).toHaveBeenCalledWith(
      '[boop] Starting pipeline with idea: "build a todo app"',
    );
    spy.mockRestore();
  });

  it("logs autonomous mode when --autonomous is set with idea", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli("build a todo app", { autonomous: true });
    expect(spy).toHaveBeenCalledWith(
      '[boop] Starting pipeline with idea: "build a todo app"',
    );
    expect(spy).toHaveBeenCalledWith("[boop] Running in autonomous mode.");
    spy.mockRestore();
  });

  it("handles --profile flag", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(undefined, { profile: true });
    expect(spy).toHaveBeenCalledWith(
      "[boop] Profile management — not yet implemented.",
    );
    spy.mockRestore();
  });

  it("handles --status flag", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(undefined, { status: true }, "/tmp/boop-test-nonexistent");
    expect(spy).toHaveBeenCalledWith(
      "No active pipeline. Run 'boop <idea>' to start.",
    );
    spy.mockRestore();
  });

  it("handles --review flag", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(undefined, { review: true });
    expect(spy).toHaveBeenCalledWith(
      "[boop] Review phase — not yet implemented.",
    );
    spy.mockRestore();
  });

  it("handles --resume flag with no active pipeline", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleCli(undefined, { resume: true }, "/tmp/boop-test-nonexistent");
    expect(spy).toHaveBeenCalledWith(
      "No interrupted pipeline to resume.",
    );
    spy.mockRestore();
  });

  it("flags are checked in priority order: profile > status > review > resume", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const opts: CliOptions = {
      profile: true,
      status: true,
      review: true,
      resume: true,
    };
    await handleCli(undefined, opts);
    // profile takes priority
    expect(spy).toHaveBeenCalledWith(
      "[boop] Profile management — not yet implemented.",
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
