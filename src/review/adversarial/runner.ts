/**
 * Adversarial review runner — spawns three specialized review agents in parallel.
 *
 * Each agent has a distinct lens:
 *   - Code quality: antipatterns, duplication, naming, error handling, edge cases
 *   - Test coverage: untested paths, missing assertions, boundary conditions
 *   - Security: injection vectors, credential leaks, dependency vulnerabilities
 *
 * Agents are scoped to the current epic's changed files via git diff.
 * Returns structured findings with severity, file path, and description.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { sendMessage, isRetryableApiError } from "../../shared/claude-client.js";
import type { ClaudeClientOptions } from "../../shared/claude-client.js";
import { retry } from "../../shared/retry.js";
import type { ReviewFinding, FindingSeverity } from "../team-orchestrator.js";
import { truncate, parseFindings, readFileContent } from "../shared.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdversarialAgentType = "code-quality" | "test-coverage" | "security";

export interface AdversarialFinding extends ReviewFinding {
  /** Unique finding ID for tracking across iterations. */
  id: string;
  /** Which adversarial agent produced this finding. */
  source: AdversarialAgentType;
  /** Line range in the file (approximate, from the agent). */
  lineRange?: { start: number; end: number };
}

export interface AdversarialAgentResult {
  /** Which agent produced this. */
  agent: AdversarialAgentType;
  /** Structured findings. */
  findings: AdversarialFinding[];
  /** Raw report text. */
  report: string;
  /** Whether the agent completed successfully. */
  success: boolean;
}

