/**
 * PRD generation — second phase of the planning pipeline.
 *
 * Generates a Product Requirements Document from the viability assessment
 * and developer profile using Claude. Chains viability output as input
 * context so the PRD builds on the assessment.
 */
import fs from "node:fs";
import path from "node:path";
import { sendMessage, isRetryableApiError, retry } from "../shared/index.js";
import type { ClaudeClientOptions, ClaudeResponse } from "../shared/index.js";
import type { DeveloperProfile } from "../profile/schema.js";
import { formatProfileContext } from "./viability.js";

export interface PrdResult {
  /** The generated PRD markdown text. */
  prd: string;
  /** Token usage from the API call. */
  usage: ClaudeResponse["usage"];
}

export interface PrdOptions {
  /** Claude API client options. */
  clientOptions?: ClaudeClientOptions;
  /** Directory containing the prompt templates. Defaults to prompts/prd/. */
  promptDir?: string;
  /** Project directory for saving output. Defaults to cwd. */
  projectDir?: string;
}

const PROMPTS_DIR = path.resolve(import.meta.dirname, "..", "..", "prompts", "prd");

/**
 * Load the PRD system prompt from the prompts directory.
 */
export function loadSystemPrompt(promptDir?: string): string {
  const dir = promptDir ?? PROMPTS_DIR;
  const systemPath = path.join(dir, "system.md");
  return fs.readFileSync(systemPath, "utf-8");
}

/**
 * Build the user message for PRD generation.
 *
 * Includes the developer profile, original idea, and viability assessment
 * so the PRD builds on the prior phase output.
 */
export function buildUserMessage(
  idea: string,
  profile: DeveloperProfile,
  viabilityAssessment: string,
): string {
  const profileContext = formatProfileContext(profile);
  const lines = [
    profileContext,
    "",
    "## Project Idea",
    "",
    idea,
    "",
    "## Viability Assessment",
    "",
    viabilityAssessment,
  ];
  return lines.join("\n");
}

/**
 * Save the PRD to .boop/planning/prd.md
 */
export function savePrd(projectDir: string, prd: string): string {
  const planningDir = path.join(projectDir, ".boop", "planning");
  fs.mkdirSync(planningDir, { recursive: true });

  const filePath = path.join(planningDir, "prd.md");
  fs.writeFileSync(filePath, prd, "utf-8");
  return filePath;
}

/**
 * Load the viability assessment from .boop/planning/viability.md
 *
 * Returns the assessment text, or null if the file doesn't exist.
 */
export function loadViabilityAssessment(projectDir: string): string | null {
  const filePath = path.join(projectDir, ".boop", "planning", "viability.md");
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Generate a PRD from the idea, viability assessment, and developer profile.
 *
 * Calls Claude with the PRD system prompt and chains the viability output
 * as input context. Retries on transient API errors.
 */
export async function generatePrd(
  idea: string,
  profile: DeveloperProfile,
  viabilityAssessment: string,
  options: PrdOptions = {},
): Promise<PrdResult> {
  const systemPrompt = loadSystemPrompt(options.promptDir);
  const userMessage = buildUserMessage(idea, profile, viabilityAssessment);
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

  // Save to .boop/planning/prd.md
  savePrd(projectDir, response.text);

  return {
    prd: response.text,
    usage: response.usage,
  };
}
