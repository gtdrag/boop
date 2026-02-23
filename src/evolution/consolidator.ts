/**
 * Heuristic consolidator — synthesize memory into condensed heuristics.
 *
 * Processes accumulated memory entries, review rules, and architectural
 * decisions via a Claude call to produce validated, confidence-scored
 * heuristics. Heuristics decay over time and are filtered by phase
 * and stack relevance for prompt injection.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import type { PlanningSubPhase } from "../shared/types.js";
import type { DeveloperProfile } from "../profile/schema.js";
import type { ReviewRule } from "../review/adversarial/review-rules.js";
import type { ArchDecision } from "./arch-decisions.js";
import type { MemoryEntry } from "../retrospective/reporter.js";
import type { ClaudeClientOptions } from "../shared/index.js";
import { sendMessage, isRetryableApiError, retry } from "../shared/index.js";
import { extractStackKeywords } from "./stack-matcher.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeuristicCategory =
  | "planning"
  | "architecture"
  | "build"
  | "review"
  | "testing"
  | "deployment"
  | "security";

export interface Heuristic {
  /** Hash of normalized text. */
  id: string;
  /** Condensed heuristic statement. */
  text: string;
  category: HeuristicCategory;
  /** Confidence score 0.0-1.0. */
  confidence: number;
  /** Tech-stack components this applies to. Empty = universal. */
  stackComponents: string[];
  /** How many memory entries contributed. */
  sourceCount: number;
  sourceProjects: string[];
  createdAt: string;
  lastValidated: string;
}

export interface HeuristicStore {
  version: string;
  heuristics: Heuristic[];
  /** ISO date of last consolidation, empty string if never consolidated. */
  lastConsolidation: string;
}

export interface ConsolidationResult {
  added: Heuristic[];
  updated: Heuristic[];
  /** IDs removed due to staleness. */
  pruned: string[];
  total: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MEMORY_DIR = path.join(os.homedir(), ".boop", "memory");
const HEURISTICS_FILE = "heuristics.yaml";

const PHASE_CATEGORY_MAP: Record<PlanningSubPhase, HeuristicCategory[]> = {
  viability: ["planning"],
  prd: ["planning"],
  architecture: ["architecture", "deployment", "security"],
  stories: ["planning", "build", "testing"],
};

const MAX_HEURISTICS_PER_PHASE = 8;
const MIN_CONFIDENCE_FOR_QUERY = 0.5;
const DECAY_THRESHOLD = 0.3;
const DECAY_PER_MONTH = 0.05;
const CONFIDENCE_INCREMENT = 0.1;

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateId(text: string): string {
  return crypto
    .createHash("sha256")
    .update(text.toLowerCase().trim())
    .digest("hex")
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export function loadHeuristicStore(memoryDir?: string): HeuristicStore {
  const dir = memoryDir ?? DEFAULT_MEMORY_DIR;
  const filePath = path.join(dir, HEURISTICS_FILE);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(raw) as HeuristicStore;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.heuristics)) {
      return { version: "1", heuristics: [], lastConsolidation: "" };
    }
    return parsed;
  } catch {
    return { version: "1", heuristics: [], lastConsolidation: "" };
  }
}

export function saveHeuristicStore(store: HeuristicStore, memoryDir?: string): string {
  const dir = memoryDir ?? DEFAULT_MEMORY_DIR;
  const filePath = path.join(dir, HEURISTICS_FILE);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(store), "utf-8");

  return filePath;
}

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

function buildConsolidationPrompt(
  memoryEntries: MemoryEntry[],
  reviewRules: ReviewRule[],
  archDecisions: ArchDecision[],
): string {
  const sections: string[] = [];

  if (memoryEntries.length > 0) {
    sections.push("## Memory Entries\n");
    for (const entry of memoryEntries) {
      sections.push(`- [${entry.type}] ${entry.description} (project: ${entry.project}, date: ${entry.date})`);
    }
  }

  if (reviewRules.length > 0) {
    sections.push("\n## Review Rules\n");
    for (const rule of reviewRules) {
      sections.push(
        `- ${rule.description} (severity: ${rule.severity}, agent: ${rule.sourceAgent}, seen ${rule.timesSeen} times across ${rule.projects.length} projects)`,
      );
    }
  }

  if (archDecisions.length > 0) {
    sections.push("\n## Architecture Decisions\n");
    for (const decision of archDecisions) {
      sections.push(`- ${decision.title}: ${decision.decision} (outcome: ${decision.outcome}, ${decision.outcomeType})`);
    }
  }

  return sections.join("\n");
}

const SYSTEM_PROMPT = `You are a development heuristics synthesizer. Given a corpus of project memory entries, review rules, and architecture decisions, synthesize condensed, actionable heuristics.

Output a JSON array of objects with these fields:
- "text": a concise actionable statement (e.g. "Always add rate limiting to public APIs")
- "category": one of "planning", "architecture", "build", "review", "testing", "deployment", "security"
- "confidence": 0.0-1.0 based on how strongly the evidence supports this
- "stackComponents": array of tech-stack keywords this applies to (empty array for universal heuristics)
- "sourceCount": how many input entries support this heuristic

Rules:
- Produce 5-15 heuristics maximum
- Focus on patterns seen across multiple entries or projects
- Higher confidence for patterns with more supporting evidence
- Keep text concise (under 80 characters ideally)
- Only output the JSON array, no other text`;

interface ClaudeHeuristic {
  text: string;
  category: HeuristicCategory;
  confidence: number;
  stackComponents: string[];
  sourceCount: number;
}

