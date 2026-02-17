/**
 * Finding verifier — deterministic validation of adversarial findings.
 *
 * NOT an LLM call. Checks each finding against the actual codebase:
 *   - Does the referenced file exist?
 *   - Does the referenced code match the finding's description?
 *
 * Filters out hallucinated findings (fabricated file paths, phantom code
 * references) so only real issues proceed to auto-fix.
 */
import fs from "node:fs";
import path from "node:path";

import type { AdversarialFinding } from "./runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationResult {
  /** Findings confirmed as real. */
  verified: AdversarialFinding[];
  /** Findings discarded (hallucinated or unverifiable). */
  discarded: Array<{
    finding: AdversarialFinding;
    reason: string;
  }>;
  /** Summary statistics. */
  stats: {
    total: number;
    verified: number;
    discarded: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a file exists in the project directory.
 */
function fileExists(projectDir: string, filePath: string): boolean {
  const fullPath = path.join(projectDir, filePath);
  try {
    return fs.statSync(fullPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Read a file's content for verification. Returns null if unreadable.
 */
function readFile(projectDir: string, filePath: string): string | null {
  const fullPath = path.join(projectDir, filePath);
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Extract key terms from a finding description for matching against code.
 *
 * Pulls quoted strings, backtick-wrapped identifiers, and camelCase/snake_case
 * identifiers that look like variable or function names.
 */
function extractKeyTerms(description: string): string[] {
  const terms: string[] = [];

  // Quoted strings: "foo" or 'bar'
  const quoted = description.match(/["'`]([a-zA-Z_$][\w$.]*(?:\(\))?)[`"']/g);
  if (quoted) {
    for (const q of quoted) {
      terms.push(q.slice(1, -1).replace("()", ""));
    }
  }

  // Backtick-wrapped identifiers: `fooBar`
  const backtick = description.match(/`([a-zA-Z_$][\w$.]*)`/g);
  if (backtick) {
    for (const b of backtick) {
      terms.push(b.slice(1, -1));
    }
  }

  return [...new Set(terms)];
}

/**
 * Check if a finding's description plausibly matches the file content.
 *
 * We look for key terms from the finding description in the actual file.
 * If at least one key term matches, the finding is considered plausible.
 * If no key terms can be extracted, we give the benefit of the doubt.
 */
function contentMatchesFinding(
  content: string,
  finding: AdversarialFinding,
): { matches: boolean; reason?: string } {
  const keyTerms = extractKeyTerms(finding.description);

  // Also check the title for terms
  const titleTerms = extractKeyTerms(finding.title);
  const allTerms = [...new Set([...keyTerms, ...titleTerms])];

  // No extractable terms — can't verify, give benefit of the doubt
  if (allTerms.length === 0) {
    return { matches: true };
  }

  // Check if any key term appears in the file
  const matchedTerms = allTerms.filter((term) => content.includes(term));

  if (matchedTerms.length > 0) {
    return { matches: true };
  }

  return {
    matches: false,
    reason: `None of the key terms [${allTerms.join(", ")}] found in ${finding.file}`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify adversarial findings against the actual codebase.
 *
 * For each finding:
 *   1. Check if the file path exists
 *   2. Check if key terms from the description appear in the file
 *   3. Discard findings that fail verification
 *
 * This is a deterministic, non-LLM step that filters out hallucinations.
 */
export function verifyFindings(
  projectDir: string,
  findings: AdversarialFinding[],
): VerificationResult {
  const verified: AdversarialFinding[] = [];
  const discarded: VerificationResult["discarded"] = [];

  for (const finding of findings) {
    // Findings without a file path can't be file-verified — keep them
    if (!finding.file) {
      verified.push(finding);
      continue;
    }

    // Check file exists
    if (!fileExists(projectDir, finding.file)) {
      discarded.push({
        finding,
        reason: `File does not exist: ${finding.file}`,
      });
      continue;
    }

    // Read file and check content match
    const content = readFile(projectDir, finding.file);
    if (content === null) {
      discarded.push({
        finding,
        reason: `File unreadable: ${finding.file}`,
      });
      continue;
    }

    const match = contentMatchesFinding(content, finding);
    if (!match.matches) {
      discarded.push({
        finding,
        reason: match.reason ?? "Content does not match finding description",
      });
      continue;
    }

    verified.push(finding);
  }

  return {
    verified,
    discarded,
    stats: {
      total: findings.length,
      verified: verified.length,
      discarded: discarded.length,
    },
  };
}