export interface AdversarialRunnerOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Epic number being reviewed. */
  epicNumber: number;
  /** Base branch to diff against. Defaults to "main". */
  baseBranch?: string;
  /** Claude client options. */
  clientOptions?: ClaudeClientOptions;
  /** Max retries per API call. */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export async function getChangedFiles(projectDir: string, baseBranch = "main"): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMR", baseBranch, "HEAD"],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout
      .trim()
      .split("\n")
      .filter((f) => f.length > 0 && /\.(ts|tsx|js|jsx)$/.test(f));
  } catch {
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

// ---------------------------------------------------------------------------
// Agent prompts
// ---------------------------------------------------------------------------

const CODE_QUALITY_PROMPT = `You are an adversarial code quality reviewer. Your job is to find REAL bugs that will break production, not style nits or theoretical concerns.

Focus ONLY on:
- Logic errors that WILL cause runtime crashes or incorrect behavior
- Unhandled promise rejections or missing catch blocks on critical paths
- Race conditions that lead to data corruption
- Resource leaks (open handles, unsubscribed listeners)

Do NOT report:
- Style preferences or naming opinions
- "Could be improved" suggestions
- Theoretical edge cases that require unlikely conditions
- Missing type annotations or documentation

For each finding, output a JSON object on its own line:
{"id":"cq-N","title":"Short title","severity":"critical|high|medium|low","source":"code-quality","file":"path/to/file.ts","lineRange":{"start":10,"end":15},"description":"Detailed explanation with the exact code that's wrong and why"}

Rules:
- Report AT MOST 5 findings. Prioritize the most severe issues.
- ONLY report issues you are confident about. Do NOT guess or speculate.
- Every file path must be real — if you're not sure a file exists, do not reference it.
- Every line number must reference actual code you can see in the provided content.
- Severity: critical=data loss/crash, high=bugs that affect correctness, medium=antipatterns with real impact, low=minor improvements
- Prefer fewer HIGH findings over many LOW ones. Quality over quantity.
- After all findings, output "## Summary" followed by a brief overview.`;

const TEST_COVERAGE_PROMPT = `You are a test coverage reviewer. Your job is to identify CRITICAL untested paths — code that will break in production with no safety net.

Focus ONLY on:
- Core happy-path logic with ZERO test coverage
- Error handling on critical paths (API calls, database operations, file I/O) with no tests
- Functions that handle user input or money with no validation tests

Do NOT report:
- Missing edge case tests for unlikely inputs (null in arrays, whitespace strings, etc.)
- Tests that "could be more thorough" — if the happy path is tested, that's enough
- Missing negative tests for internal functions that only receive validated input
- Test quality opinions ("should assert return value not just no-throw")
- Integration test gaps — unit tests are sufficient for most code

For each finding, output a JSON object on its own line:
{"id":"tc-N","title":"Short title","severity":"critical|high|medium|low","source":"test-coverage","file":"path/to/file.ts","lineRange":{"start":10,"end":15},"description":"Detailed explanation of what's untested and why it matters"}

Rules:
- Report AT MOST 3 findings. Only the most important untested paths.
- ONLY report issues you are confident about. Do NOT guess or speculate.
- Every file path must be real — if you're not sure a file exists, do not reference it.
- Critical=untested path that WILL crash in production, high=untested error handling on critical paths, medium=important branch with no coverage, low=nice-to-have coverage
- If coverage looks reasonable, report ZERO findings. Not every file needs exhaustive tests.
- After all findings, output "## Summary" followed by a brief overview.`;

const SECURITY_PROMPT = `You are a security reviewer. Your job is to find EXPLOITABLE vulnerabilities, not defense-in-depth wishlists.

Focus ONLY on:
- Injection vectors where USER INPUT reaches exec/spawn/eval (command injection, SQL injection)
- Path traversal where USER INPUT controls file paths
- Credential/secret exposure (hardcoded keys, secrets in logs)
- Authentication/authorization bypasses

Do NOT report:
- "Defense in depth" suggestions (adding validation on already-validated data)
- TOCTOU races that require local filesystem access (not a remote attack vector)
- Symlink attacks on files the application creates internally
- Missing input validation on internal functions that don't receive user input
- Theoretical scenarios requiring unlikely preconditions

For each finding, output a JSON object on its own line:
{"id":"sec-N","title":"Short title","severity":"critical|high|medium|low","source":"security","file":"path/to/file.ts","lineRange":{"start":10,"end":15},"description":"Detailed explanation with the exact attack vector and remediation"}

Rules:
- Report AT MOST 5 findings. Only real, exploitable vulnerabilities.
- ONLY report issues with a CONCRETE attack vector you can describe step by step.
- Every file path must be real — if you're not sure a file exists, do not reference it.
- Critical=RCE/data breach, high=injection/auth bypass, medium=info leak with real exposure, low=hardening
- If the code is reasonably secure, report ZERO findings. Don't manufacture issues.
- After all findings, output "## Summary" followed by a brief overview.`;

const AGENT_PROMPTS: Record<AdversarialAgentType, string> = {
  "code-quality": CODE_QUALITY_PROMPT,
  "test-coverage": TEST_COVERAGE_PROMPT,
  security: SECURITY_PROMPT,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserMessage(files: Array<{ path: string; content: string }>): string {
  const parts: string[] = [
    "Review the following source files. For each issue found, output a JSON finding line.\n",
  ];

  for (const file of files) {
    parts.push(`### File: ${file.path}\n`);
    parts.push("```typescript\n" + truncate(file.content, 10_000) + "\n```\n");
  }

  return parts.join("\n");
}

/** Max findings per agent — hard cap enforced regardless of what the agent returns. */
const MAX_FINDINGS_PER_AGENT = 5;

/** Parse adversarial findings from response text. */
export function parseAdversarialFindings(
  responseText: string,
  agentType: AdversarialAgentType,
): AdversarialFinding[] {
  const base = parseFindings(responseText);
  let counter = 1;

  // Sort by severity (most severe first) so the cap keeps the important ones
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  const sorted = [...base].sort(
    (a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4),
  );

  return sorted.slice(0, MAX_FINDINGS_PER_AGENT).map((f) => ({
    ...f,
    id: `${agentType.slice(0, 3)}-${counter++}`,
    source: agentType,
    lineRange: undefined,
  }));
}

// ---------------------------------------------------------------------------
// Single agent runner
// ---------------------------------------------------------------------------

async function runSingleAgent(
  agentType: AdversarialAgentType,
  files: Array<{ path: string; content: string }>,
  clientOptions: ClaudeClientOptions,
  maxRetries: number,
): Promise<AdversarialAgentResult> {
  if (files.length === 0) {
    return {
      agent: agentType,
      findings: [],
      report: "No files to review.",
      success: true,
    };
  }

  const systemPrompt = AGENT_PROMPTS[agentType];
  const userMessage = buildUserMessage(files);

  const response = await retry(
    () => sendMessage(clientOptions, systemPrompt, [{ role: "user", content: userMessage }]),
    { maxRetries, isRetryable: isRetryableApiError },
  );

  const findings = parseAdversarialFindings(response.text, agentType);

  return {
    agent: agentType,
    findings,
    report: response.text,
    success: true,
  };
}

// ---------------------------------------------------------------------------
// Parallel runner (public API)
// ---------------------------------------------------------------------------

/**
 * Run all three adversarial agents in parallel.
 *
 * Scopes review to files changed in the current epic (via git diff).
 * Returns combined results from all three agents.
 */
export async function runAdversarialAgents(
  options: AdversarialRunnerOptions,
): Promise<AdversarialAgentResult[]> {
  const { projectDir, baseBranch = "main", clientOptions = {}, maxRetries = 2 } = options;

  // Get changed files and read their content
  const changedPaths = await getChangedFiles(projectDir, baseBranch);
  const files = changedPaths.map((p) => ({
    path: p,
    content: readFileContent(projectDir, p),
  }));

  // Run all three agents in parallel
  const agents: AdversarialAgentType[] = ["code-quality", "test-coverage", "security"];

  const results = await Promise.all(
    agents.map(async (agentType) => {
      try {
        return await runSingleAgent(agentType, files, clientOptions, maxRetries);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          agent: agentType,
          findings: [],
          report: `Agent failed: ${msg}`,
          success: false,
        } satisfies AdversarialAgentResult;
      }
    }),
  );

  return results;
}
