/**
 * Gap analysis agent — cross-references acceptance criteria against implementation.
 *
 * Reads every acceptance criterion from every story in the epic,
 * then verifies each is met with real code (not mocks, stubs, or placeholders).
 * Scans production code for patterns that indicate incomplete implementation.
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
  FindingSeverity,
} from "./team-orchestrator.js";
import { truncate, collectSourceFiles } from "./shared.js";

// ---------------------------------------------------------------------------
// PRD types (minimal — just what we need to read stories)
// ---------------------------------------------------------------------------

interface PrdStory {
  id: string;
  title: string;
  acceptanceCriteria: string[];
  passes?: boolean;
}

interface PrdFile {
  userStories: PrdStory[];
}

// ---------------------------------------------------------------------------
// Gap scan patterns
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bHACK\b/i,
  /\bXXX\b/i,
  /\bplaceholder\b/i,
  /\bdummy\b/i,
  /\bfake\b/i,
  /\bmock/i,
  /\bsample\b/i,
  /\bhardcoded\b/i,
  /\bstub\b/i,
  /\bnot.?implemented\b/i,
  /throw new Error\(["']not implemented/i,
];

// Re-export shared collectSourceFiles so existing imports from this module continue to work.
export { collectSourceFiles } from "./shared.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the PRD file and extract stories for the given epic.
 */
export function readPrdStories(projectDir: string): PrdStory[] {
  const prdPath = path.join(projectDir, ".boop", "prd.json");
  try {
    const raw = fs.readFileSync(prdPath, "utf-8");
    const prd = JSON.parse(raw) as PrdFile;
    return prd.userStories ?? [];
  } catch {
    return [];
  }
}

/**
 * Scan a file for placeholder patterns and return matches.
 */