export async function consolidate(
  memoryEntries: MemoryEntry[],
  reviewRules: ReviewRule[],
  archDecisions: ArchDecision[],
  existing: HeuristicStore,
  clientOptions?: ClaudeClientOptions,
): Promise<ConsolidationResult> {
  const corpusPrompt = buildConsolidationPrompt(memoryEntries, reviewRules, archDecisions);

  const response = await retry(
    () =>
      sendMessage(clientOptions ?? {}, SYSTEM_PROMPT, [
        { role: "user", content: corpusPrompt },
      ]),
    { maxRetries: 2, isRetryable: isRetryableApiError },
  );

  // Parse JSON array from response
  const jsonMatch = response.text.match(/\[[\s\S]*\]/);
  const parsed: ClaudeHeuristic[] = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

  const now = new Date().toISOString();
  const added: Heuristic[] = [];
  const updated: Heuristic[] = [];

  // Build index of existing heuristics by normalized text (deep copy to avoid mutating caller's store)
  const existingByText = new Map<string, Heuristic>();
  for (const h of existing.heuristics) {
    existingByText.set(h.text.toLowerCase().trim(), { ...h, sourceProjects: [...h.sourceProjects] });
  }

  // Collect all source projects from inputs
  const inputProjects = new Set<string>();
  for (const entry of memoryEntries) {
    inputProjects.add(entry.project);
  }
  for (const rule of reviewRules) {
    for (const proj of rule.projects) {
      inputProjects.add(proj);
    }
  }
  const projectList = [...inputProjects];

  for (const raw of parsed) {
    const normalized = raw.text.toLowerCase().trim();
    const match = existingByText.get(normalized);

    if (match) {
      // Update existing: increment confidence, add source projects
      match.confidence = Math.min(match.confidence + CONFIDENCE_INCREMENT, 1.0);
      match.lastValidated = now;
      for (const proj of projectList) {
        if (!match.sourceProjects.includes(proj)) {
          match.sourceProjects.push(proj);
        }
      }
      match.sourceCount += raw.sourceCount;
      updated.push(match);
    } else {
      // Add new heuristic
      const heuristic: Heuristic = {
        id: generateId(raw.text),
        text: raw.text,
        category: raw.category,
        confidence: Math.min(Math.max(raw.confidence, 0), 1.0),
        stackComponents: raw.stackComponents ?? [],
        sourceCount: raw.sourceCount,
        sourceProjects: projectList,
        createdAt: now,
        lastValidated: now,
      };
      added.push(heuristic);
      existingByText.set(normalized, heuristic);
    }
  }

  // Merge: keep existing that weren't updated + updated + added
  const updatedIds = new Set(updated.map((h) => h.id));
  const kept = existing.heuristics.filter((h) => !updatedIds.has(h.id));
  const allHeuristics = [...kept, ...updated, ...added];

  // Apply decay
  const decayed = applyDecay(allHeuristics, new Date(now));
  const prunedIds = allHeuristics
    .filter((h) => !decayed.includes(h))
    .map((h) => h.id);

  return {
    added,
    updated,
    pruned: prunedIds,
    total: decayed.length,
  };
}

// ---------------------------------------------------------------------------
// Decay
// ---------------------------------------------------------------------------

export function applyDecay(heuristics: Heuristic[], now?: Date): Heuristic[] {
  const currentDate = now ?? new Date();

  const result: Heuristic[] = [];

  for (const h of heuristics) {
    const lastValidated = new Date(h.lastValidated);
    const monthsDiff =
      (currentDate.getUTCFullYear() - lastValidated.getUTCFullYear()) * 12 +
      (currentDate.getUTCMonth() - lastValidated.getUTCMonth());

    const decay = monthsDiff * DECAY_PER_MONTH;
    const newConfidence = h.confidence - decay;

    if (newConfidence >= DECAY_THRESHOLD) {
      result.push({ ...h, confidence: newConfidence });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export function queryForPhase(
  store: HeuristicStore,
  phase: PlanningSubPhase,
  profile: DeveloperProfile,
): Heuristic[] {
  const categories = PHASE_CATEGORY_MAP[phase];
  const stackKeywords = extractStackKeywords(profile);

  const matching = store.heuristics.filter((h) => {
    // Must match category
    if (!categories.includes(h.category)) return false;

    // Exclude low confidence
    if (h.confidence < MIN_CONFIDENCE_FOR_QUERY) return false;

    // Universal heuristics always included
    if (h.stackComponents.length === 0) return true;

    // Check stack overlap
    return h.stackComponents.some((comp) =>
      stackKeywords.some(
        (kw) => kw.toLowerCase() === comp.toLowerCase(),
      ),
    );
  });

  // Sort by confidence DESC, take max
  return matching
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_HEURISTICS_PER_PHASE);
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

export function formatHeuristicsForPrompt(heuristics: Heuristic[]): string {
  if (heuristics.length === 0) return "";

  // Cap at 12 to stay within ~300 tokens
  const capped = heuristics.slice(0, 12);

  const lines: string[] = [
    "## Validated Heuristics",
    "",
    "High-confidence patterns from past projects:",
  ];

  for (const h of capped) {
    const projectCount = h.sourceProjects.length;
    lines.push(
      `- ${h.text} (confidence: ${h.confidence.toFixed(1)}, ${projectCount} project${projectCount === 1 ? "" : "s"})`,
    );
  }

  return lines.join("\n");
}
