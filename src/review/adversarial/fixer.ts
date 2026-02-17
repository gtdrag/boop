/**
 * Auto-fixer — applies fixes for verified findings using Claude CLI.
 *
 * For each finding, spawns a Claude CLI agent that:
 *   1. Reads the problematic code
 *   2. Applies the fix
 *   3. Runs the test suite to verify no regression
 *
 * If a fix breaks tests, retries up to 3 times. If still broken,
 * escalates as "unable to auto-fix".
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

import type { AdversarialFinding } from "./runner.js";
import type { TestSuiteRunnerFn, TestSuiteResult } from "../team-orchestrator.js";
import { readFileContent } from "../shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FixResult {
  /** The finding that was fixed (or attempted). */
  finding: AdversarialFinding;
  /** Whether the fix was applied successfully. */
  fixed: boolean;
  /** Git commit SHA (if committed). */
  commitSha?: string;
  /** Error context (if unable to fix). */
  error?: string;
  /** Number of attempts made. */
  attempts: number;
}

export interface FixerOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Test suite runner function. */
  testSuiteRunner: TestSuiteRunnerFn;
  /** Maximum fix attempts per finding. Defaults to 3. */
  maxAttempts?: number;
  /** Model for Claude CLI. */
  model?: string;
  /** Timeout per fix attempt in ms. Defaults to 300_000 (5 min). */
  timeout?: number;
}

export interface FixBatchResult {
  /** Individual fix results. */
  results: FixResult[];
  /** Findings that were successfully fixed. */
  fixed: AdversarialFinding[];
  /** Findings that could not be fixed. */
  unfixed: AdversarialFinding[];
  /** Final test suite result after all fixes. */
  finalTestResult: TestSuiteResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_BUFFER = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT = 300_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const CONTEXT_LINES = 50;

/**
 * Build the fix prompt for a single finding.
 */
function buildFixPrompt(finding: AdversarialFinding, fileContent: string): string {
  let codeContext = fileContent;

  // If we have a line range, extract a focused window
  if (finding.lineRange) {
    const lines = fileContent.split("\n");
    const start = Math.max(0, finding.lineRange.start - CONTEXT_LINES);
    const end = Math.min(lines.length, finding.lineRange.end + CONTEXT_LINES);
    codeContext = lines.slice(start, end).join("\n");
  }

  return `Fix the following issue in the codebase.

## Finding: [${finding.severity.toUpperCase()}] ${finding.title}

**File:** ${finding.file ?? "unknown"}
**Source:** ${finding.source} review
**Description:** ${finding.description}

## Current Code

\`\`\`typescript
${codeContext.slice(0, 20_000)}
\`\`\`

## Instructions

1. Fix ONLY this specific issue. Do not refactor other code.
2. Keep changes minimal and focused.
3. After fixing, run: pnpm typecheck && pnpm test
4. If tests fail, fix the test failures too.
5. Do NOT commit — the pipeline handles commits.`;
}

/**
 * Attempt to fix a single finding using Claude CLI.
 */
function attemptFix(
  finding: AdversarialFinding,
  projectDir: string,
  model?: string,
  timeout = DEFAULT_TIMEOUT,
): { success: boolean; output: string } {
  const fileContent = finding.file ? readFileContent(projectDir, finding.file) : "";
  const prompt = buildFixPrompt(finding, fileContent);

  const args = ["--print", "--dangerously-skip-permissions", "--no-session-persistence"];

  if (model) {
    args.push("--model", model);
  }

  const result = spawnSync("claude", args, {
    input: prompt,
    cwd: projectDir,
    encoding: "utf-8",
    timeout,
    maxBuffer: MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.error) {
    return { success: false, output: result.error.message };
  }

  if (result.status !== null && result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    return { success: false, output: `Exit code ${result.status}: ${stderr}` };
  }

  return { success: true, output: result.stdout ?? "" };
}

/**
 * Commit a fix with a structured message.
 */
function commitFix(projectDir: string, finding: AdversarialFinding): string | null {
  // Stage all changes
  const addResult = spawnSync("git", ["add", "-A"], {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (addResult.status !== 0) return null;

  // Check if there's anything to commit
  const diffResult = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (diffResult.status === 0) return null; // No changes staged

  const message = `fix(review): ${finding.id} — ${finding.title}`;
  const commitResult = spawnSync("git", ["commit", "-m", message], {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (commitResult.status !== 0) return null;

  // Get the commit SHA
  const shaResult = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  return shaResult.stdout?.trim() ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Auto-fix a batch of verified findings.
 *
 * For each finding:
 *   1. Spawn Claude CLI to apply the fix
 *   2. Run the test suite
 *   3. If tests pass, commit the fix
 *   4. If tests fail, retry (up to maxAttempts)
 *   5. If still failing, escalate as unfixable
 *
 * Fixes are applied sequentially to avoid conflicts.
 */
export async function fixFindings(
  findings: AdversarialFinding[],
  options: FixerOptions,
): Promise<FixBatchResult> {
  const {
    projectDir,
    testSuiteRunner,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    model,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  const results: FixResult[] = [];
  const fixed: AdversarialFinding[] = [];
  const unfixed: AdversarialFinding[] = [];

  // Sort by severity: critical → high → medium → low
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  const sorted = [...findings].sort(
    (a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4),
  );

  for (const finding of sorted) {
    let fixSuccess = false;
    let lastError = "";
    let commitSha: string | undefined;
    let attempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;

      // Attempt the fix
      const fixAttempt = attemptFix(finding, projectDir, model, timeout);
      if (!fixAttempt.success) {
        lastError = fixAttempt.output;
        continue;
      }

      // Run tests
      const testResult = await testSuiteRunner(projectDir);
      if (testResult.passed) {
        // Commit the fix
        const sha = commitFix(projectDir, finding);
        if (sha) {
          commitSha = sha;
        }
        fixSuccess = true;
        break;
      }

      // Tests failed — will retry if attempts remain
      lastError = `Tests failed after fix attempt ${attempt}`;
    }

    if (fixSuccess) {
      fixed.push(finding);
      results.push({ finding, fixed: true, commitSha, attempts });
    } else {
      unfixed.push(finding);
      results.push({ finding, fixed: false, error: lastError, attempts });
    }
  }

  // Final test run to get current state
  const finalTestResult = await testSuiteRunner(projectDir);

  return { results, fixed, unfixed, finalTestResult };
}
