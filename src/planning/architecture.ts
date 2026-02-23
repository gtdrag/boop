/**
 * Architecture generation — third phase of the planning pipeline.
 *
 * Generates architecture decisions from the PRD and developer profile
 * using Claude. Most decisions are auto-resolved from the profile;
 * only genuinely novel choices are escalated.
 */
import fs from "node:fs";
import path from "node:path";
import type { ClaudeResponse } from "../shared/index.js";
import type { ClaudeClientOptions } from "../shared/index.js";
import type { DeveloperProfile } from "../profile/schema.js";
import type { ReviewRule } from "../review/adversarial/review-rules.js";
import type { ArchDecision } from "../evolution/arch-decisions.js";
import type { Heuristic } from "../evolution/consolidator.js";
import { callPlanningClaude } from "./claude-helper.js";
import { formatProfileContext } from "./viability.js";

/** Machine-readable stack summary extracted from architecture output. */
export interface StackSummary {
  frontend?: { framework?: string; styling?: string };
  backend?: { framework?: string; apiPattern?: string };
  database?: { primary?: string; orm?: string };
  infrastructure?: { cloudProvider?: string; ciCd?: string };
  auth?: { strategy?: string };
  requiredServices?: string[];
  requiredCredentials?: string[];
}

/**
 * Extract the stack summary JSON block from architecture markdown.
 *
 * Looks for a fenced code block tagged `json:stack-summary`.
 * Returns null if the block is missing or malformed.
 */
export function extractStackSummary(markdown: string): StackSummary | null {
  const pattern = /```json:stack-summary\s*\n([\s\S]*?)```/;
  const match = pattern.exec(markdown);
  if (!match?.[1]) return null;

  try {
    return JSON.parse(match[1]) as StackSummary;
  } catch {
    return null;
  }
}

export interface ArchitectureResult {
  /** The generated architecture markdown text. */
  architecture: string;
  /** Token usage from the API call. */
  usage: ClaudeResponse["usage"];
  /** Structured stack summary extracted from the architecture output. */
  stackSummary: StackSummary | null;
}

export interface ArchitectureOptions {
  /** Claude API client options. */
  clientOptions?: ClaudeClientOptions;
  /** Directory containing the prompt templates. Defaults to prompts/architecture/. */
  promptDir?: string;
  /** Project directory for saving output. Defaults to cwd. */
  projectDir?: string;
  /** Review rules to inject as lessons from past reviews. */
  reviewRules?: ReviewRule[];
  /** Past architecture decisions relevant to the developer's stack. */
  archDecisions?: ArchDecision[];
  /** Validated heuristics to inject from cross-project consolidation. */
  heuristics?: Heuristic[];
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
export function buildUserMessage(idea: string, profile: DeveloperProfile, prd: string): string {
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
  const projectDir = options.projectDir ?? process.cwd();

  const response = await callPlanningClaude({
    phase: "architecture",
    basePrompt: loadSystemPrompt(options.promptDir),
    userMessage: buildUserMessage(idea, profile, prd),
    profile,
    clientOptions: options.clientOptions,
    maxTokens: 8192,
    reviewRules: options.reviewRules,
    heuristics: options.heuristics,
    archDecisions: options.archDecisions,
  });

  // Save to .boop/planning/architecture.md
  saveArchitecture(projectDir, response.text);

  return {
    architecture: response.text,
    usage: response.usage,
    stackSummary: extractStackSummary(response.text),
  };
}
