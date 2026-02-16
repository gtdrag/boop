import { describe, expect, it } from "vitest";
import { buildProgram } from "./program.js";

describe("CLI program", () => {
  it("creates a program with name boop", () => {
    const program = buildProgram();
    expect(program.name()).toBe("boop");
  });

  it("has expected subcommands", () => {
    const program = buildProgram();
    const commands = program.commands.map((cmd) => cmd.name());
    expect(commands).toContain("status");
    expect(commands).toContain("resume");
    expect(commands).toContain("review");
    expect(commands).toContain("profile");
  });
});