export function scanFileForPlaceholders(
  projectDir: string,
  filePath: string,
): Array<{ line: number; pattern: string; text: string }> {
  const fullPath = path.join(projectDir, filePath);
  let content: string;
  try {
    content = fs.readFileSync(fullPath, "utf-8");
  } catch {
    return [];
  }

  const matches: Array<{ line: number; pattern: string; text: string }> = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip test files and comments that are just documenting patterns
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(line)) {
        matches.push({
          line: i + 1,
          pattern: pattern.source,
          text: line.trim(),
        });
        break; // One match per line is enough
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert QA analyst for a TypeScript Node.js project called Boop.
Your job is to cross-reference acceptance criteria against actual implementation and identify gaps.

For each acceptance criterion, determine if it is:
- "verified": The code genuinely implements this criterion with real logic
- "gap": The criterion is NOT met — implementation is missing, incomplete, uses mocks/stubs/placeholders, or fakes the behavior

For each criterion, output a JSON object on its own line with this exact format:
{"storyId":"5.1","criterion":"The acceptance criterion text","status":"verified|gap","evidence":"Explanation of what code proves or disproves this criterion"}

After all criteria, output a section starting with "## Placeholder Scan" on its own line, then summarize any placeholder patterns found in the codebase.

After that, output a section starting with "## Summary" with the overall gap analysis summary.

Rules:
- Be strict: if a criterion says "real API calls" but the code uses mocked responses, that's a gap
- If a criterion says "saved to file" but no file write exists, that's a gap
- Test files with mocks are expected and OK — only flag mocks in PRODUCTION code
- Each finding must be a single JSON line (no multi-line JSON)`;

function buildGapAnalysisMessage(
  stories: PrdStory[],
  sourceFiles: string[],
  placeholderMatches: Array<{ file: string; line: number; pattern: string; text: string }>,
  fileContents: Array<{ path: string; content: string }>,
): string {
  const parts: string[] = [
    "Analyze the following acceptance criteria against the actual codebase implementation.\n",
  ];

  // List all acceptance criteria
  parts.push("## Acceptance Criteria to Verify\n");
  for (const story of stories) {
    parts.push(`### Story ${story.id}: ${story.title}\n`);
    for (const criterion of story.acceptanceCriteria) {
      parts.push(`- ${criterion}`);
    }
    parts.push("");
  }

  // List placeholder matches found
  if (placeholderMatches.length > 0) {
    parts.push("## Placeholder Patterns Found in Source Code\n");
    for (const match of placeholderMatches) {
      parts.push(`- \`${match.file}:${match.line}\` — ${match.text}`);
    }
    parts.push("");
  }

  // Include key source file contents
  parts.push("## Source Files\n");
  for (const file of fileContents) {
    parts.push(`### ${file.path}\n`);
    parts.push("```typescript\n" + truncate(file.content, 6000) + "\n```\n");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface CriterionResult {
  storyId: string;
  criterion: string;
  status: "verified" | "gap";
  evidence: string;
}

const VALID_STATUSES = new Set(["verified", "gap"]);

export function parseCriterionResults(responseText: string): CriterionResult[] {
  const results: CriterionResult[] = [];
  const lines = responseText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (
        typeof parsed.storyId === "string" &&
        typeof parsed.criterion === "string" &&
        typeof parsed.status === "string" &&
        typeof parsed.evidence === "string" &&
        VALID_STATUSES.has(parsed.status)
      ) {
        results.push({
          storyId: parsed.storyId,
          criterion: parsed.criterion,
          status: parsed.status as "verified" | "gap",
          evidence: parsed.evidence,
        });
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(
  criterionResults: CriterionResult[],
  placeholderMatches: Array<{ file: string; line: number; pattern: string; text: string }>,
  responseText: string,
): string {
  const gaps = criterionResults.filter((r) => r.status === "gap");
  const verified = criterionResults.filter((r) => r.status === "verified");

  const parts: string[] = ["# Gap Analysis Report\n"];

  parts.push(`**Criteria checked:** ${criterionResults.length}`);
  parts.push(`**Verified:** ${verified.length}`);
  parts.push(`**Gaps found:** ${gaps.length}`);
  parts.push(`**Placeholder patterns:** ${placeholderMatches.length}\n`);

  if (gaps.length > 0) {
    parts.push("## Gaps Found\n");
    for (const gap of gaps) {
      parts.push(`### [GAP] Story ${gap.storyId}: ${gap.criterion}\n`);
      parts.push(`**Evidence:** ${gap.evidence}\n`);
    }
  }

  if (verified.length > 0) {
    parts.push("## Verified Criteria\n");
    for (const v of verified) {
      parts.push(`- **Story ${v.storyId}:** ${v.criterion}`);
      parts.push(`  _Evidence:_ ${v.evidence}\n`);
    }
  }

  if (placeholderMatches.length > 0) {
    parts.push("## Placeholder Patterns in Source\n");
    for (const match of placeholderMatches) {
      parts.push(`- \`${match.file}:${match.line}\` — ${match.text}`);
    }
    parts.push("");
  }

  // Include summary from Claude's response
  const summaryIndex = responseText.indexOf("## Summary");
  if (summaryIndex !== -1) {
    parts.push(responseText.slice(summaryIndex));
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main agent
// ---------------------------------------------------------------------------

export interface GapAnalystOptions {
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
 * Create a gap analysis agent function that conforms to ReviewAgentFn.
 */
export function createGapAnalyst(options: GapAnalystOptions = {}) {
  const {
    clientOptions = {},
    maxRetries = 2,
    maxFilesForApi = 40,
    maxTotalChars = 100_000,
  } = options;

  return async function gapAnalyst(context: ReviewContext): Promise<AgentResult> {
    const { projectDir } = context;

    // 1. Read stories from PRD
    const stories = readPrdStories(projectDir);

    if (stories.length === 0) {
      return {
        agent: "gap-analysis",
        success: true,
        report: "# Gap Analysis Report\n\nNo stories found in PRD — nothing to analyze.",
        findings: [],
        blockingIssues: [],
      };
    }

    // 2. Collect source files
    const sourceFiles = collectSourceFiles(path.join(projectDir, "src"), projectDir);

    // 3. Scan for placeholder patterns
    const allPlaceholders: Array<{
      file: string;
      line: number;
      pattern: string;
      text: string;
    }> = [];
    for (const file of sourceFiles) {
      const matches = scanFileForPlaceholders(projectDir, file);
      for (const match of matches) {
        allPlaceholders.push({ file, ...match });
      }
    }

    // 4. Read file contents for Claude (respect limits)
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

    // 5. Build prompt and call Claude
    const message = buildGapAnalysisMessage(stories, sourceFiles, allPlaceholders, fileContents);

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

    // 6. Parse results
    const criterionResults = parseCriterionResults(response.text);
    const gaps = criterionResults.filter((r) => r.status === "gap");

    // 7. Convert gaps to findings
    const findings: ReviewFinding[] = gaps.map((gap) => ({
      title: `Gap: Story ${gap.storyId} — ${gap.criterion.slice(0, 80)}`,
      severity: "high" as FindingSeverity,
      file: undefined,
      description: gap.evidence,
    }));

    // Also add placeholder findings
    for (const match of allPlaceholders) {
      findings.push({
        title: `Placeholder: ${match.pattern} in ${match.file}`,
        severity: "medium" as FindingSeverity,
        file: match.file,
        description: `Line ${match.line}: ${match.text}`,
      });
    }

    // 8. Blocking issues: any gap is blocking
    const blockingIssues = gaps.map(
      (gap) => `[gap] Story ${gap.storyId}: ${gap.criterion.slice(0, 120)}`,
    );

    // 9. Generate report
    const report = generateReport(criterionResults, allPlaceholders, response.text);

    return {
      agent: "gap-analysis",
      success: true,
      report,
      findings,
      blockingIssues,
    };
  };
}
