import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperProfile } from "../shared/types.js";
import {
  assessViability,
  buildUserMessage,
  extractRecommendation,
  formatProfileContext,
  loadSystemPrompt,
  saveAssessment,
} from "./viability.js";

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
  packageManager: "pnpm",
  testRunner: "vitest",
  linter: "oxlint",
  projectStructure: "monorepo",
  aiModel: "claude-opus-4-6",
  autonomousByDefault: false,
};

// Use vi.hoisted() so the mock fn is available before vi.mock hoisting
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));

vi.mock("../shared/claude-client.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: () => false,
  createAnthropicClient: vi.fn(),
}));

describe("viability", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-viability-test-"));
    mockSendMessage.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadSystemPrompt", () => {
    it("loads the system prompt from the prompts directory", () => {
      const prompt = loadSystemPrompt();
      expect(prompt).toContain("Viability Assessment");
      expect(prompt).toContain("Feasibility");
      expect(prompt).toContain("Market Fit");
      expect(prompt).toContain("Technical Complexity");
    });

    it("loads from a custom directory", () => {
      const customDir = path.join(tmpDir, "custom-prompts");
      fs.mkdirSync(customDir, { recursive: true });
      fs.writeFileSync(path.join(customDir, "system.md"), "# Custom Prompt\nTest content");
      const prompt = loadSystemPrompt(customDir);
      expect(prompt).toContain("Custom Prompt");
    });
  });

  describe("formatProfileContext", () => {
    it("includes all profile fields", () => {
      const context = formatProfileContext(TEST_PROFILE);
      expect(context).toContain("Test Dev");
      expect(context).toContain("typescript");
      expect(context).toContain("next");
      expect(context).toContain("express");
      expect(context).toContain("postgresql");
      expect(context).toContain("vercel");
      expect(context).toContain("tailwind");
      expect(context).toContain("zustand");
      expect(context).toContain("posthog");
      expect(context).toContain("github-actions");
      expect(context).toContain("pnpm");
      expect(context).toContain("vitest");
      expect(context).toContain("oxlint");
      expect(context).toContain("monorepo");
      expect(context).toContain("claude-opus-4-6");
    });

    it("starts with Developer Profile heading", () => {
      const context = formatProfileContext(TEST_PROFILE);
      expect(context).toMatch(/^## Developer Profile/);
    });
  });

  describe("buildUserMessage", () => {
    it("includes profile context and idea", () => {
      const msg = buildUserMessage("Build a task manager", TEST_PROFILE);
      expect(msg).toContain("## Developer Profile");
      expect(msg).toContain("## Project Idea");
      expect(msg).toContain("Build a task manager");
    });

    it("includes profile fields in the message", () => {
      const msg = buildUserMessage("An API", TEST_PROFILE);
      expect(msg).toContain("typescript");
      expect(msg).toContain("express");
    });
  });

  describe("extractRecommendation", () => {
    it("extracts PROCEED from bold text", () => {
      const text = "### Recommendation\n**PROCEED**\nThis is a great idea.";
      expect(extractRecommendation(text)).toBe("PROCEED");
    });

    it("extracts CONCERNS from bold text", () => {
      const text = "### Recommendation\n**CONCERNS**\nSome issues to address.";
      expect(extractRecommendation(text)).toBe("CONCERNS");
    });

    it("extracts RECONSIDER from bold text", () => {
      const text = "### Recommendation\n**RECONSIDER**\nMajor issues.";
      expect(extractRecommendation(text)).toBe("RECONSIDER");
    });

    it("handles mixed case", () => {
      const text = "**Proceed**";
      expect(extractRecommendation(text)).toBe("PROCEED");
    });

    it("falls back to CONCERNS when no clear recommendation", () => {
      const text = "The idea is interesting but needs work.";
      expect(extractRecommendation(text)).toBe("CONCERNS");
    });

    it("extracts from unformatted recommendation text", () => {
      const text = "Recommendation: PROCEED\nGo for it.";
      expect(extractRecommendation(text)).toBe("PROCEED");
    });

    it("prioritizes RECONSIDER when multiple patterns match", () => {
      const text = "**PROCEED** but also **RECONSIDER** some parts.";
      expect(extractRecommendation(text)).toBe("RECONSIDER");
    });
  });

  describe("saveAssessment", () => {
    it("creates .boop/planning/viability.md", () => {
      const content = "# Assessment\nThis is the assessment.";
      const filePath = saveAssessment(tmpDir, content);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe(content);
    });

    it("creates nested directories if they don't exist", () => {
      const nested = path.join(tmpDir, "deep", "project");
      fs.mkdirSync(nested, { recursive: true });
      const filePath = saveAssessment(nested, "test");
      expect(filePath).toContain(path.join(".boop", "planning", "viability.md"));
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("overwrites existing assessment", () => {
      saveAssessment(tmpDir, "first");
      saveAssessment(tmpDir, "second");
      const filePath = path.join(tmpDir, ".boop", "planning", "viability.md");
      expect(fs.readFileSync(filePath, "utf-8")).toBe("second");
    });
  });

  describe("assessViability", () => {
    it("calls sendMessage with correct parameters and saves result", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: "## Viability Assessment\n\n### Recommendation\n**PROCEED**\n\nGreat idea!",
        usage: { inputTokens: 100, outputTokens: 200 },
        model: "claude-opus-4-6",
      });

      const result = await assessViability("Build a task manager", TEST_PROFILE, {
        projectDir: tmpDir,
      });

      expect(result.idea).toBe("Build a task manager");
      expect(result.assessment).toContain("Viability Assessment");
      expect(result.recommendation).toBe("PROCEED");
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(200);

      // Verify it was saved to disk
      const savedPath = path.join(tmpDir, ".boop", "planning", "viability.md");
      expect(fs.existsSync(savedPath)).toBe(true);
      expect(fs.readFileSync(savedPath, "utf-8")).toContain("Viability Assessment");
    });

    it("uses Sonnet model via model router for planning", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: "**CONCERNS**",
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-sonnet-4-5-20250929",
      });

      await assessViability("test idea", TEST_PROFILE, {
        projectDir: tmpDir,
      });

      expect(mockSendMessage).toHaveBeenCalledOnce();
      const callArgs = mockSendMessage.mock.calls[0]!;
      expect(callArgs[0].model).toBe("claude-sonnet-4-5-20250929");
    });

    it("includes profile context in the user message", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: "**PROCEED**",
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await assessViability("my idea", TEST_PROFILE, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      const messages = callArgs[2];
      expect(messages[0]!.content).toContain("Developer Profile");
      expect(messages[0]!.content).toContain("typescript");
      expect(messages[0]!.content).toContain("my idea");
    });

    it("extracts RECONSIDER recommendation", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: "### Recommendation\n**RECONSIDER**\nThis needs work.",
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      const result = await assessViability("bad idea", TEST_PROFILE, {
        projectDir: tmpDir,
      });

      expect(result.recommendation).toBe("RECONSIDER");
    });
  });
});
