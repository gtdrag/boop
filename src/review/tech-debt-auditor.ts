/**
 * Tech debt auditor agent — identifies technical debt in the codebase.
 *
 * Analyzes the codebase for: code duplication, naming inconsistencies,
 * extraction opportunities, unused code, and other tech debt indicators.
 * Runs in parallel with code-reviewer and gap-analyst.
 */
import fs from "node:fs";
import path from "node:path";

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
  collectSourceFiles,
} from "./shared.js";

// Re-export shared utilities so existing imports from this module continue to work.
export { collectSourceFiles, parseFindings, extractSummary } from "./shared.js";

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert tech debt auditor for a TypeScript Node.js project called Boop.
Your job is to analyze the codebase and identify technical debt including:
- Code duplication (similar logic repeated across files)
- Naming inconsistencies (mixed conventions, unclear names)
- Extraction opportunities (functions/modules that should be extracted)
- Unused or dead code (exports never imported, unreachable branches)
- Overly complex functions (high cyclomatic complexity, deep nesting)
- Missing abstractions (repeated patterns that should be unified)
- Dependency issues (circular imports, tight coupling)

For each finding, output a JSON object on its own line with this exact format:
{"title":"Short title","severity":"critical|high|medium|low|info","file":"path/to/file.ts","description":"Detailed explanation and suggestion for fixing"}

After all findings, output a section starting with "## Summary" on its own line with an overall assessment.

If no tech debt is found, output:
{"title":"No tech debt found","severity":"info","file":"","description":"Codebase is clean."}

## Summary
No tech debt found.

Rules:
- Be specific about file paths and what code should change
- Severity guide: critical = architectural problems blocking progress, high = significant duplication or coupling, medium = extraction opportunities or naming issues, low = minor improvements, info = observations
- Focus on actionable findings that a refactoring agent can fix
- Each finding must be a single JSON line (no multi-line JSON)`;

function buildTechDebtMessage(
  fileContents: Array<{ path: string; content: string }>,
): string {
  const parts: string[] = [
    "Analyze the following codebase for technical debt. For each issue found, output a JSON finding line.\n",
  ];

  parts.push(`**Files analyzed:** ${fileContents.length}\n`);

  for (const file of fileContents) {
    parts.push(`### ${file.path}\n`);
    parts.push("```typescript\n" + truncate(file.content, 6000) + "\n```\n");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(
  findings: ReviewFinding[],
  summary: string,
  filesAnalyzed: number,
): string {
  const parts: string[] = ["# Tech Debt Audit Report\n"];

  parts.push(`**Files analyzed:** ${filesAnalyzed}\n`);
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
// Main agent
// ---------------------------------------------------------------------------

export interface TechDebtAuditorOptions {
  /** Claude client options (API key, model). */
  clientOptions?: ClaudeClientOptions;
  /** Maximum number of API retries. Defaults to 2. */
  maxRetries?: number;
  /** Maximum number of source files to include in the API call. Defaults to 40. */
  maxFilesForApi?: number;
  /** Maximum total chars of file content for the API call. Defaults to 100000. */
  maxTotalChars?: number;
}

/**
 * Create a tech debt auditor agent function that conforms to ReviewAgentFn.
 */
export function createTechDebtAuditor(options: TechDebtAuditorOptions = {}) {
  const {
    clientOptions = {},
    maxRetries = 2,
    maxFilesForApi = 40,
    maxTotalChars = 100_000,
  } = options;

  return async function techDebtAuditor(context: ReviewContext): Promise<AgentResult> {
    const { projectDir } = context;

    // 1. Collect source files
    const sourceFiles = collectSourceFiles(path.join(projectDir, "src"), projectDir);

    if (sourceFiles.length === 0) {
      return {
        agent: "tech-debt",
        success: true,
        report: "# Tech Debt Audit Report\n\nNo source files found — nothing to analyze.",
        findings: [],
        blockingIssues: [],
      };
    }

    // 2. Read file contents (respect limits)
    const fileContents: Array<{ path: string; content: string }> = [];
    let totalChars = 0;

    for (const filePath of sourceFiles) {
      if (fileContents.length >= maxFilesForApi) break;

      const fullPath = path.join(projectDir, filePath);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      if (totalChars + content.length > maxTotalChars) continue;

      fileContents.push({ path: filePath, content });
      totalChars += content.length;
    }

    // 3. Build prompt and call Claude
    const message = buildTechDebtMessage(fileContents);

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

    // 4. Parse results
    const findings = parseFindings(response.text);
    const summary = extractSummary(response.text);

    // 5. Determine blocking issues (critical/high)
    const blockingIssues = findings
      .filter((f) => f.severity === "critical" || f.severity === "high")
      .map((f) => `[${f.severity}] ${f.title}${f.file ? ` in ${f.file}` : ""}`);

    // 6. Generate report
    const report = generateReport(findings, summary, fileContents.length);

    return {
      agent: "tech-debt",
      success: true,
      report,
      findings,
      blockingIssues,
    };
  };
}
