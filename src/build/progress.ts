/**
 * Progress and pattern tracking for the Ralph build loop.
 *
 * Manages the append-only progress log (.boop/progress.txt) and optional
 * CLAUDE.md pattern updates. After each story iteration the loop calls
 * {@link appendProgress} to record what happened, and optionally
 * {@link extractClaudeMdUpdates} to pull codebase-pattern additions from
 * the agent response.
 */

import fs from "node:fs";
import path from "node:path";
import type { Story } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressEntry {
  /** ISO-style date string (e.g. "2026-02-16 19:30"). */
  date: string;
  /** Story ID (e.g. "4.4"). */
  storyId: string;
  /** Story title. */
  storyTitle: string;
  /** Bullet-point summary lines of what was implemented. */
  summary: string[];
  /** Files that were changed. */
  filesChanged: string[];
  /** Learnings / gotchas discovered during implementation. */
  learnings: string[];
}

export interface PatternEntry {
  /** Short label (e.g. "Vitest mock pattern"). */
  label: string;
  /** Description of the pattern. */
  description: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODEBASE_PATTERNS_HEADER = "## Codebase Patterns";
const PROGRESS_SEPARATOR = "---";

// ---------------------------------------------------------------------------
// Progress file I/O
// ---------------------------------------------------------------------------

/**
 * Read the current contents of the progress file. Returns empty string if
 * the file does not exist.
 */
export function readProgress(progressPath: string): string {
  try {
    return fs.readFileSync(progressPath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Format a {@link ProgressEntry} into the Ralph progress log format.
 */
export function formatProgressEntry(entry: ProgressEntry): string {
  const lines: string[] = [];

  lines.push(`## ${entry.date} - Story ${entry.storyId}: ${entry.storyTitle}`);

  for (const line of entry.summary) {
    lines.push(`- ${line}`);
  }

  if (entry.filesChanged.length > 0) {
    lines.push(`- Files changed: ${entry.filesChanged.join(", ")}`);
  }

  if (entry.learnings.length > 0) {
    lines.push("- **Learnings for future iterations:**");
    for (const learning of entry.learnings) {
      lines.push(`  - ${learning}`);
    }
  }

  lines.push(PROGRESS_SEPARATOR);

  return lines.join("\n");
}

/**
 * Append a progress entry to the progress file. Creates the file (and
 * parent directories) if it does not exist.
 */
export function appendProgress(
  progressPath: string,
  entry: ProgressEntry,
): void {
  const dir = path.dirname(progressPath);
  fs.mkdirSync(dir, { recursive: true });

  const formatted = formatProgressEntry(entry);
  const existing = readProgress(progressPath);

  // Ensure a blank line before the new entry when appending
  const separator = existing.length > 0 && !existing.endsWith("\n\n")
    ? "\n"
    : "";

  fs.appendFileSync(progressPath, separator + formatted + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Codebase patterns (top of progress.txt)
// ---------------------------------------------------------------------------

/**
 * Extract the Codebase Patterns section from progress.txt content.
 * Returns the pattern block text (including the header), or empty string
 * if none exists.
 */
export function extractPatternsSection(content: string): string {
  const headerIdx = content.indexOf(CODEBASE_PATTERNS_HEADER);
  if (headerIdx === -1) return "";

  // Find the next `## ` heading (not the patterns heading itself)
  const afterHeader = content.indexOf("\n", headerIdx);
  if (afterHeader === -1) return content.slice(headerIdx);

  const rest = content.slice(afterHeader + 1);
  // Look for the next `## ` heading that starts a progress entry
  const nextHeading = rest.search(/^## /m);

  if (nextHeading === -1) {
    return content.slice(headerIdx).trimEnd();
  }

  return content.slice(headerIdx, afterHeader + 1 + nextHeading).trimEnd();
}

/**
 * Add a new pattern to the Codebase Patterns section at the top of
 * progress.txt. If the section doesn't exist yet, it is created.
 */
export function addPattern(progressPath: string, pattern: PatternEntry): void {
  const content = readProgress(progressPath);
  const newBullet = `- **${pattern.label}:** ${pattern.description}`;

  const headerIdx = content.indexOf(CODEBASE_PATTERNS_HEADER);

  if (headerIdx === -1) {
    // No patterns section yet — prepend one
    const section = `${CODEBASE_PATTERNS_HEADER}\n${newBullet}\n\n`;
    const updated = section + content;
    fs.writeFileSync(progressPath, updated, "utf-8");
    return;
  }

  // Insert the new bullet after the last existing pattern bullet
  const afterHeader = content.indexOf("\n", headerIdx);
  if (afterHeader === -1) {
    // Header is the last line
    fs.writeFileSync(
      progressPath,
      content + "\n" + newBullet + "\n",
      "utf-8",
    );
    return;
  }

  // Walk forward from after the header line to find the end of the bullet list
  const lines = content.slice(afterHeader + 1).split("\n");
  let insertOffset = afterHeader + 1;
  for (const line of lines) {
    if (line.startsWith("- ") || line.startsWith("  ")) {
      insertOffset += line.length + 1; // +1 for the newline
    } else {
      break;
    }
  }

  const before = content.slice(0, insertOffset);
  const after = content.slice(insertOffset);
  fs.writeFileSync(progressPath, before + newBullet + "\n" + after, "utf-8");
}

// ---------------------------------------------------------------------------
// CLAUDE.md updates
// ---------------------------------------------------------------------------

/**
 * Extract CLAUDE.md update suggestions from a Claude agent response.
 *
 * Looks for a fenced block between `<!-- CLAUDE_MD_UPDATE -->` markers or
 * a section starting with `## CLAUDE.md Updates` in the response text.
 * Returns the extracted text, or null if none found.
 */
export function extractClaudeMdUpdates(responseText: string): string | null {
  // Strategy 1: Look for marker-delimited blocks
  const markerStart = "<!-- CLAUDE_MD_UPDATE -->";
  const startIdx = responseText.indexOf(markerStart);
  if (startIdx !== -1) {
    const contentStart = startIdx + markerStart.length;
    const endIdx = responseText.indexOf(markerStart, contentStart);
    const block = endIdx === -1
      ? responseText.slice(contentStart).trim()
      : responseText.slice(contentStart, endIdx).trim();
    if (block.length > 0) return block;
  }

  // Strategy 2: Look for a heading-based section
  const headingPattern = /^##\s+CLAUDE\.md\s+Updates?\s*$/im;
  const match = headingPattern.exec(responseText);
  if (match) {
    const afterHeading = responseText.slice(match.index + match[0].length);
    // Grab everything until the next `## ` heading or end of text
    const nextHeading = afterHeading.search(/^## /m);
    const block = nextHeading === -1
      ? afterHeading.trim()
      : afterHeading.slice(0, nextHeading).trim();
    if (block.length > 0) return block;
  }

  return null;
}

/**
 * Append extracted pattern content to CLAUDE.md. Adds the content under
 * a `## Codebase Patterns` section, creating it if it doesn't exist.
 */
export function appendToClaudeMd(
  claudeMdPath: string,
  content: string,
): void {
  const existing = (() => {
    try {
      return fs.readFileSync(claudeMdPath, "utf-8");
    } catch {
      return "";
    }
  })();

  const patternsHeader = "## Codebase Patterns";
  const headerIdx = existing.indexOf(patternsHeader);

  if (headerIdx === -1) {
    // No patterns section — append one at the end
    const section = `\n${patternsHeader}\n\n${content}\n`;
    fs.writeFileSync(claudeMdPath, existing.trimEnd() + "\n" + section, "utf-8");
    return;
  }

  // Find the insertion point (end of existing patterns section)
  const afterHeader = existing.indexOf("\n", headerIdx);
  if (afterHeader === -1) {
    fs.writeFileSync(claudeMdPath, existing + "\n\n" + content + "\n", "utf-8");
    return;
  }

  const rest = existing.slice(afterHeader + 1);
  const nextSection = rest.search(/^## /m);

  let insertPos: number;
  if (nextSection === -1) {
    insertPos = existing.length;
  } else {
    insertPos = afterHeader + 1 + nextSection;
  }

  const before = existing.slice(0, insertPos).trimEnd();
  const after = existing.slice(insertPos);
  fs.writeFileSync(
    claudeMdPath,
    before + "\n" + content + "\n" + (after.length > 0 ? "\n" + after : ""),
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Convenience: build a ProgressEntry from story run data
// ---------------------------------------------------------------------------

/**
 * Create a {@link ProgressEntry} from story completion data.
 */
export function buildProgressEntry(
  story: Story,
  summary: string[],
  filesChanged: string[],
  learnings: string[],
): ProgressEntry {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return {
    date,
    storyId: story.id,
    storyTitle: story.title,
    summary,
    filesChanged,
    learnings,
  };
}
