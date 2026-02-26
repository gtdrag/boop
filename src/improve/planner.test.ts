import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));

vi.mock("../shared/claude-client.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: () => false,
}));

vi.mock("../shared/retry.js", () => ({
  retry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { generateImprovementPrd } from "./planner.js";
import type { AdversarialFinding } from "../review/adversarial/runner.js";
import type { CodebaseSnapshot } from "./analyzer.js";
import type { DeveloperProfile } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_PROFILE: DeveloperProfile = {
  name: "Test Dev",
  languages: ["typescript"],
  frontendFramework: "next",
  backendFramework: "express",
  database: "postgresql",
  cloudProvider: "vercel",
  styling: "tailwind",
  stateManagement: "zustand",
  analytics: "posthog",
  ciCd: "github-actions",
  sourceControl: "github",
  packageManager: "pnpm",
  testRunner: "vitest",
  linter: "oxlint",
  projectStructure: "monorepo",
  aiModel: "claude-opus-4-6",
  autonomousByDefault: false,
};

const SNAPSHOT: CodebaseSnapshot = {
  totalFiles: 50,
  languageBreakdown: { ".ts": 40, ".json": 10 },
  totalLines: 5000,
  hasTests: true,
  hasTypecheck: true,
  dependencyCount: 20,
  fileTree: "  src/app.ts\n  src/utils.ts",
};

const FINDINGS: AdversarialFinding[] = [
  {
    id: "cod-1",
    source: "code-quality",
    title: "Missing null check in parser",
    severity: "high",
    description: "parser.ts line 42 does not check for null",
    file: "src/parser.ts",
  },
  {
    id: "sec-1",
    source: "security",
    title: "Command injection via user input",
    severity: "critical",
    description: "User input passed directly to execSync",
    file: "src/runner.ts",
  },
];

function mockPrdResponse(cycleNumber = 1) {
  return {
    text: JSON.stringify({
      project: "test-project",
      branchName: `improve/cycle-${cycleNumber}`,
      description: `Improvement cycle ${cycleNumber}`,
      userStories: [
        {
          id: `imp-${cycleNumber}.1`,
          title: "Fix command injection vulnerability",
          description: "As a developer, I want input sanitization so that command injection is prevented",
          acceptanceCriteria: ["execSync uses escaped input", "Test covers injection attempt"],
          priority: 1,
          passes: false,
          notes: "Related findings: sec-1",
        },
        {
          id: `imp-${cycleNumber}.2`,
          title: "Add null check to parser",
          description: "As a developer, I want null safety so that the parser doesn't crash",
          acceptanceCriteria: ["parser.ts handles null input", "Test covers null case"],
          priority: 2,
          passes: false,
          notes: "Related findings: cod-1",
        },
      ],
    }),
    usage: { inputTokens: 100, outputTokens: 200 },
    model: "claude-sonnet-4-5-20250929",
  };
}

describe("planner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-planner-test-"));
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue(mockPrdResponse());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates a valid PRD from findings", async () => {
    const result = await generateImprovementPrd(tmpDir, FINDINGS, SNAPSHOT, TEST_PROFILE);

    expect(result.prd.userStories).toHaveLength(2);
    expect(result.prd.branchName).toBe("improve/cycle-1");
    expect(result.prd.userStories[0]!.id).toBe("imp-1.1");
    expect(result.prd.userStories[1]!.id).toBe("imp-1.2");
  });

  it("saves prd.json to .boop directory", async () => {
    await generateImprovementPrd(tmpDir, FINDINGS, SNAPSHOT, TEST_PROFILE);

    const prdPath = path.join(tmpDir, ".boop", "prd.json");
    expect(fs.existsSync(prdPath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(prdPath, "utf-8"));
    expect(saved.userStories).toHaveLength(2);
  });

  it("uses correct cycle number in story IDs", async () => {
    mockSendMessage.mockResolvedValue(mockPrdResponse(3));

    const result = await generateImprovementPrd(tmpDir, FINDINGS, SNAPSHOT, TEST_PROFILE, {
      cycleNumber: 3,
    });

    expect(result.prd.userStories[0]!.id).toBe("imp-3.1");
    expect(result.prd.branchName).toBe("improve/cycle-3");
  });

  it("excludes previously addressed findings", async () => {
    await generateImprovementPrd(tmpDir, FINDINGS, SNAPSHOT, TEST_PROFILE, {
      previousFindingIds: ["sec-1"],
    });

    // Verify the user message sent to Claude only has the non-excluded finding
    const userMessage = mockSendMessage.mock.calls[0]![2]![0]!.content;
    expect(userMessage).toContain("cod-1");
    expect(userMessage).not.toContain("sec-1: Command injection");
  });

  it("includes focus in user message", async () => {
    await generateImprovementPrd(tmpDir, FINDINGS, SNAPSHOT, TEST_PROFILE, {
      focus: "security",
    });

    const userMessage = mockSendMessage.mock.calls[0]![2]![0]!.content;
    expect(userMessage).toContain("Focus: security");
  });

  it("builds themes from findings", async () => {
    const result = await generateImprovementPrd(tmpDir, FINDINGS, SNAPSHOT, TEST_PROFILE);

    expect(result.themes).toBeDefined();
    expect(typeof result.themes).toBe("object");
  });

  it("sends codebase snapshot context to Claude", async () => {
    await generateImprovementPrd(tmpDir, FINDINGS, SNAPSHOT, TEST_PROFILE);

    const userMessage = mockSendMessage.mock.calls[0]![2]![0]!.content;
    expect(userMessage).toContain("Files: 50");
    expect(userMessage).toContain("Lines: 5000");
    expect(userMessage).toContain("Dependencies: 20");
  });
});
