/**
 * Shared utilities for review agents.
 *
 * Extracted from code-reviewer, tech-debt-auditor, security-scanner,
 * refactoring-agent, test-hardener, and gap-analyst to eliminate
 * code duplication across the review subsystem.
 */
import fs from "node:fs";
import path from "node:path";

import type { ReviewFinding, FindingSeverity } from "./team-orchestrator.js";

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

/**
 * Truncate text to a maximum character count, appending a truncation marker.
 */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n... (truncated)";
}

// ---------------------------------------------------------------------------
// VALID_SEVERITIES
// ---------------------------------------------------------------------------

/**
 * The set of valid finding severity values.
 */
export const VALID_SEVERITIES: ReadonlySet<string> = new Set<string>([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

// ---------------------------------------------------------------------------
// parseFindings
// ---------------------------------------------------------------------------

/**
 * Parse Claude's response text into structured ReviewFinding objects.
 *
 * Splits the response by newlines, attempts JSON.parse on lines that
 * start with `{`, validates required fields and severity, and returns
 * an array of validated findings.
 */
export function parseFindings(responseText: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = responseText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (
        typeof parsed.title === "string" &&
        typeof parsed.severity === "string" &&
        typeof parsed.description === "string" &&
        VALID_SEVERITIES.has(parsed.severity)
      ) {
        findings.push({
          title: parsed.title,
          severity: parsed.severity as FindingSeverity,
          file: typeof parsed.file === "string" ? parsed.file : undefined,
          description: parsed.description,
        });
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// extractSummary
// ---------------------------------------------------------------------------

/**
 * Extract the summary section from Claude's response.
 *
 * Looks for the "## Summary" marker and returns everything from that
 * point onward. Returns the full text if no marker is found.
 */
export function extractSummary(responseText: string): string {
  const summaryIndex = responseText.indexOf("## Summary");
  if (summaryIndex === -1) return responseText;
  return responseText.slice(summaryIndex);
}

// ---------------------------------------------------------------------------
// collectSourceFiles
// ---------------------------------------------------------------------------

/** Default file extensions to scan. */
const DEFAULT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/** Default directories to skip during recursive traversal. */
const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", "test", ".boop"]);

export interface CollectSourceFilesOptions {
  /** File extensions to include. Defaults to .ts, .tsx, .js, .jsx. */
  extensions?: ReadonlySet<string>;
  /** Directory names to skip. Defaults to node_modules, .git, dist, coverage, test, .boop. */
  skipDirs?: ReadonlySet<string>;
}

/**
 * Recursively collect source files from a directory.
 *
 * Returns relative paths (relative to `baseDir`). Accepts options to
 * customise which extensions to include and which directories to skip.
 */
export function collectSourceFiles(
  dir: string,
  baseDir: string,
  options?: CollectSourceFilesOptions,
): string[] {
  const extensions = options?.extensions ?? DEFAULT_EXTENSIONS;
  const skipDirs = options?.skipDirs ?? DEFAULT_SKIP_DIRS;

  const files: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath, baseDir, options));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(path.relative(baseDir, fullPath));
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// readFileContent
// ---------------------------------------------------------------------------

/**
 * Read a file's content, returning empty string on error.
 */
export function readFileContent(projectDir: string, filePath: string): string {
  const fullPath = path.join(projectDir, filePath);
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return "";
  }
}
