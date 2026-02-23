/**
 * Shared Claude API helper for planning modules.
 *
 * Extracts the common boilerplate: dynamic prompt assembly, model routing,
 * cacheable system prompt building, and retried API calls.
 */
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
import type { ArchDecision } from "../evolution/arch-decisions.js";
import { augmentPrompt } from "../evolution/outcome-injector.js";
import { formatHeuristicsForPrompt } from "../evolution/consolidator.js";
import { formatDecisionsForPrompt } from "../evolution/arch-decisions.js";
import type { PlanningSubPhase } from "../shared/types.js";

export interface PlanningCallOptions {
  /** The planning sub-phase (used for review rule injection). */
  phase: PlanningSubPhase;
  /** Base system prompt loaded from the prompts directory. */
  basePrompt: string;
  /** User message content. */
  userMessage: string;
  /** Developer profile for model routing. */
  profile: DeveloperProfile;
  /** Claude API client options overrides. */
  clientOptions?: ClaudeClientOptions;
  /** Max tokens for the response. Defaults to 4096. */
  maxTokens?: number;
  /** Review rules to inject as lessons from past reviews. */
  reviewRules?: ReviewRule[];
  /** Validated heuristics to inject from cross-project consolidation. */
  heuristics?: Heuristic[];
  /** Past architecture decisions (only used by architecture phase). */
  archDecisions?: ArchDecision[];
}

/**
 * Call Claude with the standard planning module boilerplate:
 * - Assembles dynamic prompt sections (review rules, heuristics, arch decisions)
 * - Builds a cacheable system prompt
 * - Routes to the correct model via profile
 * - Retries once on transient API errors
 */
export async function callPlanningClaude(options: PlanningCallOptions): Promise<ClaudeResponse> {
  const dynamic: string[] = [];
  if (options.reviewRules && options.reviewRules.length > 0) {
    dynamic.push(augmentPrompt("", options.reviewRules, options.phase, options.profile));
  }
  if (options.archDecisions && options.archDecisions.length > 0) {
    dynamic.push(formatDecisionsForPrompt(options.archDecisions));
  }
  if (options.heuristics && options.heuristics.length > 0) {
    dynamic.push(formatHeuristicsForPrompt(options.heuristics));
  }

  const systemPrompt = buildCacheableSystemPrompt(
    options.basePrompt,
    dynamic.length ? dynamic : undefined,
  );

  const clientOpts: ClaudeClientOptions = {
    model: resolveModel("planning", options.profile),
    maxTokens: options.maxTokens ?? 4096,
    ...options.clientOptions,
  };

  return retry(
    () => sendMessage(clientOpts, systemPrompt, [{ role: "user", content: options.userMessage }]),
    {
      maxRetries: 1,
      isRetryable: isRetryableApiError,
    },
  );
}
