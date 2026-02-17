/**
 * Reality check scanner for the Ralph build loop.
 *
 * Scans source files for mock data, placeholder implementations, stub code,
 * and TODO/FIXME markers in production code paths. Failures here are treated
 * the same as a failing test — they block the commit.
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RealityCheckResult {
  /** Whether the check passed (no violations found). */
  passed: boolean;
  /** Individual violations found. */
  violations: RealityViolation[];
}

export interface RealityViolation {
  /** Absolute path to the file. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The kind of violation. */
  kind: "mock-data" | "stub" | "todo" | "placeholder";
  /** The matched text (trimmed). */
  text: string;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate mock/placeholder data in production code.
 * Each entry: [regex, violation kind].
 */
const VIOLATION_PATTERNS: Array<[RegExp, RealityViolation["kind"]]> = [
  // TODO / FIXME markers — only in comments (// or /* or * continuation)
  // Case-sensitive: matches TODO, FIXME, HACK but NOT "todo" as a domain word
  [/(?:\/[\/\*]|^\s*\*).*\b(?:TODO|FIXME|HACK)\b/, "todo"],
  [/(?:\/[\/\*]|^\s*\*).*\bXXX\b/, "todo"],

  // Stub / placeholder implementations
  [/\bthrow new Error\(\s*["']not implemented["']\s*\)/i, "stub"],
  [/\bthrow new Error\(\s*["']stub["']\s*\)/i, "stub"],
  [/\bthrow new Error\(\s*["']todo["']\s*\)/i, "stub"],

  // Mock/placeholder data patterns
  [/["']placeholder["']/i, "placeholder"],
  [/["']mock[-_]?data["']/i, "mock-data"],
  [/["']fake[-_]?data["']/i, "mock-data"],
  [/["']lorem ipsum["']/i, "placeholder"],
  [/["']test@example\.com["']/, "mock-data"],
  [/["']John Doe["']/, "mock-data"],
  [/["']Jane Doe["']/, "mock-data"],
];

/**
 * File extensions to scan.
 */
const SCANNABLE_EXTENSIONS = new Set([".ts", ".js", ".mts", ".mjs"]);

/**
 * Directories to skip entirely.
 */
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", ".boop"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a file is a test file (should be excluded from reality checks).
 */
function isTestFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return (
    base.endsWith(".test.ts") ||
    base.endsWith(".test.js") ||
    base.endsWith(".spec.ts") ||
    base.endsWith(".spec.js") ||
    filePath.includes("/test/") ||
    filePath.includes("/tests/") ||
    filePath.includes("/__tests__/")
  );
}

/**
 * Recursively collect all scannable source files under a directory.
 */
function collectFiles(dir: string): string[] {
  const results: string[] = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SCANNABLE_EXTENSIONS.has(ext) && !isTestFile(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Scan a single file for reality-check violations.
 */
function scanFile(filePath: string): RealityViolation[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations: RealityViolation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    for (const [pattern, kind] of VIOLATION_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: filePath,
          line: i + 1,
          kind,
          text: line.trim(),
        });
        // Only report the first match per line to avoid duplicates
        break;
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the reality check on a list of files.
 *
 * @param files - Absolute paths to files to scan.
 * @returns The check result with any violations found.
 */
export function checkFiles(files: string[]): RealityCheckResult {
  const violations: RealityViolation[] = [];

  for (const file of files) {
    if (isTestFile(file)) continue;
    violations.push(...scanFile(file));
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Run the reality check on all source files in a directory.
 *
 * Recursively scans for `.ts` and `.js` files, skipping test files,
 * node_modules, dist, and other non-production directories.
 *
 * @param srcDir - Absolute path to the source directory to scan.
 * @returns The check result with any violations found.
 */
export function checkDirectory(srcDir: string): RealityCheckResult {
  const files = collectFiles(srcDir);
  return checkFiles(files);
}

/**
 * Format reality check violations into a human-readable report.
 */
export function formatViolations(violations: RealityViolation[]): string {
  if (violations.length === 0) return "Reality check passed — no violations found.";

  const lines = [`Reality check FAILED — ${violations.length} violation(s) found:\n`];

  for (const v of violations) {
    lines.push(`  ${v.file}:${v.line} [${v.kind}] ${v.text}`);
  }

  return lines.join("\n");
}
