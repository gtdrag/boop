/**
 * Code review agent — reviews all code changed in an epic.
 *
 * Uses git diff to identify changed files, reads their content,
 * and sends them to Claude for automated code review.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { sendMessage, isRetryableApiError } from "../shared/claude-client.js";
import type { ClaudeClientOptions } from "../shared/claude-client.js";
import { retry } from "../shared/retry.js";

import type {
  AgentResult,
  ReviewContext,
  ReviewFinding,
} from "./team-orchestrator.js";
import {
  truncate,
  parseFindings,
  extractSummary,
  readFileContent,
} from "./shared.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Get list of files changed in the epic's commits.
 *
 * Uses `git diff --name-only` against the main branch to find all files
 * that were added or modified during the epic.
 */
export async function getChangedFiles(
  projectDir: string,
  baseBranch = "main",
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMR", baseBranch, "HEAD"],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
  } catch {
    // Fallback: list all tracked TypeScript files if diff fails
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "*.ts", "*.tsx", "*.js", "*.jsx"],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
  }
}

/**
 * Get the diff content for a specific file.
 */
export async function getFileDiff(
  projectDir: string,
  filePath: string,
  baseBranch = "main",
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", baseBranch, "HEAD", "--", filePath],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    return "";
  }
}


// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert code reviewer for a TypeScript Node.js project called Boop.
Your job is to review code changes and identify:
- Bugs and logic errors
- Security vulnerabilities (injection, XSS, path traversal, etc.)
- Antipatterns and code smells
- Inconsistencies with project conventions
- Missing error handling
- Performance issues
- Type safety issues

For each finding, output a JSON object on its own line with this exact format:
{"title":"Short title","severity":"critical|high|medium|low|info","file":"path/to/file.ts","description":"Detailed explanation"}

After all findings, output a summary section starting with "## Summary" on its own line.

If there are no issues, output:
{"title":"No issues found","severity":"info","file":"","description":"Code review passed with no findings."}

## Summary
No issues found.

Rules:
- Be specific about file paths and line references when possible
- Severity guide: critical = data loss/security breach, high = bugs/security concerns, medium = antipatterns/missing handling, low = style/minor improvements, info = observations
- Focus on substantive issues, not style preferences
- Each finding must be a single JSON line (no multi-line JSON)`;

/**
 * Build the user message containing the code to review.
 * Chunks large diffs into manageable pieces.
 */
function buildReviewMessage(
  files: Array<{ path: string; diff: string; content: string }>,
): string {
  const parts: string[] = [
    "Review the following code changes. For each issue found, output a JSON finding line.\n",
  ];

  for (const file of files) {
    parts.push(`### File: ${file.path}\n`);
    if (file.diff) {
      parts.push("```diff\n" + truncate(file.diff, 8000) + "\n```\n");
    } else {
      parts.push("```typescript\n" + truncate(file.content, 8000) + "\n```\n");
    }
  }

  return parts.join("\n");
}

// Re-export shared utilities so existing imports from this module continue to work.
export { parseFindings, extractSummary } from "./shared.js";

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(
  findings: ReviewFinding[],
  summary: string,
  filesReviewed: string[],
): string {
  const parts: string[] = ["# Code Review Report\n"];

  parts.push(`**Files reviewed:** ${filesReviewed.length}\n`);
  parts.push(
    `**Findings:** ${findings.length} (${findings.filter((f) => f.severity === "critical" || f.severity === "high").length} blocking)\n`,
  );

  if (findings.length > 0) {
    parts.push("## Findings\n");
    for (const finding of findings) {
      const fileRef = finding.file ? ` in \`${finding.file}\`` : "";
      parts.push(`### [${finding.severity.toUpperCase()}] ${finding.title}${fileRef}\n`);
      parts.push(`${finding.description}\n`);
    }
  }

  parts.push(`\n${summary}\n`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Batch files for API calls
// ---------------------------------------------------------------------------

const MAX_CHARS_PER_BATCH = 50_000;

function batchFiles(
  files: Array<{ path: string; diff: string; content: string }>,
): Array<Array<{ path: string; diff: string; content: string }>> {
  const batches: Array<Array<{ path: string; diff: string; content: string }>> = [];
  let currentBatch: Array<{ path: string; diff: string; content: string }> = [];
  let currentSize = 0;

  for (const file of files) {
    const fileSize = (file.diff || file.content).length;

    if (currentSize + fileSize > MAX_CHARS_PER_BATCH && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(file);
    currentSize += fileSize;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

// ---------------------------------------------------------------------------
// Main agent
// ---------------------------------------------------------------------------

export interface CodeReviewerOptions {
  /** Claude client options (API key, model). */
  clientOptions?: ClaudeClientOptions;
  /** Base branch to diff against. Defaults to "main". */
  baseBranch?: string;
  /** File extensions to include in review. */
  includeExtensions?: string[];
  /** Maximum number of API retries. Defaults to 2. */
  maxRetries?: number;
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json"];

/**
 * Create a code review agent function that conforms to ReviewAgentFn.
 */
export function createCodeReviewer(options: CodeReviewerOptions = {}) {
  const {
    clientOptions = {},
    baseBranch = "main",
    includeExtensions = DEFAULT_EXTENSIONS,
    maxRetries = 2,
  } = options;

  return async function codeReviewer(context: ReviewContext): Promise<AgentResult> {
    const { projectDir } = context;

    // 1. Get changed files
    const allChanged = await getChangedFiles(projectDir, baseBranch);
    const relevantFiles = allChanged.filter((f) =>
      includeExtensions.some((ext) => f.endsWith(ext)),
    );

    if (relevantFiles.length === 0) {
      return {
        agent: "code-review",
        success: true,
        report: "# Code Review Report\n\nNo files changed — nothing to review.",
        findings: [],
        blockingIssues: [],
      };
    }

    // 2. Read diffs and content for each file
    const fileData = await Promise.all(
      relevantFiles.map(async (filePath) => ({
        path: filePath,
        diff: await getFileDiff(projectDir, filePath, baseBranch),
        content: readFileContent(projectDir, filePath),
      })),
    );

    // 3. Batch files and send to Claude for review
    const batches = batchFiles(fileData);
    const allFindings: ReviewFinding[] = [];
    let lastSummary = "";

    for (const batch of batches) {
      const message = buildReviewMessage(batch);

      const response = await retry(
        () =>
          sendMessage(clientOptions, SYSTEM_PROMPT, [
            { role: "user", content: message },
          ]),
        {
          maxRetries,
          isRetryable: isRetryableApiError,
        },
      );

      const batchFindings = parseFindings(response.text);
      allFindings.push(...batchFindings);
      lastSummary = extractSummary(response.text);
    }

    // 4. Determine blocking issues
    const blockingIssues = allFindings
      .filter((f) => f.severity === "critical" || f.severity === "high")
      .map((f) => `[${f.severity}] ${f.title}${f.file ? ` in ${f.file}` : ""}`);

    // 5. Generate report
    const report = generateReport(allFindings, lastSummary, relevantFiles);

    return {
      agent: "code-review",
      success: true,
      report,
      findings: allFindings,
      blockingIssues,
    };
  };
}
