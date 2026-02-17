/**
 * Test hardening agent — identifies coverage gaps and writes new tests.
 *
 * Runs after refactoring is complete. Analyzes the codebase for missing
 * test coverage, edge cases, and integration tests. Uses Claude SDK to
 * suggest new tests that should be written.
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

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".boop"]);

/**
 * Recursively collect files from a directory.
 */
export function collectFiles(dir: string, baseDir: string): string[] {
  const files: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.relative(baseDir, fullPath));
    }
  }

  return files;
}

/**
 * Separate source files from test files.
 */
export function categorizeFiles(files: string[]): {
  sourceFiles: string[];
  testFiles: string[];
} {
  const sourceFiles: string[] = [];
  const testFiles: string[] = [];

  for (const file of files) {
    if (isTestFile(file)) {
      testFiles.push(file);
    } else {
      sourceFiles.push(file);
    }
  }

  return { sourceFiles, testFiles };
}

function isTestFile(filePath: string): boolean {
  const base = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, "/");
  return (
    base.includes(".test.") ||
    base.includes(".spec.") ||
    normalized.startsWith("test/") ||
    normalized.includes("/test/") ||
    normalized.startsWith("__tests__/") ||
    normalized.includes("/__tests__/")
  );
}

/**
 * Find source files that have no corresponding test file.
 */
export function findUntestedFiles(
  sourceFiles: string[],
  testFiles: string[],
): string[] {
  const testedBases = new Set<string>();

  for (const testFile of testFiles) {
    const base = path.basename(testFile).replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "");
    testedBases.add(base);
  }

  return sourceFiles.filter((srcFile) => {
    const base = path.basename(srcFile).replace(/\.(ts|tsx|js|jsx)$/, "");
    return !testedBases.has(base);
  });
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert test engineer for a TypeScript Node.js project called Boop.
Your job is to analyze the codebase and identify test coverage gaps, missing edge case tests,
and opportunities for integration tests.

For each coverage gap or missing test, output a JSON object on its own line with this exact format:
{"title":"Short description of missing test","severity":"critical|high|medium|low|info","file":"path/to/source-file.ts","description":"What test should be written and why"}

After all findings, output a section starting with "## Summary" on its own line with:
- Overall coverage assessment
- Number of untested files
- Number of suggested new tests
- Priority recommendations

If test coverage is adequate, output:
{"title":"Coverage adequate","severity":"info","file":"","description":"Test coverage is sufficient for the current codebase."}

## Summary
Test coverage is adequate.

