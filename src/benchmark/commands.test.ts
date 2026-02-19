import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { registerBenchmarkCommands } from "./commands.js";

// Mock @clack/prompts to prevent interactive hangs
vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

describe("registerBenchmarkCommands", () => {
  let tmpDir: string;
  let fixturesDir: string;
  let suitesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-cmd-"));

    // Create suite
    suitesDir = path.join(tmpDir, "benchmarks", "suites");
    fs.mkdirSync(suitesDir, { recursive: true });
    fs.writeFileSync(
      path.join(suitesDir, "smoke.yaml"),
      `
id: smoke
name: Smoke Test
description: test suite
mode: dry-run
cases:
  - id: smoke-1
    label: Test
    idea: a simple todo app
    complexity: trivial
    stopAfter: PLANNING
`,
    );

    // Create fixtures
    fixturesDir = path.join(tmpDir, "benchmarks", "fixtures", "mock-responses");
    fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(path.join(fixturesDir, "viability-proceed.md"), "# Viability\n\n**PROCEED**\n");
    fs.writeFileSync(path.join(fixturesDir, "prd-basic.md"), "# PRD\nBasic PRD\n");
    fs.writeFileSync(path.join(fixturesDir, "architecture-basic.md"), "# Arch\nBasic Arch\n");
    fs.writeFileSync(path.join(fixturesDir, "stories-1-epic.md"), "# Stories\nEpic 1\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createProgram(): Command {
    const program = new Command();
    program.name("boop").exitOverride();
    registerBenchmarkCommands(program, tmpDir);
    return program;
  }

  it("registers the benchmark command group", () => {
    const program = createProgram();
    const benchCmd = program.commands.find((c) => c.name() === "benchmark");
    expect(benchCmd).toBeDefined();
  });

  it("registers run, list, and compare subcommands", () => {
    const program = createProgram();
    const benchCmd = program.commands.find((c) => c.name() === "benchmark")!;
    const subCommands = benchCmd.commands.map((c) => c.name());
    expect(subCommands).toContain("run");
    expect(subCommands).toContain("list");
    expect(subCommands).toContain("compare");
  });

  it("benchmark list shows available suites", async () => {
    const program = createProgram();
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));

    try {
      await program.parseAsync(["node", "boop", "benchmark", "list"]);
    } catch {
      // exitOverride may throw
    }

    console.log = origLog;

    const text = output.join("\n");
    expect(text).toContain("smoke");
  });

  it("benchmark run executes dry-run suite", async () => {
    const program = createProgram();
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));

    try {
      await program.parseAsync(["node", "boop", "benchmark", "run", "smoke", "--dry-run"]);
    } catch {
      // exitOverride may throw
    }

    console.log = origLog;

    const text = output.join("\n");
    expect(text).toContain("Smoke Test");
    expect(text).toContain("[PASS] smoke-1");
  });

  it("benchmark run --json outputs valid JSON", async () => {
    const program = createProgram();
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));

    try {
      await program.parseAsync(["node", "boop", "benchmark", "run", "smoke", "--dry-run", "--json"]);
    } catch {
      // exitOverride may throw
    }

    console.log = origLog;

    // Find the JSON output (will be the largest chunk)
    const jsonText = output.find((line) => line.startsWith("{"));
    expect(jsonText).toBeDefined();
    const parsed = JSON.parse(jsonText!);
    expect(parsed.suiteId).toBe("smoke");
  });

  it("benchmark run exits 1 for unknown suite", async () => {
    const program = createProgram();
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));

    try {
      await program.parseAsync(["node", "boop", "benchmark", "run", "nonexistent"]);
    } catch {
      // exitOverride may throw
    }

    console.error = origError;

    const text = errors.join("\n");
    expect(text).toContain('Suite "nonexistent" not found');
  });
});
