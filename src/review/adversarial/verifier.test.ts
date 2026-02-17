import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { verifyFindings } from "./verifier.js";
import type { AdversarialFinding } from "./runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeFinding(overrides: Partial<AdversarialFinding> = {}): AdversarialFinding {
  return {
    id: "cq-1",
    title: "Test finding",
    severity: "medium",
    source: "code-quality",
    description: "A test finding about `myFunction`",
    file: "src/foo.ts",
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verifier-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// verifyFindings
// ---------------------------------------------------------------------------

describe("verifyFindings", () => {
  it("keeps findings where file exists and content matches", () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "foo.ts"), "export function myFunction() { return 42; }");

    const result = verifyFindings(tmpDir, [
      makeFinding({
        description: "The function `myFunction` has no null check",
      }),
    ]);

    expect(result.verified).toHaveLength(1);
    expect(result.discarded).toHaveLength(0);
    expect(result.stats.verified).toBe(1);
  });

  it("discards findings where file does not exist", () => {
    const result = verifyFindings(tmpDir, [makeFinding({ file: "src/nonexistent.ts" })]);

    expect(result.verified).toHaveLength(0);
    expect(result.discarded).toHaveLength(1);
    expect(result.discarded[0]!.reason).toContain("does not exist");
  });

  it("discards findings where content does not match description", () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "foo.ts"), "export function something() { return 42; }");

    const result = verifyFindings(tmpDir, [
      makeFinding({
        title: "Missing `phantomFunction` validation",
        description: "The function `phantomFunction` does not validate input",
      }),
    ]);

    expect(result.verified).toHaveLength(0);
    expect(result.discarded).toHaveLength(1);
    expect(result.discarded[0]!.reason).toContain("None of the key terms");
  });

  it("keeps findings with no file path", () => {
    const result = verifyFindings(tmpDir, [makeFinding({ file: undefined })]);

    expect(result.verified).toHaveLength(1);
    expect(result.discarded).toHaveLength(0);
  });

  it("keeps findings when no key terms can be extracted", () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "foo.ts"), "const x = 1;");

    const result = verifyFindings(tmpDir, [
      makeFinding({
        title: "General issue",
        description: "The code has a problem with error handling in general",
      }),
    ]);

    expect(result.verified).toHaveLength(1);
  });

  it("verifies multiple findings independently", () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "real.ts"), "export function realFunction() {}");

    const result = verifyFindings(tmpDir, [
      makeFinding({
        id: "cq-1",
        file: "src/real.ts",
        description: "The function `realFunction` is empty",
      }),
      makeFinding({
        id: "cq-2",
        file: "src/fake.ts",
        description: "The function `fakeFunction` is broken",
      }),
      makeFinding({
        id: "cq-3",
        file: undefined,
        description: "General finding without file",
      }),
    ]);

    expect(result.verified).toHaveLength(2); // real.ts + no-file
    expect(result.discarded).toHaveLength(1); // fake.ts
    expect(result.stats.total).toBe(3);
  });

  it("extracts key terms from backtick-wrapped identifiers", () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "foo.ts"), "const sanitizeInput = (x: string) => x.trim();");

    const result = verifyFindings(tmpDir, [
      makeFinding({
        description: "The `sanitizeInput` function does not handle null",
      }),
    ]);

    expect(result.verified).toHaveLength(1);
  });

  it("extracts key terms from quoted strings", () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "foo.ts"), "export class UserService { getUser() {} }");

    const result = verifyFindings(tmpDir, [
      makeFinding({
        description: 'The "UserService" class does not validate input',
      }),
    ]);

    expect(result.verified).toHaveLength(1);
  });

  it("reports correct stats", () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "a.ts"), "const a = 1;");

    const result = verifyFindings(tmpDir, [
      makeFinding({ id: "1", file: "src/a.ts", title: "x", description: "issue with const `a`" }),
      makeFinding({ id: "2", file: "src/b.ts", description: "file does not exist" }),
      makeFinding({
        id: "3",
        file: "src/a.ts",
        title: "`phantom`",
        description: "phantom `phantom` issue",
      }),
    ]);

    expect(result.stats.total).toBe(3);
    expect(result.stats.verified).toBe(1);
    expect(result.stats.discarded).toBe(2);
  });
});
