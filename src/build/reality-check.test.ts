import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkFiles,
  checkDirectory,
  formatViolations,
  type RealityViolation,
} from "./reality-check.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-reality-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// checkFiles
// ---------------------------------------------------------------------------

describe("checkFiles", () => {
  it("passes for clean production code", () => {
    const file = writeFile(
      "clean.ts",
      `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
    );

    const result = checkFiles([file]);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("detects TODO markers", () => {
    const file = writeFile("todo.ts", "// TODO: implement this\n");

    const result = checkFiles([file]);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.kind).toBe("todo");
    expect(result.violations[0]!.line).toBe(1);
  });

  it("detects FIXME markers", () => {
    const file = writeFile("fixme.ts", "// FIXME: broken\nconst x = 1;\n");

    const result = checkFiles([file]);
    expect(result.passed).toBe(false);
    expect(result.violations[0]!.kind).toBe("todo");
  });

  it("detects HACK markers", () => {
    const file = writeFile("hack.ts", "// HACK: temporary workaround\n");

    const result = checkFiles([file]);
    expect(result.passed).toBe(false);
    expect(result.violations[0]!.kind).toBe("todo");
  });

  it("detects XXX markers", () => {
    const file = writeFile("xxx.ts", "const x = 1; // XXX\n");

    const result = checkFiles([file]);
    expect(result.passed).toBe(false);
    expect(result.violations[0]!.kind).toBe("todo");
  });

  it("detects stub implementations", () => {
    const file = writeFile(
      "stub.ts",
      `export function doStuff() {\n  throw new Error("not implemented");\n}\n`,
    );

    const result = checkFiles([file]);
    expect(result.passed).toBe(false);
    expect(result.violations[0]!.kind).toBe("stub");
  });

  it("detects placeholder strings", () => {
    const file = writeFile(
      "placeholder.ts",
      `const name = "placeholder";\n`,
    );

    const result = checkFiles([file]);
    expect(result.passed).toBe(false);
    expect(result.violations[0]!.kind).toBe("placeholder");
  });

  it("detects mock data strings", () => {
    const file = writeFile(
      "mock.ts",
      `const email = "test@example.com";\n`,
    );

    const result = checkFiles([file]);
    expect(result.passed).toBe(false);
    expect(result.violations[0]!.kind).toBe("mock-data");
  });

  it("detects John Doe mock names", () => {
    const file = writeFile("names.ts", `const user = "John Doe";\n`);

    const result = checkFiles([file]);
    expect(result.passed).toBe(false);
    expect(result.violations[0]!.kind).toBe("mock-data");
  });

  it("reports only the first violation per line", () => {
    const file = writeFile(
      "multi.ts",
      `// TODO: fix this placeholder value\n`,
    );

    const result = checkFiles([file]);
    expect(result.violations).toHaveLength(1);
  });

  it("reports multiple violations across different lines", () => {
    const file = writeFile(
      "many.ts",
      `// TODO: first\nconst x = 1;\n// FIXME: second\n`,
    );

    const result = checkFiles([file]);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]!.line).toBe(1);
    expect(result.violations[1]!.line).toBe(3);
  });

  it("skips test files", () => {
    const file = writeFile("thing.test.ts", `// TODO: test todo is fine\n`);

    const result = checkFiles([file]);
    expect(result.passed).toBe(true);
  });

  it("skips spec files", () => {
    const file = writeFile("thing.spec.ts", `// FIXME: spec fixme is fine\n`);

    const result = checkFiles([file]);
    expect(result.passed).toBe(true);
  });

  it("handles empty files", () => {
    const file = writeFile("empty.ts", "");

    const result = checkFiles([file]);
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkDirectory
// ---------------------------------------------------------------------------

describe("checkDirectory", () => {
  it("scans all ts files recursively", () => {
    writeFile("src/a.ts", "// TODO: a\n");
    writeFile("src/sub/b.ts", "// FIXME: b\n");

    const result = checkDirectory(path.join(tmpDir, "src"));
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("skips node_modules", () => {
    writeFile("src/node_modules/dep/index.ts", "// TODO: in dep\n");
    writeFile("src/clean.ts", "const x = 1;\n");

    const result = checkDirectory(path.join(tmpDir, "src"));
    expect(result.passed).toBe(true);
  });

  it("skips test directories", () => {
    writeFile("src/test/helper.ts", "// TODO: test helper\n");
    writeFile("src/clean.ts", "const x = 1;\n");

    const result = checkDirectory(path.join(tmpDir, "src"));
    expect(result.passed).toBe(true);
  });

  it("passes for a clean directory", () => {
    writeFile("src/index.ts", "export const VERSION = '1.0.0';\n");
    writeFile("src/util.ts", "export function noop() {}\n");

    const result = checkDirectory(path.join(tmpDir, "src"));
    expect(result.passed).toBe(true);
  });

  it("ignores non-ts/js files", () => {
    writeFile("src/README.md", "# TODO: write docs\n");
    writeFile("src/clean.ts", "const x = 1;\n");

    const result = checkDirectory(path.join(tmpDir, "src"));
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatViolations
// ---------------------------------------------------------------------------

describe("formatViolations", () => {
  it("returns success message for empty violations", () => {
    const msg = formatViolations([]);
    expect(msg).toContain("passed");
  });

  it("formats violations with file, line, kind, and text", () => {
    const violations: RealityViolation[] = [
      {
        file: "/project/src/foo.ts",
        line: 42,
        kind: "todo",
        text: "// TODO: fix later",
      },
    ];

    const msg = formatViolations(violations);
    expect(msg).toContain("FAILED");
    expect(msg).toContain("1 violation");
    expect(msg).toContain("/project/src/foo.ts:42");
    expect(msg).toContain("[todo]");
    expect(msg).toContain("// TODO: fix later");
  });

  it("formats multiple violations", () => {
    const violations: RealityViolation[] = [
      { file: "a.ts", line: 1, kind: "todo", text: "// TODO" },
      { file: "b.ts", line: 5, kind: "stub", text: 'throw new Error("stub")' },
    ];

    const msg = formatViolations(violations);
    expect(msg).toContain("2 violation(s)");
  });
});
