/**
 * Tests for gauntlet CLI commands.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerGauntletCommands } from "./commands.js";

// Mock @clack/prompts to prevent interactive prompt hangs
vi.mock("@clack/prompts", () => ({
  select: vi.fn().mockResolvedValue("approve"),
  isCancel: vi.fn().mockReturnValue(false),
}));

describe("commands", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-cmd-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers gauntlet command with subcommands", () => {
    const program = new Command();
    registerGauntletCommands(program, tmpDir);

    const gauntlet = program.commands.find((c) => c.name() === "gauntlet");
    expect(gauntlet).toBeDefined();

    const subcommands = gauntlet!.commands.map((c) => c.name());
    expect(subcommands).toContain("run");
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("report");
    expect(subcommands).toContain("diff");
  });

  it("run command has expected options", () => {
    const program = new Command();
    registerGauntletCommands(program, tmpDir);

    const gauntlet = program.commands.find((c) => c.name() === "gauntlet");
    const run = gauntlet!.commands.find((c) => c.name() === "run");
    expect(run).toBeDefined();

    const optionNames = run!.options.map((o) => o.long);
    expect(optionNames).toContain("--tier");
    expect(optionNames).toContain("--start");
    expect(optionNames).toContain("--workspace");
    expect(optionNames).toContain("--no-approve");
  });

  it("list command has --runs option", () => {
    const program = new Command();
    registerGauntletCommands(program, tmpDir);

    const gauntlet = program.commands.find((c) => c.name() === "gauntlet");
    const list = gauntlet!.commands.find((c) => c.name() === "list");
    expect(list).toBeDefined();

    const optionNames = list!.options.map((o) => o.long);
    expect(optionNames).toContain("--runs");
  });

  it("report command requires runId argument", () => {
    const program = new Command();
    registerGauntletCommands(program, tmpDir);

    const gauntlet = program.commands.find((c) => c.name() === "gauntlet");
    const report = gauntlet!.commands.find((c) => c.name() === "report");
    expect(report).toBeDefined();
    expect(report!.registeredArguments.length).toBe(1);
    expect(report!.registeredArguments[0]!.required).toBe(true);
  });

  it("diff command requires runId argument", () => {
    const program = new Command();
    registerGauntletCommands(program, tmpDir);

    const gauntlet = program.commands.find((c) => c.name() === "gauntlet");
    const diff = gauntlet!.commands.find((c) => c.name() === "diff");
    expect(diff).toBeDefined();
    expect(diff!.registeredArguments.length).toBe(1);
    expect(diff!.registeredArguments[0]!.required).toBe(true);
  });
});
