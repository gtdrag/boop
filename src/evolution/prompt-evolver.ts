/**
 * Prompt evolution core — generate, validate, and promote prompt improvements.
 *
 * Uses benchmark results to identify underperforming phases, asks Claude
 * to propose prompt edits, validates against a baseline benchmark run,
 * and promotes winning variants via the prompt-history version system.
 */
import fs from "node:fs";
import path from "node:path";

import type { PlanningSubPhase } from "../shared/types.js";
import type { ClaudeClientOptions, ClaudeResponse } from "../shared/claude-client.js";
import type { BenchmarkResult } from "../benchmark/types.js";
import { sendMessage, isRetryableApiError, retry } from "../shared/index.js";
import { compareRuns } from "../benchmark/compare.js";
import { saveVersion } from "./prompt-history.js";
import type { PromptVersion } from "./prompt-history.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvolutionProposal {
  /** Target planning sub-phase. */
  phase: PlanningSubPhase;
  /** The proposed new prompt content. */
  content: string;
  /** Why this change should improve results. */
  rationale: string;
  /** Which benchmark weaknesses this addresses. */
  targetWeaknesses: string[];
}

export interface EvolutionResult {
  /** Proposals that were generated. */
  proposals: EvolutionProposal[];
  /** Proposals that passed validation (no regressions). */
  promoted: EvolutionProposal[];
  /** Proposals that failed validation. */
  rejected: Array<{ proposal: EvolutionProposal; reason: string }>;
  /** Prompt versions created for promoted proposals. */
  versions: PromptVersion[];
}

export interface EvolutionOptions {
  /** Claude API client options. */
  clientOptions?: ClaudeClientOptions;
  /** Directory containing prompt files (prompts/{phase}/system.md). */
  promptsDir: string;
  /** Memory directory for prompt versions. */
  memoryDir?: string;
  /** Callback to run a benchmark and return the result. */
  runBenchmark: () => Promise<BenchmarkResult>;
  /** Maximum number of proposals to generate per phase. */
  maxProposals?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a prompt engineering expert. Given a current system prompt for a planning phase and benchmark results showing its performance, propose an improved version.

Output a JSON object with these fields:
- "content": the full improved prompt text
- "rationale": why this change should improve results (1-2 sentences)
- "targetWeaknesses": array of specific weaknesses this addresses

Rules:
- Keep the improved prompt roughly the same length (within 20%)
- Preserve the core structure and instructions
- Focus on clarity, specificity, and reducing ambiguity
- Address concrete issues shown in the benchmark results
- Only output the JSON object, no other text`;

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Generate improvement proposals for underperforming phases.
 *
 * Reads current prompts and analyzes benchmark results to identify
 * phases that could benefit from prompt improvements.
 */
export async function generateProposals(
  baseline: BenchmarkResult,
  phases: PlanningSubPhase[],
  options: Pick<EvolutionOptions, "clientOptions" | "promptsDir" | "maxProposals">,
): Promise<EvolutionProposal[]> {
  const maxProposals = options.maxProposals ?? 1;
  const proposals: EvolutionProposal[] = [];

  for (const phase of phases) {
    const promptPath = path.join(options.promptsDir, phase, "system.md");
    if (!fs.existsSync(promptPath)) continue;

    const currentPrompt = fs.readFileSync(promptPath, "utf-8");
    const phaseResults = summarizePhaseResults(baseline, phase);

    const userMessage = [
      `## Current Prompt for "${phase}" phase\n`,
      "```",
      currentPrompt,
      "```\n",
      `## Benchmark Results\n`,
      phaseResults,
      `\nGenerate up to ${maxProposals} improvement proposal(s).`,
    ].join("\n");

    let response: ClaudeResponse;
    try {
      response = await retry(
        () =>
          sendMessage(options.clientOptions ?? {}, SYSTEM_PROMPT, [
            { role: "user", content: userMessage },
          ]),
        { maxRetries: 2, isRetryable: isRetryableApiError },
      );
    } catch {
      continue;
    }

    const parsed = parseProposalResponse(response.text, phase);
    if (parsed) {
      proposals.push(parsed);
    }
  }

  return proposals;
}

/**
 * Validate a proposal by running a benchmark and comparing against baseline.
 *
 * Returns null if no regressions, or a reason string if regressions found.
 */
