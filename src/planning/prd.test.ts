import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperProfile } from "../shared/types.js";
import {
  buildUserMessage,
  generatePrd,
  loadSystemPrompt,
  loadViabilityAssessment,
  savePrd,
} from "./prd.js";

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

const SAMPLE_VIABILITY = `## Viability Assessment

### Idea
A task management API with PostgreSQL and Express

### Feasibility
This is highly feasible with the developer's stack.
**Score:** High

### Market Fit
Task management is a well-understood domain.
**Score:** Medium

### Technical Complexity
Standard CRUD with some real-time features.
**Level:** Medium

### Recommendation
**PROCEED**

This is a solid idea with clear implementation path.`;

const SAMPLE_PRD = `# Product Requirements Document

## Executive Summary
A task management API that allows teams to create, assign, and track tasks.

## Functional Requirements

### Core Features (MVP)
1. Task CRUD operations
2. User authentication

## Non-Functional Requirements

### Performance
- API response times under 200ms

## MVP Scope

### In Scope
- Task CRUD
- Authentication

### Out of Scope
- Mobile app

## Success Criteria
- Users can create and manage tasks
- API responds within 200ms`;

// Use vi.hoisted() so the mock fn is available before vi.mock hoisting
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));

vi.mock("../shared/claude-client.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: () => false,
  createAnthropicClient: vi.fn(),
}));

describe("prd", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-prd-test-"));
    mockSendMessage.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadSystemPrompt", () => {
    it("loads the system prompt from the prompts directory", () => {
      const prompt = loadSystemPrompt();
      expect(prompt).toContain("PRD Generation");
      expect(prompt).toContain("Executive Summary");
      expect(prompt).toContain("Functional Requirements");
      expect(prompt).toContain("Non-Functional Requirements");
    });

    it("loads from a custom directory", () => {
      const customDir = path.join(tmpDir, "custom-prompts");
      fs.mkdirSync(customDir, { recursive: true });
      fs.writeFileSync(path.join(customDir, "system.md"), "# Custom PRD Prompt\nTest content");
      const prompt = loadSystemPrompt(customDir);
      expect(prompt).toContain("Custom PRD Prompt");
    });
  });

  describe("buildUserMessage", () => {
    it("includes profile context, idea, and viability assessment", () => {
      const msg = buildUserMessage("Build a task manager", TEST_PROFILE, SAMPLE_VIABILITY);
      expect(msg).toContain("## Developer Profile");
      expect(msg).toContain("## Project Idea");
      expect(msg).toContain("Build a task manager");
      expect(msg).toContain("## Viability Assessment");
      expect(msg).toContain("PROCEED");
    });

    it("includes profile fields in the message", () => {
      const msg = buildUserMessage("An API", TEST_PROFILE, SAMPLE_VIABILITY);
      expect(msg).toContain("typescript");
      expect(msg).toContain("express");
      expect(msg).toContain("postgresql");
    });

    it("includes the full viability assessment", () => {
      const msg = buildUserMessage("idea", TEST_PROFILE, SAMPLE_VIABILITY);
      expect(msg).toContain("Feasibility");
      expect(msg).toContain("Market Fit");
      expect(msg).toContain("Technical Complexity");
    });
  });

  describe("savePrd", () => {
    it("creates .boop/planning/prd.md", () => {
      const content = "# PRD\nThis is the PRD.";
      const filePath = savePrd(tmpDir, content);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe(content);
    });

    it("creates nested directories if they don't exist", () => {
      const nested = path.join(tmpDir, "deep", "project");
      fs.mkdirSync(nested, { recursive: true });
      const filePath = savePrd(nested, "test");
      expect(filePath).toContain(path.join(".boop", "planning", "prd.md"));
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("overwrites existing PRD", () => {
      savePrd(tmpDir, "first");
      savePrd(tmpDir, "second");
      const filePath = path.join(tmpDir, ".boop", "planning", "prd.md");
      expect(fs.readFileSync(filePath, "utf-8")).toBe("second");
    });
  });

  describe("loadViabilityAssessment", () => {
    it("returns null when viability.md does not exist", () => {
      const result = loadViabilityAssessment(tmpDir);
      expect(result).toBeNull();
    });

    it("returns the assessment content when viability.md exists", () => {
      const planningDir = path.join(tmpDir, ".boop", "planning");
      fs.mkdirSync(planningDir, { recursive: true });
      fs.writeFileSync(path.join(planningDir, "viability.md"), SAMPLE_VIABILITY);

      const result = loadViabilityAssessment(tmpDir);
      expect(result).toBe(SAMPLE_VIABILITY);
    });
  });

  describe("generatePrd", () => {
    it("calls sendMessage with correct parameters and saves result", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_PRD,
        usage: { inputTokens: 500, outputTokens: 1000 },
        model: "claude-opus-4-6",
      });

      const result = await generatePrd("Build a task manager", TEST_PROFILE, SAMPLE_VIABILITY, {
        projectDir: tmpDir,
      });

      expect(result.prd).toContain("Product Requirements Document");
      expect(result.usage.inputTokens).toBe(500);
      expect(result.usage.outputTokens).toBe(1000);

      // Verify it was saved to disk
      const savedPath = path.join(tmpDir, ".boop", "planning", "prd.md");
      expect(fs.existsSync(savedPath)).toBe(true);
      expect(fs.readFileSync(savedPath, "utf-8")).toContain("Product Requirements Document");
    });

    it("uses Sonnet model via model router for planning", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_PRD,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-sonnet-4-5-20250929",
      });

      await generatePrd("test idea", TEST_PROFILE, SAMPLE_VIABILITY, {
        projectDir: tmpDir,
      });

      expect(mockSendMessage).toHaveBeenCalledOnce();
      const callArgs = mockSendMessage.mock.calls[0]!;
      expect(callArgs[0].model).toBe("claude-sonnet-4-5-20250929");
    });

    it("includes viability assessment in the user message", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_PRD,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generatePrd("my idea", TEST_PROFILE, SAMPLE_VIABILITY, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      const messages = callArgs[2];
      expect(messages[0]!.content).toContain("Viability Assessment");
      expect(messages[0]!.content).toContain("PROCEED");
    });

    it("includes developer profile in the user message", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_PRD,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generatePrd("my idea", TEST_PROFILE, SAMPLE_VIABILITY, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      const messages = callArgs[2];
      expect(messages[0]!.content).toContain("Developer Profile");
      expect(messages[0]!.content).toContain("typescript");
    });

    it("uses higher maxTokens for PRD generation", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_PRD,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generatePrd("idea", TEST_PROFILE, SAMPLE_VIABILITY, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      expect(callArgs[0].maxTokens).toBe(8192);
    });

    it("passes system prompt as cacheable blocks", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_PRD,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-sonnet-4-5-20250929",
      });

      await generatePrd("idea", TEST_PROFILE, SAMPLE_VIABILITY, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      const systemPrompt = callArgs[1];
      expect(Array.isArray(systemPrompt)).toBe(true);
      expect(systemPrompt[0].text).toContain("PRD Generation");
      expect(systemPrompt[0].cache_control).toEqual({ type: "ephemeral" });
    });
  });
});
