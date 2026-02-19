/**
 * Architecture decision records — capture, store, retrieve, and inject.
 *
 * Persists decisions to ~/.boop/memory/arch-decisions.yaml and provides
 * query/merge/format utilities for injecting relevant decisions into
 * planning prompts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import type { DeveloperProfile } from "../profile/schema.js";
import type { RetrospectiveData } from "../retrospective/analyzer.js";
import type { ClaudeClientOptions } from "../shared/index.js";
import { sendMessage } from "../shared/index.js";
import { extractStackKeywords } from "./stack-matcher.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArchDecisionCategory =
  | "database"
  | "orm"
  | "api-pattern"
  | "auth"
  | "caching"
  | "deployment"
  | "testing"
  | "state-management"
  | "error-handling"
  | "project-structure"
  | "other";

export interface ArchDecision {
  id: string;
  project: string;
  date: string;
  category: ArchDecisionCategory;
  title: string;
  decision: string;
  outcome: string;
  outcomeType: "positive" | "negative" | "neutral";
  stackComponents: string[];
  confidence: number;
}

export interface ArchDecisionStore {
  version: string;
  decisions: ArchDecision[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_MEMORY_DIR = path.join(os.homedir(), ".boop", "memory");
const STORE_FILE = "arch-decisions.yaml";

/** Slugify a title for use as an ID. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normalize a title for deduplication. */
function normalizeTitle(title: string): string {
  return title.toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Store I/O
// ---------------------------------------------------------------------------

export function loadDecisionStore(memoryDir?: string): ArchDecisionStore {
  const dir = memoryDir ?? DEFAULT_MEMORY_DIR;
  const filePath = path.join(dir, STORE_FILE);

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(content) as ArchDecisionStore | null;
    if (parsed && Array.isArray(parsed.decisions)) {
      return parsed;
    }
  } catch {
    // File missing or unreadable — return empty store
  }

  return { version: "1", decisions: [] };
}

