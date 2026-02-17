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

const CODE_QUALITY_PROMPT = `You are an adversarial code quality reviewer. Your job is to find REAL bugs, not style nits.

Focus on:
- Logic errors and edge cases that will cause runtime failures
- Error handling gaps (unhandled promise rejections, missing catch blocks)
- Antipatterns (double-resolve, race conditions, resource leaks)
- Naming inconsistencies and API contract violations
- Duplication that introduces maintenance risk

For each finding, output a JSON object on its own line:
{"id":"cq-N","title":"Short title","severity":"critical|high|medium|low","source":"code-quality","file":"path/to/file.ts","lineRange":{"start":10,"end":15},"description":"Detailed explanation with the exact code that's wrong and why"}

Rules:
- ONLY report issues you are confident about. Do NOT guess or speculate.
- Every file path must be real — if you're not sure a file exists, do not reference it.
- Every line number must reference actual code you can see in the provided content.
- Severity: critical=data loss/crash, high=bugs, medium=antipatterns, low=minor improvements
- After all findings, output "## Summary" followed by a brief overview.`;

const TEST_COVERAGE_PROMPT = `You are an adversarial test coverage reviewer. Your job is to find untested paths and weak assertions.

Focus on:
- Functions/branches with no test coverage
- Missing edge case tests (empty input, null, boundary values, error paths)
- Tests that assert too little (e.g., just checks "no throw" instead of checking the return value)
- Integration gaps (modules tested in isolation but not their interaction)
- Missing negative tests (what happens when inputs are invalid?)

For each finding, output a JSON object on its own line:
{"id":"tc-N","title":"Short title","severity":"critical|high|medium|low","source":"test-coverage","file":"path/to/file.ts","lineRange":{"start":10,"end":15},"description":"Detailed explanation of what's untested and why it matters"}

Rules:
- ONLY report issues you are confident about. Do NOT guess or speculate.
- Every file path must be real — if you're not sure a file exists, do not reference it.
- Critical=untested crash path, high=untested error handling, medium=missing edge case, low=could be more thorough
- After all findings, output "## Summary" followed by a brief overview.`;

const SECURITY_PROMPT = `You are an adversarial security reviewer. Your job is to find real vulnerabilities, not theoretical risks.

Focus on:
- Injection vectors (command injection via user input in exec/spawn, path traversal, template injection)
- Credential/secret exposure (hardcoded keys, secrets in logs, tokens in URLs)
- Input validation gaps (unsanitized user input reaching sensitive operations)
- Dependency risks (known vulnerable patterns)
- Authentication/authorization bypasses

For each finding, output a JSON object on its own line:
{"id":"sec-N","title":"Short title","severity":"critical|high|medium|low","source":"security","file":"path/to/file.ts","lineRange":{"start":10,"end":15},"description":"Detailed explanation with the exact attack vector and remediation"}

Rules:
- ONLY report REAL vulnerabilities with a concrete attack vector. No theoretical "what if" scenarios.
- Every file path must be real — if you're not sure a file exists, do not reference it.
- Critical=RCE/data breach, high=injection/auth bypass, medium=info leak/missing validation, low=defense-in-depth
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

/** Parse adversarial findings from response text. */
export function parseAdversarialFindings(
  responseText: string,
  agentType: AdversarialAgentType,
): AdversarialFinding[] {
  const base = parseFindings(responseText);
  let counter = 1;

  return base.map((f) => ({
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
