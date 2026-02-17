/**
 * Shared Claude API client for Boop.
 *
 * Wraps the Anthropic SDK with retry logic and structured response handling.
 * Used by all planning phases (viability, PRD, architecture, stories).
 */
import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-opus-4-6";
const DEFAULT_MAX_TOKENS = 4096;

export interface ClaudeClientOptions {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Model ID override. Defaults to claude-opus-4-6-20250929. */
  model?: string;
  /** Max tokens for the response. Defaults to 4096. */
  maxTokens?: number;
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeResponse {
  /** The text content of the response. */
  text: string;
  /** Token usage from the API call. */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** The model that was used. */
  model: string;
}

/**
 * Create an Anthropic client instance.
 *
 * Uses ANTHROPIC_API_KEY from environment if no key is provided.
 */
export function createAnthropicClient(apiKey?: string): Anthropic {
  return new Anthropic({
    apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
  });
}

/**
 * Send a message to Claude and get a text response.
 *
 * @param options - Client options (API key, model, max tokens)
 * @param systemPrompt - System prompt to set Claude's behavior
 * @param messages - Conversation messages
 * @returns The text response from Claude
 */
export async function sendMessage(
  options: ClaudeClientOptions,
  systemPrompt: string,
  messages: ClaudeMessage[],
): Promise<ClaudeResponse> {
  const client = createAnthropicClient(options.apiKey);
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const text = textBlock?.type === "text" ? textBlock.text : "";

  return {
    text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    model: response.model,
  };
}

/**
 * Check if an error from the Anthropic SDK is retryable.
 *
 * Retryable errors: rate limits (429), server errors (500+), timeouts.
 * Non-retryable: auth errors (401), bad requests (400), etc.
 */
export function isRetryableApiError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    // Rate limited or server error — retry
    if (status === 429 || status >= 500) return true;
    // Client errors — don't retry
    return false;
  }
  // Network errors, timeouts — retry
  if (error instanceof Error && error.message.includes("fetch")) return true;
  return false;
}
