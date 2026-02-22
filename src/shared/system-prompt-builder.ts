/**
 * System prompt builder — structures prompts for Anthropic prompt caching.
 *
 * The Anthropic API caches system prompt blocks that have `cache_control`
 * set. Stable base prompts (loaded from files) get cached; dynamic sections
 * (review rules, heuristics) are appended without caching so they don't
 * invalidate the cache on every call.
 *
 * Cached input tokens are 90% cheaper ($1.50/M vs $15/M for Opus).
 */

/** A system prompt block compatible with the Anthropic Messages API. */
export interface SystemPromptBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/**
 * Build a cacheable system prompt from a stable base and optional dynamic sections.
 *
 * @param stableBase - The main prompt text (loaded from file). Gets cache_control.
 * @param dynamicSections - Optional dynamic text (review rules, heuristics). Not cached.
 * @returns Array of SystemPromptBlock for the Anthropic API.
 */
export function buildCacheableSystemPrompt(
  stableBase: string,
  dynamicSections?: string[],
): SystemPromptBlock[] {
  const blocks: SystemPromptBlock[] = [
    {
      type: "text",
      text: stableBase,
      cache_control: { type: "ephemeral" },
    },
  ];

  const filtered = dynamicSections?.filter((s) => s.length > 0);
  if (filtered && filtered.length > 0) {
    blocks.push({
      type: "text",
      text: filtered.join("\n"),
    });
  }

  return blocks;
}
