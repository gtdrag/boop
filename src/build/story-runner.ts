/**
 * Story runner for the Ralph build loop.
 *
 * Assembles the prompt for a single story (story details + progress.txt +
 * CLAUDE.md context), spawns a Claude CLI agent to implement it in the
 * project directory, and returns the result for the loop to process.
 *
 * The Claude CLI runs with full agentic capabilities (file editing, bash,
 * etc.) so it can actually create files, install dependencies, and run
 * quality checks — unlike the Messages API which only returns text.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Story, Prd } from "../shared/types.js";
import { readLatestSnapshot, formatSnapshotForPrompt } from "../shared/context-snapshot.js";
import { isDockerAvailable } from "../sandbox/docker-runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoryRunnerOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Model to use for the Claude CLI agent. */
  model?: string;
  /** Maximum agentic turns per story. Defaults to 30. */
  maxTurns?: number;
  /** Timeout in milliseconds. Defaults to 600_000 (10 minutes). */
  timeout?: number;
  /** Epic number (used to load previous context snapshot). */
  epicNumber?: number;
  /** Run Claude CLI inside a Docker container for isolation. */
  sandboxed?: boolean;
  /** Docker image for sandbox (must have Node.js). Defaults to "node:22-slim". */
  sandboxImage?: string;
}

