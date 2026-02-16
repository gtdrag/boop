import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperProfile } from "../shared/types.js";
import {
  buildUserMessage,
  generateArchitecture,
  loadPrd,
  loadSystemPrompt,
  saveArchitecture,
} from "./architecture.js";

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

const SAMPLE_PRD = `# Product Requirements Document

## Executive Summary
A task management API that allows teams to create, assign, and track tasks.

## Functional Requirements

### Core Features (MVP)
1. Task CRUD operations
2. User authentication
3. Team workspaces

## Non-Functional Requirements

### Performance
- API response times under 200ms

### Security
- JWT-based authentication
- Role-based access control

## MVP Scope

### In Scope
- Task CRUD
- Authentication
- Team workspaces

### Out of Scope
- Mobile app

## Success Criteria
- Users can create and manage tasks
- API responds within 200ms`;

const SAMPLE_ARCHITECTURE = `# Architecture Document

## Tech Stack

### Languages
- TypeScript — primary language per developer profile

### Frontend
- **Framework:** Next.js
- **Styling:** Tailwind CSS
- **State Management:** Zustand

### Backend
- **Framework:** Express
- **API Pattern:** REST

### Database
- **Primary:** PostgreSQL
- **ORM:** Prisma

### Infrastructure
- **Cloud Provider:** Vercel
- **CI/CD:** GitHub Actions

## Architecture Decisions

### Authentication
- **Strategy:** JWT
- **Rationale:** Stateless auth fits the REST API pattern

### API Design
- **Pattern:** REST
- **Rationale:** Standard CRUD operations map well to REST

## Escalated Decisions

No escalated decisions — all choices resolved from developer profile.`;

// Use vi.hoisted() so the mock fn is available before vi.mock hoisting
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));

vi.mock("../shared/claude-client.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: () => false,
  createAnthropicClient: vi.fn(),
}));

describe("architecture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-arch-test-"));
    mockSendMessage.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadSystemPrompt", () => {
    it("loads the system prompt from the prompts directory", () => {
      const prompt = loadSystemPrompt();
      expect(prompt).toContain("Architecture Generation");
      expect(prompt).toContain("Tech Stack");
      expect(prompt).toContain("Architecture Decisions");
      expect(prompt).toContain("Escalated Decisions");
    });

    it("loads from a custom directory", () => {
      const customDir = path.join(tmpDir, "custom-prompts");
      fs.mkdirSync(customDir, { recursive: true });
      fs.writeFileSync(
        path.join(customDir, "system.md"),
        "# Custom Architecture Prompt\nTest content",
      );
      const prompt = loadSystemPrompt(customDir);
      expect(prompt).toContain("Custom Architecture Prompt");
    });
  });

  describe("buildUserMessage", () => {
    it("includes profile context, idea, and PRD", () => {
      const msg = buildUserMessage("Build a task manager", TEST_PROFILE, SAMPLE_PRD);
      expect(msg).toContain("## Developer Profile");
      expect(msg).toContain("## Project Idea");
      expect(msg).toContain("Build a task manager");
      expect(msg).toContain("## Product Requirements Document");
      expect(msg).toContain("Executive Summary");
    });

    it("includes profile fields in the message", () => {
      const msg = buildUserMessage("An API", TEST_PROFILE, SAMPLE_PRD);
      expect(msg).toContain("typescript");
      expect(msg).toContain("express");
      expect(msg).toContain("postgresql");
      expect(msg).toContain("next");
      expect(msg).toContain("vercel");
    });

    it("includes the full PRD", () => {
      const msg = buildUserMessage("idea", TEST_PROFILE, SAMPLE_PRD);
      expect(msg).toContain("Functional Requirements");
      expect(msg).toContain("Non-Functional Requirements");
      expect(msg).toContain("MVP Scope");
    });
  });

  describe("saveArchitecture", () => {
    it("creates .boop/planning/architecture.md", () => {
      const content = "# Architecture\nThis is the architecture doc.";
      const filePath = saveArchitecture(tmpDir, content);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe(content);
    });

    it("creates nested directories if they don't exist", () => {
      const nested = path.join(tmpDir, "deep", "project");
      fs.mkdirSync(nested, { recursive: true });
      const filePath = saveArchitecture(nested, "test");
      expect(filePath).toContain(path.join(".boop", "planning", "architecture.md"));
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("overwrites existing architecture", () => {
      saveArchitecture(tmpDir, "first");
      saveArchitecture(tmpDir, "second");
      const filePath = path.join(tmpDir, ".boop", "planning", "architecture.md");
      expect(fs.readFileSync(filePath, "utf-8")).toBe("second");
    });
  });

  describe("loadPrd", () => {
    it("returns null when prd.md does not exist", () => {
      const result = loadPrd(tmpDir);
      expect(result).toBeNull();
    });

    it("returns the PRD content when prd.md exists", () => {
      const planningDir = path.join(tmpDir, ".boop", "planning");
      fs.mkdirSync(planningDir, { recursive: true });
      fs.writeFileSync(path.join(planningDir, "prd.md"), SAMPLE_PRD);

      const result = loadPrd(tmpDir);
      expect(result).toBe(SAMPLE_PRD);
    });
  });

  describe("generateArchitecture", () => {
    it("calls sendMessage with correct parameters and saves result", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_ARCHITECTURE,
        usage: { inputTokens: 800, outputTokens: 1200 },
        model: "claude-opus-4-6",
      });

      const result = await generateArchitecture(
        "Build a task manager",
        TEST_PROFILE,
        SAMPLE_PRD,
        { projectDir: tmpDir },
      );

      expect(result.architecture).toContain("Architecture Document");
      expect(result.usage.inputTokens).toBe(800);
      expect(result.usage.outputTokens).toBe(1200);

      // Verify it was saved to disk
      const savedPath = path.join(tmpDir, ".boop", "planning", "architecture.md");
      expect(fs.existsSync(savedPath)).toBe(true);
      expect(fs.readFileSync(savedPath, "utf-8")).toContain("Architecture Document");
    });

    it("uses profile aiModel for the API call", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_ARCHITECTURE,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generateArchitecture("test idea", TEST_PROFILE, SAMPLE_PRD, {
        projectDir: tmpDir,
      });

      expect(mockSendMessage).toHaveBeenCalledOnce();
      const callArgs = mockSendMessage.mock.calls[0]!;
      expect(callArgs[0].model).toBe("claude-opus-4-6");
    });

    it("includes PRD in the user message", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_ARCHITECTURE,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generateArchitecture("my idea", TEST_PROFILE, SAMPLE_PRD, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      const messages = callArgs[2];
      expect(messages[0]!.content).toContain("Product Requirements Document");
      expect(messages[0]!.content).toContain("Functional Requirements");
    });

    it("includes developer profile in the user message", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_ARCHITECTURE,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generateArchitecture("my idea", TEST_PROFILE, SAMPLE_PRD, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      const messages = callArgs[2];
      expect(messages[0]!.content).toContain("Developer Profile");
      expect(messages[0]!.content).toContain("typescript");
    });

    it("uses 8192 maxTokens for architecture generation", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_ARCHITECTURE,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generateArchitecture("idea", TEST_PROFILE, SAMPLE_PRD, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      expect(callArgs[0].maxTokens).toBe(8192);
    });

    it("passes system prompt from the prompts directory", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_ARCHITECTURE,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generateArchitecture("idea", TEST_PROFILE, SAMPLE_PRD, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      const systemPrompt = callArgs[1];
      expect(systemPrompt).toContain("Architecture Generation");
    });
  });
});
