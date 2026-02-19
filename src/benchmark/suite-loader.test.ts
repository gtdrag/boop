import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSuiteFromFile, loadSuiteByName, listAvailableSuites } from "./suite-loader.js";

describe("suite-loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-suite-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSuite(name: string, content: string): string {
    const filePath = path.join(tmpDir, `${name}.yaml`);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  const validSuite = `
id: test-suite
name: Test Suite
description: A test suite for validation
mode: dry-run
cases:
  - id: case-1
    label: Test Case
    idea: build a simple todo app
    complexity: trivial
    stopAfter: PLANNING
    expectations:
      - metric: success
        expected: true
`;

  describe("loadSuiteFromFile", () => {
    it("parses a valid suite YAML", () => {
      const filePath = writeSuite("valid", validSuite);
      const suite = loadSuiteFromFile(filePath);

      expect(suite.id).toBe("test-suite");
      expect(suite.name).toBe("Test Suite");
      expect(suite.mode).toBe("dry-run");
      expect(suite.cases).toHaveLength(1);
      expect(suite.cases[0]!.id).toBe("case-1");
      expect(suite.cases[0]!.complexity).toBe("trivial");
      expect(suite.cases[0]!.stopAfter).toBe("PLANNING");
      expect(suite.cases[0]!.expectations).toHaveLength(1);
    });

    it("throws for missing file", () => {
      expect(() => loadSuiteFromFile("/nonexistent/path.yaml")).toThrow("Suite file not found");
    });

    it("throws for missing id", () => {
      const filePath = writeSuite("no-id", `
name: No ID
description: test
mode: dry-run
cases:
  - id: c1
    label: test
    idea: test
    complexity: trivial
`);
      expect(() => loadSuiteFromFile(filePath)).toThrow('missing required field "id"');
    });

    it("throws for invalid mode", () => {
      const filePath = writeSuite("bad-mode", `
id: test
name: test
description: test
mode: invalid
cases:
  - id: c1
    label: test
    idea: test
    complexity: trivial
`);
      expect(() => loadSuiteFromFile(filePath)).toThrow('invalid "mode"');
    });

    it("throws for empty cases array", () => {
      const filePath = writeSuite("empty-cases", `
id: test
name: test
description: test
mode: dry-run
cases: []
`);
      expect(() => loadSuiteFromFile(filePath)).toThrow("at least one case");
    });

    it("throws for invalid complexity", () => {
      const filePath = writeSuite("bad-complexity", `
id: test
name: test
description: test
mode: dry-run
cases:
  - id: c1
    label: test
    idea: test
    complexity: extreme
`);
      expect(() => loadSuiteFromFile(filePath)).toThrow('invalid "complexity"');
    });

    it("throws for invalid stopAfter", () => {
      const filePath = writeSuite("bad-stop", `
id: test
name: test
description: test
mode: dry-run
cases:
  - id: c1
    label: test
    idea: test
    complexity: trivial
    stopAfter: INVALID
`);
      expect(() => loadSuiteFromFile(filePath)).toThrow('invalid "stopAfter"');
    });

    it("handles cases without optional fields", () => {
      const filePath = writeSuite("minimal", `
id: min
name: Minimal
description: minimal suite
mode: live
cases:
  - id: c1
    label: test
    idea: build something
    complexity: simple
`);
      const suite = loadSuiteFromFile(filePath);
      expect(suite.cases[0]!.stopAfter).toBeUndefined();
      expect(suite.cases[0]!.expectations).toBeUndefined();
    });
  });

  describe("loadSuiteByName", () => {
    it("loads a suite by name from a directory", () => {
      writeSuite("my-suite", validSuite);
      const suite = loadSuiteByName("my-suite", tmpDir);
      expect(suite.id).toBe("test-suite");
    });

    it("throws for unknown suite name", () => {
      expect(() => loadSuiteByName("nonexistent", tmpDir)).toThrow("Suite file not found");
    });
  });

  describe("listAvailableSuites", () => {
    it("lists all YAML files in the directory", () => {
      writeSuite("alpha", validSuite);
      writeSuite("beta", validSuite);

      const suites = listAvailableSuites(tmpDir);
      expect(suites).toHaveLength(2);
      expect(suites[0]!.name).toBe("alpha");
      expect(suites[1]!.name).toBe("beta");
    });

    it("returns empty array for nonexistent directory", () => {
      expect(listAvailableSuites("/nonexistent")).toEqual([]);
    });

    it("ignores non-YAML files", () => {
      writeSuite("valid", validSuite);
      fs.writeFileSync(path.join(tmpDir, "readme.txt"), "not a suite");

      const suites = listAvailableSuites(tmpDir);
      expect(suites).toHaveLength(1);
    });
  });
});
