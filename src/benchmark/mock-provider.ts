/**
 * Mock provider for dry-run benchmark mode.
 *
 * Loads canned markdown responses from fixtures and returns them
 * as if they were Claude API responses. Token counts are estimated
 * from text length (4 chars ≈ 1 token).
 */
import fs from "node:fs";
import path from "node:path";
import type { PlanningSubPhase } from "../shared/types.js";
import type { ClaudeResponse } from "../shared/claude-client.js";

/** Map of planning sub-phase to fixture filename. */
const PHASE_FIXTURE_MAP: Record<PlanningSubPhase, string> = {
  viability: "viability-proceed.md",
  prd: "prd-basic.md",
  architecture: "architecture-basic.md",
  stories: "stories-1-epic.md",
};

/** Estimate token count from text (rough 4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Load a mock response fixture for a planning sub-phase.
 *
 * @param phase - The planning sub-phase to load the fixture for.
 * @param fixturesDir - Directory containing mock response files.
 * @returns The fixture text content.
 */
export function loadFixture(phase: PlanningSubPhase, fixturesDir: string): string {
  const filename = PHASE_FIXTURE_MAP[phase];
  const filePath = path.join(fixturesDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Mock fixture not found: ${filePath}`);
  }

  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Create a mock sendMessage function for dry-run mode.
 *
 * Returns canned responses from fixtures. The returned function
 * has the same shape as ClaudeResponse so callers can treat it
 * like a real API call.
 *
 * @param fixturesDir - Directory containing mock-responses/ fixtures.
 */
export function createMockSendMessage(fixturesDir: string) {
  const cache = new Map<PlanningSubPhase, string>();

  return function mockSendMessage(phase: PlanningSubPhase): ClaudeResponse {
    let text = cache.get(phase);
    if (!text) {
      text = loadFixture(phase, fixturesDir);
      cache.set(phase, text);
    }

    const inputTokens = estimateTokens(text) + 500; // rough system prompt overhead
    const outputTokens = estimateTokens(text);

    return {
      text,
      usage: { inputTokens, outputTokens },
      model: "mock-dry-run",
    };
  };
}

/**
 * Resolve the default fixtures directory.
 *
 * Searches from the project root: benchmarks/fixtures/mock-responses/
 */
export function resolveFixturesDir(projectRoot: string): string {
  return path.join(projectRoot, "benchmarks", "fixtures", "mock-responses");
}
