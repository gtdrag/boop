/**
 * Refactoring agent — takes combined findings from the parallel review phase
 * and applies fixes via Claude SDK.
 *
 * Runs AFTER code-reviewer, gap-analyst, and tech-debt-auditor complete.
 * Receives their combined findings and produces fix suggestions.
 * Commits use format: 'refactor: Epic N review - [description]'.
 */
import path from "node:path";

import { sendMessage, isRetryableApiError } from "../shared/claude-client.js";
import type { ClaudeClientOptions } from "../shared/claude-client.js";
import { retry } from "../shared/retry.js";

import type { AgentResult, ReviewContext, ReviewFinding } from "./team-orchestrator.js";
import { truncate, parseFindings, extractSummary, readFileContent } from "./shared.js";

// Re-export shared utilities so existing imports from this module continue to work.
export { parseFindings, extractSummary };

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * Extract unique file paths from findings.
 */
function getAffectedFiles(findings: ReviewFinding[]): string[] {
  const files = new Set<string>();
  for (const finding of findings) {
    if (finding.file) {
      files.add(finding.file);
    }
  }
  return [...files];
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert refactoring agent for a TypeScript Node.js project called Boop.
You receive findings from a code review, gap analysis, and tech debt audit.
Your job is to suggest concrete fixes for the actionable findings.

For each fix you suggest, output a JSON object on its own line with this exact format:
{"title":"Short description of the fix","severity":"critical|high|medium|low|info","file":"path/to/file.ts","description":"Detailed explanation of what to change and why"}

After all fixes, output a section starting with "## Summary" on its own line with:
- How many findings were addressed
- How many were deferred (with justification)
- Any new issues discovered during refactoring

If no fixes are needed, output:
{"title":"No fixes needed","severity":"info","file":"","description":"All findings are informational or already addressed."}

## Summary
No fixes needed.

Rules:
- Focus on critical and high severity findings first
- For each fix, be specific about what code to change
- If a finding cannot be fixed without breaking changes, mark it as deferred with justification
- Each finding must be a single JSON line (no multi-line JSON)
- Do not introduce new bugs or break existing functionality`;

function buildRefactoringMessage(
  findings: ReviewFinding[],
  fileContents: Array<{ path: string; content: string }>,
): string {
  const parts: string[] = ["Review the following findings and suggest concrete fixes.\n"];

  // Group findings by severity
  const bySeverity: Record<string, ReviewFinding[]> = {};
  for (const finding of findings) {
    const sev = finding.severity;
    if (!bySeverity[sev]) bySeverity[sev] = [];
    bySeverity[sev].push(finding);
  }

  parts.push("## Findings to Address\n");

  for (const severity of ["critical", "high", "medium", "low", "info"]) {
    const items = bySeverity[severity];
    if (!items || items.length === 0) continue;

    parts.push(`### ${severity.toUpperCase()} (${items.length})\n`);
    for (const finding of items) {
      const fileRef = finding.file ? ` (${finding.file})` : "";
      parts.push(`- **${finding.title}**${fileRef}: ${finding.description}`);
    }
    parts.push("");
  }

  // Include affected source files
  if (fileContents.length > 0) {
    parts.push("## Affected Source Files\n");
    for (const file of fileContents) {
      parts.push(`### ${file.path}\n`);
      parts.push("```typescript\n" + truncate(file.content, 6000) + "\n```\n");
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(
  inputFindings: ReviewFinding[],
  fixSuggestions: ReviewFinding[],
  summary: string,
): string {
  const parts: string[] = ["# Refactoring Report\n"];

  parts.push(`**Input findings:** ${inputFindings.length}\n`);
  parts.push(`**Fix suggestions:** ${fixSuggestions.length}\n`);

  if (fixSuggestions.length > 0) {
    parts.push("## Fix Suggestions\n");
    for (const fix of fixSuggestions) {
      const fileRef = fix.file ? ` in \`${fix.file}\`` : "";
      parts.push(`### [${fix.severity.toUpperCase()}] ${fix.title}${fileRef}\n`);
      parts.push(`${fix.description}\n`);
    }
  }

  parts.push(`\n${summary}\n`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main agent
// ---------------------------------------------------------------------------

export interface RefactoringAgentOptions {
  /** Claude client options (API key, model). */
  clientOptions?: ClaudeClientOptions;
  /** Maximum number of API retries. Defaults to 2. */
  maxRetries?: number;
  /** Maximum total chars of file content for the API call. Defaults to 100000. */
  maxTotalChars?: number;
}

/**
 * Create a refactoring agent function that conforms to RefactoringAgentFn.
 */
export function createRefactoringAgent(options: RefactoringAgentOptions = {}) {
  const { clientOptions = {}, maxRetries = 2, maxTotalChars = 100_000 } = options;

  return async function refactoringAgent(
    context: ReviewContext,
    findings: ReviewFinding[],
  ): Promise<AgentResult> {
    const { projectDir } = context;

    // No findings — nothing to refactor
    if (findings.length === 0) {
      return {
        agent: "refactoring",
        success: true,
        report: "# Refactoring Report\n\nNo findings to address — no refactoring needed.",
        findings: [],
        blockingIssues: [],
      };
    }

    // 1. Collect affected file contents
    const affectedPaths = getAffectedFiles(findings);
    const fileContents: Array<{ path: string; content: string }> = [];
    let totalChars = 0;

    for (const filePath of affectedPaths) {
      if (!SCAN_EXTENSIONS.has(path.extname(filePath))) continue;

      const content = readFileContent(projectDir, filePath);
      if (!content) continue;

      if (totalChars + content.length > maxTotalChars) continue;

      fileContents.push({ path: filePath, content });
      totalChars += content.length;
    }

    // 2. Build prompt and call Claude
    const message = buildRefactoringMessage(findings, fileContents);

    const response = await retry(
      () =>
        sendMessage({ ...clientOptions, maxTokens: 8192 }, SYSTEM_PROMPT, [
          { role: "user", content: message },
        ]),
      {
        maxRetries,
        isRetryable: isRetryableApiError,
      },
    );

    // 3. Parse results
    const fixSuggestions = parseFindings(response.text);
    const summary = extractSummary(response.text);

    // 4. Determine blocking issues
    const blockingIssues = fixSuggestions
      .filter((f) => f.severity === "critical" || f.severity === "high")
      .map((f) => `[${f.severity}] ${f.title}${f.file ? ` in ${f.file}` : ""}`);

    // 5. Generate report
    const report = generateReport(findings, fixSuggestions, summary);

    return {
      agent: "refactoring",
      success: true,
      report,
      findings: fixSuggestions,
      blockingIssues,
    };
  };
}