export function saveDecisionStore(store: ArchDecisionStore, memoryDir?: string): string {
  const dir = memoryDir ?? DEFAULT_MEMORY_DIR;
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, STORE_FILE);
  fs.writeFileSync(filePath, YAML.stringify(store), "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export function mergeDecisions(
  existing: ArchDecision[],
  incoming: ArchDecision[],
): ArchDecision[] {
  const merged = [...existing];
  const titleIndex = new Map<string, number>();

  for (let i = 0; i < merged.length; i++) {
    titleIndex.set(normalizeTitle(merged[i]!.title), i);
  }

  for (const dec of incoming) {
    const norm = normalizeTitle(dec.title);
    const existingIdx = titleIndex.get(norm);

    if (existingIdx !== undefined) {
      const prev = merged[existingIdx]!;
      // Increment confidence (cap at 1.0)
      prev.confidence = Math.min(1.0, prev.confidence + 0.1);
      // Update outcome if new info provided
      if (dec.outcome && dec.outcome !== prev.outcome) {
        prev.outcome = dec.outcome;
        prev.outcomeType = dec.outcomeType;
      }
      // Track cross-project by appending project if not already present
      const projects = prev.project.split(", ");
      if (!projects.includes(dec.project)) {
        prev.project = [...projects, dec.project].join(", ");
      }
      // Update date to the more recent one
      if (dec.date > prev.date) {
        prev.date = dec.date;
      }
    } else {
      merged.push({ ...dec, id: slugify(dec.title) });
      titleIndex.set(norm, merged.length - 1);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export function queryRelevantDecisions(
  store: ArchDecisionStore,
  profile: DeveloperProfile,
  maxResults = 8,
): ArchDecision[] {
  const keywords = extractStackKeywords(profile);

  const relevant = store.decisions.filter((dec) => {
    // Universal decisions (empty stackComponents) always match
    if (dec.stackComponents.length === 0) return true;
    // At least one stack component must overlap
    return dec.stackComponents.some((comp) =>
      keywords.includes(comp.toLowerCase()),
    );
  });

  // Sort by confidence DESC, then by date DESC
  relevant.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.date.localeCompare(a.date);
  });

  return relevant.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

export function formatDecisionsForPrompt(decisions: ArchDecision[]): string {
  if (decisions.length === 0) return "";

  const lines = ["## Architecture Decisions from Previous Projects", ""];

  for (const dec of decisions) {
    lines.push(`### ${dec.title}`);
    lines.push(`- **Category:** ${dec.category}`);
    lines.push(`- **Decision:** ${dec.decision}`);
    lines.push(`- **Outcome:** ${dec.outcome} (${dec.outcomeType})`);
    lines.push(`- **Confidence:** ${dec.confidence.toFixed(1)}`);
    if (dec.stackComponents.length > 0) {
      lines.push(`- **Stack:** ${dec.stackComponents.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extract (Claude API call)
// ---------------------------------------------------------------------------

export async function extractDecisions(
  retroData: RetrospectiveData,
  architectureText: string,
  profile: DeveloperProfile,
  clientOptions?: ClaudeClientOptions,
): Promise<ArchDecision[]> {
  const today = new Date().toISOString().slice(0, 10);
  const projectName = retroData.projectName;

  const systemPrompt = `You are an architecture decision extractor. Analyze the architecture document and retrospective data to identify key architecture decisions that were made during the project. Return a JSON array of decision objects.

Each decision object must have these fields:
- id: string (slug from title)
- project: string (the project name)
- date: string (ISO date, use "${today}")
- category: one of "database", "orm", "api-pattern", "auth", "caching", "deployment", "testing", "state-management", "error-handling", "project-structure", "other"
- title: string (concise decision title)
- decision: string (what was decided)
- outcome: string (what happened as a result)
- outcomeType: "positive" | "negative" | "neutral"
- stackComponents: string[] (relevant tech stack components, lowercase)
- confidence: number (0.0-1.0, how confident you are this is a real decision)

Return ONLY a JSON array. No markdown fences, no explanation.`;

  const learnings = retroData.allLearnings.join("\n- ");
  const patterns = retroData.codebasePatterns.join("\n- ");

  const userContent = `Project: ${projectName}

## Architecture Document
${architectureText}

## Retrospective Learnings
- ${learnings || "None"}

## Codebase Patterns
- ${patterns || "None"}

## Developer Stack
Languages: ${profile.languages.join(", ")}
Frontend: ${profile.frontendFramework}
Backend: ${profile.backendFramework}
Database: ${profile.database}
Cloud: ${profile.cloudProvider}

Extract architecture decisions from the above. Return a JSON array.`;

  try {
    const response = await sendMessage(
      clientOptions ?? {},
      systemPrompt,
      [{ role: "user", content: userContent }],
    );

    return parseDecisionsFromResponse(response.text, projectName, today);
  } catch {
    return [];
  }
}

/** Parse a JSON array of decisions from Claude's response text. */
export function parseDecisionsFromResponse(
  text: string,
  projectName: string,
  date: string,
): ArchDecision[] {
  try {
    // Try to find a JSON array in the response
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];

    const parsed = JSON.parse(arrayMatch[0]) as unknown[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && "title" in item && "decision" in item,
      )
      .map((item) => ({
        id: slugify(String(item.title ?? "")),
        project: String(item.project ?? projectName),
        date: String(item.date ?? date),
        category: validateCategory(String(item.category ?? "other")),
        title: String(item.title ?? ""),
        decision: String(item.decision ?? ""),
        outcome: String(item.outcome ?? ""),
        outcomeType: validateOutcomeType(String(item.outcomeType ?? "neutral")),
        stackComponents: Array.isArray(item.stackComponents)
          ? item.stackComponents.map(String)
          : [],
        confidence: typeof item.confidence === "number"
          ? Math.min(1.0, Math.max(0.0, item.confidence))
          : 0.5,
      }));
  } catch {
    return [];
  }
}

const VALID_CATEGORIES = new Set<string>([
  "database", "orm", "api-pattern", "auth", "caching",
  "deployment", "testing", "state-management", "error-handling",
  "project-structure", "other",
]);

function validateCategory(cat: string): ArchDecisionCategory {
  return VALID_CATEGORIES.has(cat) ? (cat as ArchDecisionCategory) : "other";
}

function validateOutcomeType(t: string): "positive" | "negative" | "neutral" {
  if (t === "positive" || t === "negative" || t === "neutral") return t;
  return "neutral";
}
