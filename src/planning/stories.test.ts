import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperProfile } from "../shared/types.js";
import {
  buildUserMessage,
  generateStories,
  loadArchitecture,
  loadSystemPrompt,
  saveStories,
} from "./stories.js";

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
- **Rationale:** Stateless auth fits the REST API pattern`;

const SAMPLE_STORIES = `# Epic & Story Breakdown

## Epic 1: Project Setup & Foundation
**Goal:** Set up the project structure, tooling, and base configuration.
**Scope:** Scaffolding, database, CI/CD

### Story 1.1: Project scaffolding
**As a** developer, **I want** a working project skeleton, **so that** I can start building features.

**Acceptance Criteria:**
- Given a fresh checkout, when I run pnpm install && pnpm build, then it succeeds
- Given the project, when I run pnpm test, then tests pass
- Typecheck passes
- All tests pass

**Prerequisites:** None

**Technical Notes:**
- Initialize Next.js with TypeScript
- Set up Express backend
- Configure Tailwind CSS

---

## Epic 2: Authentication
**Goal:** Implement user authentication with JWT.
**Scope:** Registration, login, token management

### Story 2.1: User registration
**As a** user, **I want** to register an account, **so that** I can access the system.

**Acceptance Criteria:**
- Given valid credentials, when I POST /auth/register, then a user is created
- Given duplicate email, when I POST /auth/register, then I get a 409 error
- Typecheck passes
- All tests pass

**Prerequisites:** 1.1

