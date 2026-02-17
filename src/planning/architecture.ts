/**
 * Architecture generation — third phase of the planning pipeline.
 *
 * Generates architecture decisions from the PRD and developer profile
 * using Claude. Most decisions are auto-resolved from the profile;
 * only genuinely novel choices are escalated.
 */
import fs from "node:fs";
import path from "node:path";
import { sendMessage, isRetryableApiError, retry } from "../shared/index.js";
import type { ClaudeClientOptions, ClaudeResponse } from "../shared/index.js";
import type { DeveloperProfile } from "../profile/schema.js";
import { formatProfileContext } from "./viability.js";

export interface ArchitectureResult {
  /** The generated architecture markdown text. */
  architecture: string;
  /** Token usage from the API call. */
  usage: ClaudeResponse["usage"];
}

export interface ArchitectureOptions {
  /** Claude API client options. */
  clientOptions?: ClaudeClientOptions;
  /** Directory containing the prompt templates. Defaults to prompts/architecture/. */
  promptDir?: string;
  /** Project directory for saving output. Defaults to cwd. */
  projectDir?: string;
}

const PROMPTS_DIR = fs.existsSync(path.resolve(import.meta.dirname, "prompts", "architecture"))
  ? path.resolve(import.meta.dirname, "prompts", "architecture")
  : path.resolve(import.meta.dirname, "..", "..", "prompts", "architecture");

/**
 * Load the architecture system prompt from the prompts directory.
 */
export function loadSystemPrompt(promptDir?: string): string {
  const dir = promptDir ?? PROMPTS_DIR;
  const systemPath = path.join(dir, "system.md");
  return fs.readFileSync(systemPath, "utf-8");
}

/**
 * Build the user message for architecture generation.
 *
 * Includes the developer profile, original idea, and PRD
 * so the architecture builds on the prior phase outputs.
 */
export function buildUserMessage(
  idea: string,
  profile: DeveloperProfile,
  prd: string,
): string {
  const profileContext = formatProfileContext(profile);
  const lines = [
    profileContext,
    "",
    "## Project Idea",
    "",
    idea,
    "",
    "## Product Requirements Document",
    "",
    prd,
  ];
  return lines.join("\n");
}

/**
 * Save the architecture document to .boop/planning/architecture.md
 */
export function saveArchitecture(projectDir: string, architecture: string): string {
  const planningDir = path.join(projectDir, ".boop", "planning");
  fs.mkdirSync(planningDir, { recursive: true });

  const filePath = path.join(planningDir, "architecture.md");
  fs.writeFileSync(filePath, architecture, "utf-8");
  return filePath;
}

/**
 * Load the PRD from .boop/planning/prd.md
 *
 * Returns the PRD text, or null if the file doesn't exist.
 */
export function loadPrd(projectDir: string): string | null {
  const filePath = path.join(projectDir, ".boop", "planning", "prd.md");
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Generate architecture decisions from the idea, PRD, and developer profile.
 *
 * Calls Claude with the architecture system prompt and chains the PRD
 * as input context. Retries on transient API errors.
 */
export async function generateArchitecture(
  idea: string,
  profile: DeveloperProfile,
  prd: string,
  options: ArchitectureOptions = {},
): Promise<ArchitectureResult> {
  const systemPrompt = loadSystemPrompt(options.promptDir);
  const userMessage = buildUserMessage(idea, profile, prd);
  const projectDir = options.projectDir ?? process.cwd();

  const clientOptions: ClaudeClientOptions = {
    model: profile.aiModel || undefined,
    maxTokens: 8192,
    ...options.clientOptions,
  };

  const response = await retry(
    () => sendMessage(clientOptions, systemPrompt, [{ role: "user", content: userMessage }]),
    {
      maxRetries: 1,
      isRetryable: isRetryableApiError,
    },
  );

  // Save to .boop/planning/architecture.md
  saveArchitecture(projectDir, response.text);

  return {
    architecture: response.text,
    usage: response.usage,
  };
}
