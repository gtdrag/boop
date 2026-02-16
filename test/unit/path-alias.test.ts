/**
 * Verifies that the #boop/* path alias resolves correctly in test files.
 */
import { describe, expect, it } from "vitest";

import { PIPELINE_PHASES } from "#boop/shared/types.js";
import { VERSION } from "#boop/version.js";

describe("path alias #boop/*", () => {
  it("resolves shared/types via alias", () => {
    expect(Array.isArray(PIPELINE_PHASES)).toBe(true);
    expect(PIPELINE_PHASES).toContain("IDLE");
    expect(PIPELINE_PHASES).toContain("COMPLETE");
  });

  it("resolves version via alias", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