Rules:
- Severity guide: critical = core business logic with no tests, high = important paths untested or missing error handling tests, medium = edge cases not covered, low = minor scenarios, info = nice-to-have tests
- Focus on tests that would catch real bugs, not just coverage numbers
- Suggest specific test cases with clear descriptions
- Consider integration tests that span multiple modules
- Each finding must be a single JSON line (no multi-line JSON)`;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n... (truncated)";
}

function buildTestHardeningMessage(
  untestedFiles: string[],
  sourceContents: Array<{ path: string; content: string }>,
  testContents: Array<{ path: string; content: string }>,
): string {
  const parts: string[] = [
    "Analyze the following codebase for test coverage gaps. Identify missing tests and suggest new ones.\n",
  ];

  if (untestedFiles.length > 0) {
    parts.push("## Source Files Without Tests\n");
    for (const file of untestedFiles) {
      parts.push(`- ${file}`);
    }
    parts.push("");
  }

  // Include source file contents
  if (sourceContents.length > 0) {
    parts.push("## Source Files\n");
    for (const file of sourceContents) {
      parts.push(`### ${file.path}\n`);
      parts.push("```typescript\n" + truncate(file.content, 6000) + "\n```\n");
    }
  }

  // Include existing test file contents for context
  if (testContents.length > 0) {
    parts.push("## Existing Tests\n");
    for (const file of testContents) {
      parts.push(`### ${file.path}\n`);
      parts.push("```typescript\n" + truncate(file.content, 4000) + "\n```\n");
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set<string>(["critical", "high", "medium", "low", "info"]);

/**
 * Parse Claude's response into structured findings.
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

/**
 * Extract the summary section from Claude's response.
 */
export function extractSummary(responseText: string): string {
  const summaryIndex = responseText.indexOf("## Summary");
  if (summaryIndex === -1) return responseText;
  return responseText.slice(summaryIndex);
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(
  findings: ReviewFinding[],
  summary: string,
  untestedFiles: string[],
  totalSourceFiles: number,
  totalTestFiles: number,
): string {
  const parts: string[] = ["# Test Hardening Report\n"];

  parts.push(`**Source files:** ${totalSourceFiles}`);
  parts.push(`**Test files:** ${totalTestFiles}`);
  parts.push(`**Untested files:** ${untestedFiles.length}`);
  parts.push(
    `**Findings:** ${findings.length} (${findings.filter((f) => f.severity === "critical" || f.severity === "high").length} blocking)\n`,
  );

  if (untestedFiles.length > 0) {
    parts.push("## Untested Source Files\n");
    for (const file of untestedFiles) {
      parts.push(`- \`${file}\``);
    }
    parts.push("");
  }

  if (findings.length > 0) {
    parts.push("## Coverage Gaps\n");
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

export interface TestHardenerOptions {
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
 * Create a test hardening agent function that conforms to ReviewAgentFn.
 */
export function createTestHardener(options: TestHardenerOptions = {}) {
  const {
    clientOptions = {},
    maxRetries = 2,
    maxFilesForApi = 40,
    maxTotalChars = 100_000,
  } = options;

  return async function testHardener(context: ReviewContext): Promise<AgentResult> {
    const { projectDir } = context;

    // 1. Collect all files (source + test)
    const allFiles = collectFiles(path.join(projectDir, "src"), projectDir);
    // Also collect from test/ directory
    const testDirFiles = collectFiles(path.join(projectDir, "test"), projectDir);
    const combinedFiles = [...allFiles, ...testDirFiles];

    const { sourceFiles, testFiles } = categorizeFiles(combinedFiles);

    if (sourceFiles.length === 0) {
      return {
        agent: "test-hardening",
        success: true,
        report: "# Test Hardening Report\n\nNo source files found — nothing to analyze.",
        findings: [],
        blockingIssues: [],
      };
    }

    // 2. Identify untested files
    const untestedFiles = findUntestedFiles(sourceFiles, testFiles);

    // 3. Read file contents (respect limits)
    const sourceContents: Array<{ path: string; content: string }> = [];
    const testContents: Array<{ path: string; content: string }> = [];
    let totalChars = 0;

    // Prioritize untested files in source contents
    const prioritizedSources = [
      ...untestedFiles,
      ...sourceFiles.filter((f) => !untestedFiles.includes(f)),
    ];

    for (const filePath of prioritizedSources) {
      if (sourceContents.length >= maxFilesForApi) break;

      const fullPath = path.join(projectDir, filePath);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      if (totalChars + content.length > maxTotalChars) continue;

      sourceContents.push({ path: filePath, content });
      totalChars += content.length;
    }

    // Include some test files for context (limited)
    const maxTestFiles = Math.min(testFiles.length, 10);
    for (let i = 0; i < maxTestFiles; i++) {
      const filePath = testFiles[i];
      const fullPath = path.join(projectDir, filePath);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      if (totalChars + content.length > maxTotalChars) break;

      testContents.push({ path: filePath, content });
      totalChars += content.length;
    }

    // 4. Build prompt and call Claude
    const message = buildTestHardeningMessage(untestedFiles, sourceContents, testContents);

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

    // 5. Parse results
    const findings = parseFindings(response.text);
    const summary = extractSummary(response.text);

    // 6. Determine blocking issues (critical/high)
    const blockingIssues = findings
      .filter((f) => f.severity === "critical" || f.severity === "high")
      .map((f) => `[${f.severity}] ${f.title}${f.file ? ` in ${f.file}` : ""}`);

    // 7. Generate report
    const report = generateReport(
      findings,
      summary,
      untestedFiles,
      sourceFiles.length,
      testFiles.length,
    );

    return {
      agent: "test-hardening",
      success: true,
      report,
      findings,
      blockingIssues,
    };
  };
}