export interface StoryRunResult {
  /** The story that was run. */
  story: Story;
  /** The Claude CLI output text. */
  output: string;
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
 *
 * Includes project context (CLAUDE.md, progress.txt, PRD summary) and
 * agent instructions. If a previous snapshot exists, it's injected as
 * structured XML context so the agent has perfect handoff state.
 *
 * The Claude CLI also reads CLAUDE.md from the project directory
 * automatically, but including it here ensures the context is complete
 * even if the file doesn't exist on disk yet.
 */
export function buildSystemPrompt(prd: Prd, projectDir: string, epicNumber?: number): string {
  const claudeMd = readFileOrFallback(path.join(projectDir, "CLAUDE.md"), "(No CLAUDE.md found)");

  const progressTxt = readFileOrFallback(
    path.join(projectDir, ".boop", "progress.txt"),
    "(No progress.txt yet — this is the first story)",
  );

  // Inject previous snapshot if available
  let snapshotBlock = "";
  if (epicNumber !== undefined) {
    const prev = readLatestSnapshot(projectDir, "BUILDING", epicNumber);
    if (prev) {
      snapshotBlock = `
## Previous Session Context

${formatSnapshotForPrompt(prev)}

`;
    }
  }

  return `# Ralph Agent Instructions

You are an autonomous coding agent working on ${prd.project}.

## Project Context (CLAUDE.md)

${claudeMd}

## Progress Log (progress.txt)

${progressTxt}
${snapshotBlock}
## PRD

Project: ${prd.project}
Branch: ${prd.branchName}
Description: ${prd.description}

## Important

- Implement the story described in the user message.
- Install dependencies if needed (pnpm install).
- Run quality checks after implementing: pnpm typecheck, pnpm test.
- If quality checks fail, fix the issues and re-run until they pass.
- Do NOT commit changes — the build system handles commits.
- Do NOT introduce mock data, placeholder implementations, or TODO markers in production code.
- Keep changes focused and minimal.

## Logging

This project includes a structured logger at \`src/lib/logger.ts\`. Use it throughout:

- Create a module-scoped logger at the top of every file: \`const log = createLogger("module-name")\`
- Log function entry with key parameters at debug level
- Log all external calls (API, DB, file I/O) at info level with timing
- Log state transitions and business logic decisions at info level
- Log errors with full context (error message, relevant IDs, what was attempted)
- Use levels: debug (flow/variables), info (actions/events), warn (recoverable), error (failures)
- Never log secrets, tokens, or passwords

## TypeScript Import Rules

Check the project's tsconfig.json for the \`moduleResolution\` setting:

- If \`"moduleResolution": "NodeNext"\` — all relative imports MUST include explicit \`.js\` file extensions (e.g. \`from "./utils.js"\`).
- If \`"moduleResolution": "bundler"\` — do NOT use file extensions on relative imports (e.g. \`from "./utils"\`). This is the standard for Next.js, Vite, Remix, and other bundled projects.

Follow whichever convention the tsconfig specifies. Package imports (e.g. \`from "react"\`) never need extensions.
`;
}

/**
 * Build the user message for a specific story.
 */
export function buildStoryPrompt(story: Story): string {
  const criteria = story.acceptanceCriteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n");

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

Please implement this story now. After implementing, run typecheck and tests to verify everything passes.`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_TIMEOUT = 600_000; // 10 minutes
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

/**
 * Build Docker run arguments for sandboxed Claude CLI execution.
 *
 * Unlike the sandbox module's buildDockerArgs (designed for single commands),
 * this builds a container for a full agent session — more memory, writable
 * home directory (for npx cache), and ANTHROPIC_API_KEY forwarded.
 */
function buildSandboxDockerArgs(projectDir: string, claudeArgs: string[], image: string): string[] {
  const resolved = path.resolve(projectDir);
  return [
    "run",
    "--rm",
    "--name",
    `boop-build-${randomUUID()}`,
    "--memory",
    "4g",
    "--cpus",
    "2",
    "--pids-limit",
    "512",
    "--tmpfs",
    "/tmp:rw,size=1g",
    "--tmpfs",
    "/root:rw,size=512m",
    "-v",
    `${resolved}:/workspace:rw`,
    "-w",
    "/workspace",
    "--no-new-privileges",
    "-e",
    `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? ""}`,
    image,
    "npx",
    "-y",
    "@anthropic-ai/claude-code",
    ...claudeArgs,
  ];
}

/**
 * Run a single story by spawning a Claude CLI agent.
 *
 * The agent runs in the project directory with full agentic capabilities
 * (file editing, bash execution, etc.) and implements the story end-to-end.
 * It can create files, install packages, run tests, and fix issues — the
 * loop then independently verifies quality before committing.
 *
 * When `sandboxed` is true, the agent runs inside a Docker container with
 * resource limits and process isolation. Requires Docker to be available.
 *
 * @param story - The story to implement.
 * @param prd - The full PRD for project context.
 * @param options - Runner configuration.
 * @returns The story run result with the agent's output.
 */
export async function runStory(
  story: Story,
  prd: Prd,
  options: StoryRunnerOptions,
): Promise<StoryRunResult> {
  const systemPrompt = buildSystemPrompt(prd, options.projectDir, options.epicNumber);
  const userMessage = buildStoryPrompt(story);

  // Combine system prompt and story prompt into a single input.
  // The Claude CLI also reads CLAUDE.md from the project directory,
  // so project context is doubly reinforced.
  const fullPrompt = systemPrompt + "\n\n---\n\n" + userMessage;

  const claudeArgs: string[] = [
    "--print",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
  ];

  if (options.model) {
    claudeArgs.push("--model", options.model);
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  // Determine whether to run in Docker sandbox or directly
  let cmd: string;
  let args: string[];
  let cwd: string | undefined;

  if (options.sandboxed) {
    if (!isDockerAvailable()) {
      throw new Error(
        "Docker is required for sandboxed execution but is not available. " +
          "Install Docker or set sandboxed: false.",
      );
    }
    const image = options.sandboxImage ?? "node:22-slim";
    cmd = "docker";
    args = buildSandboxDockerArgs(options.projectDir, claudeArgs, image);
    cwd = undefined; // Docker container sets its own working directory
  } else {
    cmd = "claude";
    args = claudeArgs;
    cwd = options.projectDir;
  }

  const result = spawnSync(cmd, args, {
    input: fullPrompt,
    cwd,
    encoding: "utf-8",
    timeout,
    maxBuffer: MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Handle spawn errors (claude/docker not found, timeout, etc.)
  if (result.error) {
    const msg = result.error.message;
    if (msg.includes("ENOENT")) {
      throw new Error(
        options.sandboxed
          ? "Docker not found. Install Docker Desktop to use sandboxed execution."
          : "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
      );
    }
    if (msg.includes("ETIMEDOUT") || msg.includes("SIGTERM")) {
      throw new Error(
        `Claude CLI timed out after ${Math.round(timeout / 1000)}s on story ${story.id}`,
      );
    }
    throw new Error(`Claude CLI error: ${msg}`);
  }

  // Handle non-zero exit code
  if (result.status !== null && result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    throw new Error(`Claude CLI exited with code ${result.status}${stderr ? `: ${stderr}` : ""}`);
  }

  return {
    story,
    output: result.stdout ?? "",
  };
}
