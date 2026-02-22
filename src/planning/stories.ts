/**
 * Epic & story breakdown — fourth phase of the planning pipeline.
 *
 * Decomposes the PRD and architecture into sequentially ordered
 * epics and stories that a dev agent can implement one at a time.
 */
import fs from "node:fs";
import path from "node:path";
import {
  sendMessage,
  isRetryableApiError,
  retry,
  resolveModel,
  buildCacheableSystemPrompt,
} from "../shared/index.js";
import type { ClaudeClientOptions, ClaudeResponse } from "../shared/index.js";
import type { DeveloperProfile } from "../profile/schema.js";
import type { ReviewRule } from "../review/adversarial/review-rules.js";
import type { Heuristic } from "../evolution/consolidator.js";
import { augmentPrompt } from "../evolution/outcome-injector.js";
import { formatHeuristicsForPrompt } from "../evolution/consolidator.js";
import { formatProfileContext } from "./viability.js";

export interface StoriesResult {
  /** The generated epics/stories markdown text. */
  stories: string;
  /** Token usage from the API call. */
  usage: ClaudeResponse["usage"];
}

export interface StoriesOptions {
  /** Claude API client options. */
  clientOptions?: ClaudeClientOptions;
  /** Directory containing the prompt templates. Defaults to prompts/stories/. */
  promptDir?: string;
  /** Project directory for saving output. Defaults to cwd. */
  projectDir?: string;
  /** Review rules to inject as lessons from past reviews. */
  reviewRules?: ReviewRule[];
  /** Validated heuristics to inject from cross-project consolidation. */
  heuristics?: Heuristic[];
}

const PROMPTS_DIR = fs.existsSync(path.resolve(import.meta.dirname, "prompts", "stories"))
  ? path.resolve(import.meta.dirname, "prompts", "stories")
  : path.resolve(import.meta.dirname, "..", "..", "prompts", "stories");

/**
 * Load the stories system prompt from the prompts directory.
 */
export function loadSystemPrompt(promptDir?: string): string {
  const dir = promptDir ?? PROMPTS_DIR;
  const systemPath = path.join(dir, "system.md");
  return fs.readFileSync(systemPath, "utf-8");
}

/**
 * Build the user message for epic/story breakdown.
 *
 * Includes the developer profile, original idea, PRD, and architecture
 * so the stories build on all prior phase outputs.
 */
export function buildUserMessage(
  idea: string,
  profile: DeveloperProfile,
  prd: string,
  architecture: string,
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
    "",
    "## Architecture Document",
    "",
    architecture,
  ];
  return lines.join("\n");
}

/**
 * Save the epics/stories document to .boop/planning/epics.md
 */
export function saveStories(projectDir: string, stories: string): string {
  const planningDir = path.join(projectDir, ".boop", "planning");
  fs.mkdirSync(planningDir, { recursive: true });

  const filePath = path.join(planningDir, "epics.md");
  fs.writeFileSync(filePath, stories, "utf-8");
  return filePath;
}

/**
 * Load the architecture from .boop/planning/architecture.md
 *
 * Returns the architecture text, or null if the file doesn't exist.
 */
export function loadArchitecture(projectDir: string): string | null {
  const filePath = path.join(projectDir, ".boop", "planning", "architecture.md");
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Generate epic and story breakdown from the idea, PRD, architecture, and developer profile.
 *
 * Calls Claude with the stories system prompt and chains all prior phase
 * outputs as input context. Retries on transient API errors.
 */
export async function generateStories(
  idea: string,
  profile: DeveloperProfile,
  prd: string,
  architecture: string,
  options: StoriesOptions = {},
): Promise<StoriesResult> {
  const basePrompt = loadSystemPrompt(options.promptDir);
  const dynamic: string[] = [];
  if (options.reviewRules && options.reviewRules.length > 0) {
    dynamic.push(augmentPrompt("", options.reviewRules, "stories", profile));
  }
  if (options.heuristics && options.heuristics.length > 0) {
    dynamic.push(formatHeuristicsForPrompt(options.heuristics));
  }
  const systemPrompt = buildCacheableSystemPrompt(basePrompt, dynamic.length ? dynamic : undefined);
  const userMessage = buildUserMessage(idea, profile, prd, architecture);
  const projectDir = options.projectDir ?? process.cwd();

  const clientOptions: ClaudeClientOptions = {
    model: resolveModel("planning", profile),
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

  // Save to .boop/planning/epics.md
  saveStories(projectDir, response.text);

  return {
    stories: response.text,
    usage: response.usage,
  };
}