export async function validateProposal(
  proposal: EvolutionProposal,
  baseline: BenchmarkResult,
  options: Pick<EvolutionOptions, "promptsDir" | "runBenchmark">,
): Promise<string | null> {
  const promptPath = path.join(options.promptsDir, proposal.phase, "system.md");

  // Save original prompt
  const original = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, "utf-8") : null;

  try {
    // Write proposed prompt
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, proposal.content);

    // Run benchmark with proposed prompt
    const result = await options.runBenchmark();

    // Compare against baseline
    const comparison = compareRuns(baseline, result);

    if (comparison.regressions.length > 0) {
      const reasons = comparison.regressions.map((r) => r.message);
      return `Regressions detected: ${reasons.join("; ")}`;
    }

    return null;
  } finally {
    // Restore original prompt
    if (original !== null) {
      fs.writeFileSync(promptPath, original);
    } else if (fs.existsSync(promptPath)) {
      fs.unlinkSync(promptPath);
    }
  }
}

/**
 * Promote a validated proposal by saving a version and updating the live prompt.
 */
export function promoteProposal(
  proposal: EvolutionProposal,
  options: Pick<EvolutionOptions, "promptsDir" | "memoryDir">,
): PromptVersion {
  // Save version in history
  const version = saveVersion(
    proposal.phase,
    proposal.content,
    proposal.rationale,
    options.memoryDir,
  );

  // Write to live prompt file
  const promptPath = path.join(options.promptsDir, proposal.phase, "system.md");
  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  fs.writeFileSync(promptPath, proposal.content);

  return version;
}

/**
 * Run the full evolution cycle: generate, validate, promote.
 */
export async function runEvolution(
  baseline: BenchmarkResult,
  phases: PlanningSubPhase[],
  options: EvolutionOptions,
): Promise<EvolutionResult> {
  const proposals = await generateProposals(baseline, phases, options);

  const promoted: EvolutionProposal[] = [];
  const rejected: Array<{ proposal: EvolutionProposal; reason: string }> = [];
  const versions: PromptVersion[] = [];

  for (const proposal of proposals) {
    const rejection = await validateProposal(proposal, baseline, options);

    if (rejection === null) {
      const version = promoteProposal(proposal, options);
      promoted.push(proposal);
      versions.push(version);
    } else {
      rejected.push({ proposal, reason: rejection });
    }
  }

  return { proposals, promoted, rejected, versions };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizePhaseResults(result: BenchmarkResult, phase: PlanningSubPhase): string {
  const lines: string[] = [];
  let totalCases = 0;
  let phaseSeen = 0;
  let phaseSucceeded = 0;
  let totalDurationMs = 0;
  let totalTokens = 0;

  for (const c of result.cases) {
    totalCases++;
    const phaseMetric = c.phases.find((p) => p.phase === phase);
    if (phaseMetric) {
      phaseSeen++;
      if (phaseMetric.success) phaseSucceeded++;
      totalDurationMs += phaseMetric.durationMs;
      totalTokens += phaseMetric.tokenUsage.inputTokens + phaseMetric.tokenUsage.outputTokens;
    }
  }

  lines.push(`- Total cases: ${totalCases}`);
  lines.push(`- Cases reaching "${phase}": ${phaseSeen}`);
  lines.push(`- Success rate: ${phaseSeen > 0 ? ((phaseSucceeded / phaseSeen) * 100).toFixed(0) : 0}%`);
  lines.push(`- Avg duration: ${phaseSeen > 0 ? (totalDurationMs / phaseSeen).toFixed(0) : 0}ms`);
  lines.push(`- Avg tokens: ${phaseSeen > 0 ? (totalTokens / phaseSeen).toFixed(0) : 0}`);

  // Include error details
  for (const c of result.cases) {
    const phaseMetric = c.phases.find((p) => p.phase === phase);
    if (phaseMetric && !phaseMetric.success && phaseMetric.error) {
      lines.push(`- Error in case "${c.caseId}": ${phaseMetric.error}`);
    }
  }

  return lines.join("\n");
}

function parseProposalResponse(text: string, phase: PlanningSubPhase): EvolutionProposal | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      content?: string;
      rationale?: string;
      targetWeaknesses?: string[];
    };

    if (!parsed.content || typeof parsed.content !== "string") return null;

    return {
      phase,
      content: parsed.content,
      rationale: parsed.rationale ?? "No rationale provided",
      targetWeaknesses: Array.isArray(parsed.targetWeaknesses) ? parsed.targetWeaknesses : [],
    };
  } catch {
    return null;
  }
}
