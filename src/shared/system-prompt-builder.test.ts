import { describe, expect, it } from "vitest";
import { buildCacheableSystemPrompt } from "./system-prompt-builder.js";

describe("buildCacheableSystemPrompt", () => {
  it("returns single cached block for base-only prompt", () => {
    const blocks = buildCacheableSystemPrompt("You are a helpful assistant.");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("text");
    expect(blocks[0]!.text).toBe("You are a helpful assistant.");
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("returns two blocks when dynamic sections exist", () => {
    const blocks = buildCacheableSystemPrompt("Base prompt.", ["Rule 1: do X", "Rule 2: do Y"]);

    expect(blocks).toHaveLength(2);
    // First block: cached base
    expect(blocks[0]!.text).toBe("Base prompt.");
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral" });
    // Second block: uncached dynamic
    expect(blocks[1]!.text).toBe("Rule 1: do X\nRule 2: do Y");
    expect(blocks[1]!.cache_control).toBeUndefined();
  });

  it("returns single cached block when dynamic array is empty", () => {
    const blocks = buildCacheableSystemPrompt("Base prompt.", []);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("returns single cached block when dynamic array is undefined", () => {
    const blocks = buildCacheableSystemPrompt("Base prompt.", undefined);

    expect(blocks).toHaveLength(1);
  });

  it("filters out empty dynamic sections", () => {
    const blocks = buildCacheableSystemPrompt("Base.", ["", "Non-empty section", ""]);

    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.text).toBe("Non-empty section");
  });
});
