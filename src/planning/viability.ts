/**
 * Viability assessment — first phase of the planning pipeline.
 *
 * Evaluates a project idea for feasibility, market fit, and technical
 * complexity using Claude. Includes developer profile context so the
 * assessment is tailored to the developer's preferred stack.
 */
import fs from "node:fs";
import path from "node:path";
import { sendMessage, isRetryableApiError, retry } from "../shared/index.js";
import type { ClaudeClientOptions, ClaudeResponse } from "../shared/index.js";
import type { DeveloperProfile } from "../profile/schema.js";

/** Recommendation from the viability assessment. */
export type ViabilityRecommendation = "PROCEED" | "CONCERNS" | "RECONSIDER";

export interface ViabilityResult {
  /** The original idea that was assessed. */
  idea: string;
  /** The full assessment markdown text. */
  assessment: string;
  /** Extracted recommendation. */
  recommendation: ViabilityRecommendation;
  /** Token usage from the API call. */
  usage: ClaudeResponse["usage"];
}

export interface ViabilityOptions {
  /** Claude API client options. */
  clientOptions?: ClaudeClientOptions;
  /** Directory containing the prompt templates. Defaults to prompts/viability/. */
  promptDir?: string;
  /** Project directory for saving output. Defaults to cwd. */
  projectDir?: string;
}

const PROMPTS_DIR = path.resolve(import.meta.dirname, "..", "..", "prompts", "viability");

/**
 * Load the viability system prompt from the prompts directory.
 */
export function loadSystemPrompt(promptDir?: string): string {
  const dir = promptDir ?? PROMPTS_DIR;
  const systemPath = path.join(dir, "system.md");
  return fs.readFileSync(systemPath, "utf-8");
}

/**
 * Format the developer profile as context for the assessment.
 */
export function formatProfileContext(profile: DeveloperProfile): string {
  const lines = [
    "## Developer Profile",
    "",
    `- **Name:** ${profile.name}`,
    `- **Languages:** ${profile.languages.join(", ")}`,
    `- **Frontend:** ${profile.frontendFramework}`,
    `- **Backend:** ${profile.backendFramework}`,
    `- **Database:** ${profile.database}`,
    `- **Cloud:** ${profile.cloudProvider}`,
    `- **Styling:** ${profile.styling}`,
    `- **State Management:** ${profile.stateManagement}`,
    `- **Analytics:** ${profile.analytics}`,
    `- **CI/CD:** ${profile.ciCd}`,
    `- **Package Manager:** ${profile.packageManager}`,
    `- **Test Runner:** ${profile.testRunner}`,
    `- **Linter:** ${profile.linter}`,
    `- **Project Structure:** ${profile.projectStructure}`,
    `- **AI Model:** ${profile.aiModel}`,
  ];
  return lines.join("\n");
}

/**
 * Build the user message for the viability assessment.
 */
export function buildUserMessage(idea: string, profile: DeveloperProfile): string {
  const profileContext = formatProfileContext(profile);
  return `${profileContext}\n\n## Project Idea\n\n${idea}`;
}

/**
 * Extract the recommendation from the assessment text.
 *
 * Looks for **PROCEED**, **CONCERNS**, or **RECONSIDER** in the
 * Recommendation section. Falls back to CONCERNS if not found.
 */
export function extractRecommendation(text: string): ViabilityRecommendation {
  // Look for the recommendation pattern in the text
  const proceedMatch = /\*\*PROCEED\*\*/i.test(text);
  const reconsiderMatch = /\*\*RECONSIDER\*\*/i.test(text);
  const concernsMatch = /\*\*CONCERNS\*\*/i.test(text);

  if (proceedMatch && !reconsiderMatch && !concernsMatch) return "PROCEED";
  if (reconsiderMatch) return "RECONSIDER";
  if (concernsMatch) return "CONCERNS";

  // Try unformatted patterns
  if (/recommendation[:\s]*proceed/i.test(text)) return "PROCEED";
  if (/recommendation[:\s]*reconsider/i.test(text)) return "RECONSIDER";
  if (/recommendation[:\s]*concerns/i.test(text)) return "CONCERNS";

  return "CONCERNS";
}

/**
 * Save the viability assessment to .boop/planning/viability.md
 */
export function saveAssessment(projectDir: string, assessment: string): string {
  const planningDir = path.join(projectDir, ".boop", "planning");
  fs.mkdirSync(planningDir, { recursive: true });

  const filePath = path.join(planningDir, "viability.md");
  fs.writeFileSync(filePath, assessment, "utf-8");
  return filePath;
}

/**
 * Run the viability assessment for a project idea.
 *
 * Calls Claude with the viability system prompt and the developer's
 * profile context. Retries on transient API errors.
 */
export async function assessViability(
  idea: string,
  profile: DeveloperProfile,
  options: ViabilityOptions = {},
): Promise<ViabilityResult> {
  const systemPrompt = loadSystemPrompt(options.promptDir);
  const userMessage = buildUserMessage(idea, profile);
  const projectDir = options.projectDir ?? process.cwd();

  const clientOptions: ClaudeClientOptions = {
    model: profile.aiModel || undefined,
    maxTokens: 4096,
    ...options.clientOptions,
  };

  const response = await retry(
    () => sendMessage(clientOptions, systemPrompt, [{ role: "user", content: userMessage }]),
    {
      maxRetries: 1,
      isRetryable: isRetryableApiError,
    },
  );

  const recommendation = extractRecommendation(response.text);

  // Save to .boop/planning/viability.md
  saveAssessment(projectDir, response.text);

  return {
    idea,
    assessment: response.text,
    recommendation,
    usage: response.usage,
  };
}
