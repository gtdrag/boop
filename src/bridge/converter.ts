/**
 * Converts parsed BMAD story breakdowns to Ralph's prd.json format.
 *
 * Takes the output of {@link parseStoryMarkdown} plus project metadata and
 * produces a {@link Prd} object ready to be serialized as `.boop/prd.json`.
 */

import fs from "node:fs";
import path from "node:path";
import type { Prd, Story } from "../shared/types.js";
import type { ParsedBreakdown, ParsedEpic, ParsedStory } from "./parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata needed to produce a complete Prd. */
export interface ProjectMetadata {
  /** Project name (e.g. "Boop"). */
  project: string;
  /** Git branch name for this epic's work. */
  branchName: string;
  /** High-level description of the epic being converted. */
  description: string;
}

/** Options for filtering which epic(s) to convert. */
export interface ConvertOptions {
  /** If set, only convert stories from the specified epic number. */
  epicNumber?: number;
}

// ---------------------------------------------------------------------------
// Quality-gate criteria that are always appended
// ---------------------------------------------------------------------------

const REQUIRED_CRITERIA = ["Typecheck passes", "All tests pass"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build implementation notes from a parsed story's technical notes and
 * prerequisites.
 */
function buildNotes(story: ParsedStory): string | undefined {
  const parts: string[] = [];

  if (story.technicalNotes.length > 0) {
    parts.push(story.technicalNotes.join(". "));
  }

  if (story.prerequisites.length > 0) {
    parts.push(`Depends on ${story.prerequisites.join(", ")} being complete.`);
  }

  return parts.length > 0 ? parts.join(". ") : undefined;
}

/**
 * Compute a global priority for a story based on its epic number and
 * position within that epic.
 *
 * Stories in earlier epics get lower (= higher priority) numbers.
 * Within an epic, priority follows the story order.
 */
function computePriority(epicIndex: number, storyIndex: number): number {
  // 1-based: epic 0 story 0 → priority 1, epic 0 story 1 → priority 2, etc.
  // We use epicIndex * 100 + storyIndex + 1 to leave room between epics.
  return epicIndex * 100 + storyIndex + 1;
}

/**
 * Ensure the required quality-gate criteria are present in the acceptance
 * criteria list. Appends any that are missing (case-insensitive check).
 */
function ensureRequiredCriteria(criteria: string[]): string[] {
  const result = [...criteria];
  const lowerSet = new Set(result.map((c) => c.toLowerCase()));

  for (const req of REQUIRED_CRITERIA) {
    if (!lowerSet.has(req.toLowerCase())) {
      result.push(req);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

/**
 * Convert a single parsed story to a Ralph {@link Story}.
 */
function convertStory(
  story: ParsedStory,
  epicIndex: number,
  storyIndex: number,
): Story {
  const result: Story = {
    id: story.id,
    title: story.title,
    description: story.userStory,
    acceptanceCriteria: ensureRequiredCriteria(story.acceptanceCriteria),
    priority: computePriority(epicIndex, storyIndex),
    passes: false,
  };

  const notes = buildNotes(story);
  if (notes) {
    result.notes = notes;
  }

  return result;
}

/**
 * Convert a parsed BMAD breakdown to a Ralph {@link Prd}.
 *
 * @param breakdown - Output from {@link parseStoryMarkdown}.
 * @param metadata  - Project-level metadata (name, branch, description).
 * @param options   - Optional filtering (e.g. single epic).
 * @returns A complete Prd ready for serialization.
 */
export function convertToPrd(
  breakdown: ParsedBreakdown,
  metadata: ProjectMetadata,
  options?: ConvertOptions,
): Prd {
  let epics: ParsedEpic[] = breakdown.epics;

  if (options?.epicNumber !== undefined) {
    epics = epics.filter((e) => e.number === options.epicNumber);
    if (epics.length === 0) {
      throw new Error(`Epic ${options.epicNumber} not found in breakdown`);
    }
  }

  const userStories: Story[] = [];

  for (let ei = 0; ei < epics.length; ei++) {
    const epic = epics[ei]!;
    for (let si = 0; si < epic.stories.length; si++) {
      userStories.push(convertStory(epic.stories[si]!, ei, si));
    }
  }

  return {
    project: metadata.project,
    branchName: metadata.branchName,
    description: metadata.description,
    userStories,
  };
}

/**
 * Save a Prd to the `.boop/prd.json` file inside the given project directory.
 *
 * Creates the `.boop/` directory if it doesn't exist.
 *
 * @param prd      - The Prd to serialize.
 * @param projectDir - Absolute path to the project root.
 * @returns The absolute path to the written file.
 */
export function savePrd(prd: Prd, projectDir: string): string {
  const boopDir = path.join(projectDir, ".boop");
  fs.mkdirSync(boopDir, { recursive: true });

  const filePath = path.join(boopDir, "prd.json");
  fs.writeFileSync(filePath, JSON.stringify(prd, null, 2) + "\n", "utf-8");

  return filePath;
}
