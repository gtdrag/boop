import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRunAdversarialAgents, mockExecFileAsync } = vi.hoisted(() => ({
  mockRunAdversarialAgents: vi.fn(),
  mockExecFileAsync: vi.fn(),
}));

vi.mock("../review/adversarial/runner.js", () => ({
  runAdversarialAgents: mockRunAdversarialAgents,
}));

vi.mock("../review/adversarial/review-rules.js", () => ({
  loadReviewRules: () => [],
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: vi.fn(() => mockExecFileAsync),
}));

import { scanCodebase, analyzeCodebase } from "./analyzer.js";
import type { AdversarialAgentResult } from "../review/adversarial/runner.js";

describe("analyzer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-analyzer-test-"));
    mockRunAdversarialAgents.mockReset();
    mockExecFileAsync.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("scanCodebase", () => {
    it("counts files and lines from git ls-files", async () => {
      // Create some test files
      fs.writeFileSync(path.join(tmpDir, "index.ts"), "const x = 1;\nconst y = 2;\n");
      fs.writeFileSync(path.join(tmpDir, "utils.ts"), "export function foo() {}\n");
      fs.writeFileSync(path.join(tmpDir, "README.md"), "# Hello\n");

      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: "index.ts\nutils.ts\nREADME.md\n" });

      const snapshot = await scanCodebase(tmpDir);

      expect(snapshot.totalFiles).toBe(3);
      expect(snapshot.languageBreakdown[".ts"]).toBe(2);
      expect(snapshot.languageBreakdown[".md"]).toBe(1);
      expect(snapshot.totalLines).toBe(5); // 3 + 2 lines in .ts files
    });

    it("detects test files", async () => {
      mockExecFileAsync.mockResolvedValueOnce({ stdout: "foo.test.ts\nbar.ts\n" });

      const snapshot = await scanCodebase(tmpDir);
      expect(snapshot.hasTests).toBe(true);
    });

    it("detects tsconfig", async () => {
      mockExecFileAsync.mockResolvedValueOnce({ stdout: "tsconfig.json\nsrc/app.ts\n" });

      const snapshot = await scanCodebase(tmpDir);
      expect(snapshot.hasTypecheck).toBe(true);
    });

    it("counts dependencies from package.json", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          dependencies: { express: "^4.0.0", react: "^18.0.0" },
          devDependencies: { vitest: "^1.0.0" },
        }),
      );

      mockExecFileAsync.mockResolvedValueOnce({ stdout: "package.json\n" });

      const snapshot = await scanCodebase(tmpDir);
      expect(snapshot.dependencyCount).toBe(3);
    });

    it("handles empty git output gracefully", async () => {
      mockExecFileAsync.mockRejectedValueOnce(new Error("not a git repo"));

      const snapshot = await scanCodebase(tmpDir);
      expect(snapshot.totalFiles).toBe(0);
      expect(snapshot.totalLines).toBe(0);
    });
  });

  describe("analyzeCodebase", () => {
    const mockAgentResults: AdversarialAgentResult[] = [
      {
        agent: "code-quality",
        findings: [
          {
            id: "cod-1",
            source: "code-quality",
            title: "Missing null check",
            severity: "high",
            description: "Potential crash on null",
            file: "src/app.ts",
          },
        ],
        report: "Found 1 issue",
        success: true,
      },
    ];

    beforeEach(() => {
      // Mock scan: git ls-files (called twice: once for scan, once for source files)
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: "src/app.ts\npackage.json\n" })
        .mockResolvedValueOnce({ stdout: "src/app.ts\n" });

      // Create file so verifier can check it
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "app.ts"), "const x = null;\n");

      mockRunAdversarialAgents.mockResolvedValue(mockAgentResults);
    });

    it("runs adversarial agents with files override", async () => {
      await analyzeCodebase(tmpDir);

      expect(mockRunAdversarialAgents).toHaveBeenCalledWith(
        expect.objectContaining({
          files: ["src/app.ts"],
          agents: ["code-quality", "test-coverage", "security"],
        }),
      );
    });

    it("returns verified findings", async () => {
      const result = await analyzeCodebase(tmpDir);

      expect(result.snapshot.totalFiles).toBe(2);
      expect(result.agentResults).toEqual(mockAgentResults);
      expect(result.verifiedFindings).toHaveLength(1);
    });

    it("filters agents based on focus", async () => {
      await analyzeCodebase(tmpDir, { focus: "security" });

      expect(mockRunAdversarialAgents).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: ["security"],
        }),
      );
    });

    it("quality focus runs code-quality agent only", async () => {
      await analyzeCodebase(tmpDir, { focus: "quality" });

      expect(mockRunAdversarialAgents).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: ["code-quality"],
        }),
      );
    });

    it("tests focus runs test-coverage agent only", async () => {
      await analyzeCodebase(tmpDir, { focus: "tests" });

      expect(mockRunAdversarialAgents).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: ["test-coverage"],
        }),
      );
    });

    it("calls onProgress callback", async () => {
      const events: string[] = [];
      await analyzeCodebase(tmpDir, {
        onProgress: (phase, msg) => events.push(`${phase}: ${msg}`),
      });

      expect(events.some((e) => e.startsWith("scan:"))).toBe(true);
      expect(events.some((e) => e.startsWith("review:"))).toBe(true);
      expect(events.some((e) => e.startsWith("verify:"))).toBe(true);
    });
  });
});