**Technical Notes:**
- Create src/auth/register.ts
- Add Prisma User model
- Hash passwords with bcrypt`;

// Use vi.hoisted() so the mock fn is available before vi.mock hoisting
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));

vi.mock("../shared/claude-client.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: () => false,
  createAnthropicClient: vi.fn(),
}));

describe("stories", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-stories-test-"));
    mockSendMessage.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadSystemPrompt", () => {
    it("loads the system prompt from the prompts directory", () => {
      const prompt = loadSystemPrompt();
      expect(prompt).toContain("Epic & Story Breakdown");
      expect(prompt).toContain("Acceptance Criteria");
      expect(prompt).toContain("Prerequisites");
    });

    it("loads from a custom directory", () => {
      const customDir = path.join(tmpDir, "custom-prompts");
      fs.mkdirSync(customDir, { recursive: true });
      fs.writeFileSync(path.join(customDir, "system.md"), "# Custom Stories Prompt\nTest content");
      const prompt = loadSystemPrompt(customDir);
      expect(prompt).toContain("Custom Stories Prompt");
    });
  });

  describe("buildUserMessage", () => {
    it("includes profile context, idea, PRD, and architecture", () => {
      const msg = buildUserMessage(
        "Build a task manager",
        TEST_PROFILE,
        SAMPLE_PRD,
        SAMPLE_ARCHITECTURE,
      );
      expect(msg).toContain("## Developer Profile");
      expect(msg).toContain("## Project Idea");
      expect(msg).toContain("Build a task manager");
      expect(msg).toContain("## Product Requirements Document");
      expect(msg).toContain("Executive Summary");
      expect(msg).toContain("## Architecture Document");
      expect(msg).toContain("Tech Stack");
    });

    it("includes profile fields in the message", () => {
      const msg = buildUserMessage("An API", TEST_PROFILE, SAMPLE_PRD, SAMPLE_ARCHITECTURE);
      expect(msg).toContain("typescript");
      expect(msg).toContain("express");
      expect(msg).toContain("postgresql");
      expect(msg).toContain("next");
      expect(msg).toContain("vercel");
    });

    it("includes the full PRD", () => {
      const msg = buildUserMessage("idea", TEST_PROFILE, SAMPLE_PRD, SAMPLE_ARCHITECTURE);
      expect(msg).toContain("Functional Requirements");
      expect(msg).toContain("Non-Functional Requirements");
      expect(msg).toContain("MVP Scope");
    });

    it("includes the full architecture", () => {
      const msg = buildUserMessage("idea", TEST_PROFILE, SAMPLE_PRD, SAMPLE_ARCHITECTURE);
      expect(msg).toContain("Architecture Decisions");
      expect(msg).toContain("Authentication");
      expect(msg).toContain("JWT");
    });
  });

  describe("saveStories", () => {
    it("creates .boop/planning/epics.md", () => {
      const content = "# Epic & Story Breakdown\nThis is the stories doc.";
      const filePath = saveStories(tmpDir, content);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe(content);
    });

    it("creates nested directories if they don't exist", () => {
      const nested = path.join(tmpDir, "deep", "project");
      fs.mkdirSync(nested, { recursive: true });
      const filePath = saveStories(nested, "test");
      expect(filePath).toContain(path.join(".boop", "planning", "epics.md"));
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("overwrites existing stories", () => {
      saveStories(tmpDir, "first");
      saveStories(tmpDir, "second");
      const filePath = path.join(tmpDir, ".boop", "planning", "epics.md");
      expect(fs.readFileSync(filePath, "utf-8")).toBe("second");
    });
  });

  describe("loadArchitecture", () => {
    it("returns null when architecture.md does not exist", () => {
      const result = loadArchitecture(tmpDir);
      expect(result).toBeNull();
    });

    it("returns the architecture content when architecture.md exists", () => {
      const planningDir = path.join(tmpDir, ".boop", "planning");
      fs.mkdirSync(planningDir, { recursive: true });
      fs.writeFileSync(path.join(planningDir, "architecture.md"), SAMPLE_ARCHITECTURE);

      const result = loadArchitecture(tmpDir);
      expect(result).toBe(SAMPLE_ARCHITECTURE);
    });
  });

  describe("generateStories", () => {
    it("calls sendMessage with correct parameters and saves result", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_STORIES,
        usage: { inputTokens: 1500, outputTokens: 2000 },
        model: "claude-opus-4-6",
      });

      const result = await generateStories(
        "Build a task manager",
        TEST_PROFILE,
        SAMPLE_PRD,
        SAMPLE_ARCHITECTURE,
        { projectDir: tmpDir },
      );

      expect(result.stories).toContain("Epic & Story Breakdown");
      expect(result.usage.inputTokens).toBe(1500);
      expect(result.usage.outputTokens).toBe(2000);

      // Verify it was saved to disk
      const savedPath = path.join(tmpDir, ".boop", "planning", "epics.md");
      expect(fs.existsSync(savedPath)).toBe(true);
      expect(fs.readFileSync(savedPath, "utf-8")).toContain("Epic & Story Breakdown");
    });

    it("uses Sonnet model via model router for planning", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_STORIES,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-sonnet-4-5-20250929",
      });

      await generateStories("test idea", TEST_PROFILE, SAMPLE_PRD, SAMPLE_ARCHITECTURE, {
        projectDir: tmpDir,
      });

      expect(mockSendMessage).toHaveBeenCalledOnce();
      const callArgs = mockSendMessage.mock.calls[0]!;
      expect(callArgs[0].model).toBe("claude-sonnet-4-5-20250929");
    });

    it("includes PRD and architecture in the user message", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_STORIES,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generateStories("my idea", TEST_PROFILE, SAMPLE_PRD, SAMPLE_ARCHITECTURE, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      const messages = callArgs[2];
      expect(messages[0]!.content).toContain("Product Requirements Document");
      expect(messages[0]!.content).toContain("Architecture Document");
    });

    it("includes developer profile in the user message", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_STORIES,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generateStories("my idea", TEST_PROFILE, SAMPLE_PRD, SAMPLE_ARCHITECTURE, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      const messages = callArgs[2];
      expect(messages[0]!.content).toContain("Developer Profile");
      expect(messages[0]!.content).toContain("typescript");
    });

    it("uses 8192 maxTokens for story generation", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_STORIES,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-opus-4-6",
      });

      await generateStories("idea", TEST_PROFILE, SAMPLE_PRD, SAMPLE_ARCHITECTURE, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      expect(callArgs[0].maxTokens).toBe(8192);
    });

    it("passes system prompt as cacheable blocks", async () => {
      mockSendMessage.mockResolvedValueOnce({
        text: SAMPLE_STORIES,
        usage: { inputTokens: 50, outputTokens: 100 },
        model: "claude-sonnet-4-5-20250929",
      });

      await generateStories("idea", TEST_PROFILE, SAMPLE_PRD, SAMPLE_ARCHITECTURE, {
        projectDir: tmpDir,
      });

      const callArgs = mockSendMessage.mock.calls[0]!;
      const systemPrompt = callArgs[1];
      expect(Array.isArray(systemPrompt)).toBe(true);
      expect(systemPrompt[0].text).toContain("Epic & Story Breakdown");
      expect(systemPrompt[0].cache_control).toEqual({ type: "ephemeral" });
    });
  });
});
