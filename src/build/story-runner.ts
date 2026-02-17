/**
 * Story runner for the Ralph build loop.
 *
 * Assembles the prompt for a single story (story details + progress.txt +
 * CLAUDE.md context), sends it to Claude via the Anthropic SDK, and
 * returns the response for the loop to process.
 */

import fs from "node:fs";
import path from "node:path";
import type { Story, Prd } from "../shared/types.js";
import {
  sendMessage,
  isRetryableApiError,
  type ClaudeClientOptions,
  type ClaudeResponse,
} from "../shared/claude-client.js";
import { retry, type RetryOptions } from "../shared/retry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoryRunnerOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Claude API client options. */
  clientOptions?: ClaudeClientOptions;
  /** Retry options for the API call. */
  retryOptions?: RetryOptions;
}

export interface StoryRunResult {
  /** The story that was run. */
  story: Story;
  /** The full Claude response. */
  response: ClaudeResponse;
  /** The response text content. */
  text: string;
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

/**
 * Read a file if it exists, otherwise return a fallback string.
 */
function readFileOrFallback(filePath: string, fallback: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return fallback;
  }
}

/**
 * Build the system prompt for story execution.
 */
export function buildSystemPrompt(
  prd: Prd,
  projectDir: string,
): string {
  const claudeMd = readFileOrFallback(
    path.join(projectDir, "CLAUDE.md"),
    "(No CLAUDE.md found)",
  );

  const progressTxt = readFileOrFallback(
    path.join(projectDir, ".boop", "progress.txt"),
    "(No progress.txt yet — this is the first story)",
  );

  return `# Ralph Agent Instructions

You are an autonomous coding agent working on ${prd.project}.

## Project Context (CLAUDE.md)

${claudeMd}

## Progress Log (progress.txt)

${progressTxt}

## PRD

Project: ${prd.project}
Branch: ${prd.branchName}
Description: ${prd.description}

## Important

- Implement the story described in the user message.
- Run quality checks: typecheck, lint, test.
- If checks pass, commit with message: feat: [Story ID] - [Story Title]
- Do NOT introduce mock data, placeholder implementations, or TODO markers in production code.
- Keep changes focused and minimal.
`;
}

/**
 * Build the user message for a specific story.
 */
export function buildStoryPrompt(story: Story): string {
  const criteria = story.acceptanceCriteria
    .map((c, i) => `  ${i + 1}. ${c}`)
    .join("\n");

  let prompt = `## Implement Story ${story.id}: ${story.title}

**Description:** ${story.description}

**Acceptance Criteria:**
${criteria}
`;

  if (story.notes) {
    prompt += `\n**Implementation Notes:** ${story.notes}\n`;
  }

  prompt += `
**Priority:** ${story.priority}

Please implement this story now. After implementing, run typecheck, lint, and test to verify everything passes.`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a single story through the Claude API.
 *
 * Assembles the full prompt context (CLAUDE.md, progress.txt, PRD, story
 * details), sends it to the API with retry logic, and returns the response.
 *
 * @param story - The story to implement.
 * @param prd - The full PRD for project context.
 * @param options - Runner configuration.
 * @returns The story run result with Claude's response.
 */
export async function runStory(
  story: Story,
  prd: Prd,
  options: StoryRunnerOptions,
): Promise<StoryRunResult> {
  const systemPrompt = buildSystemPrompt(prd, options.projectDir);
  const userMessage = buildStoryPrompt(story);

  const clientOptions: ClaudeClientOptions = {
    maxTokens: 16384,
    ...options.clientOptions,
  };

  const retryOptions: RetryOptions = {
    maxRetries: 2,
    initialDelayMs: 2000,
    isRetryable: isRetryableApiError,
    ...options.retryOptions,
  };

  const response = await retry(
    () =>
      sendMessage(clientOptions, systemPrompt, [
        { role: "user", content: userMessage },
      ]),
    retryOptions,
  );

  return {
    story,
    response,
    text: response.text,
  };
}
