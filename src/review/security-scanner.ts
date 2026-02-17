/**
 * Security scanner agent — runs SAST and dependency audit.
 *
 * Uses Claude SDK for static analysis of source code (SAST) and
 * `npm audit` / `pnpm audit` for dependency vulnerability scanning.
 * Results are categorized by severity. Critical/high findings block
 * epic advancement.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
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
  collectSourceFiles,
} from "./shared.js";

const execFileAsync = promisify(execFile);

// Re-export shared utilities so existing imports from this module continue to work.
export { parseFindings, extractSummary } from "./shared.js";

// ---------------------------------------------------------------------------
// Dependency audit
// ---------------------------------------------------------------------------

export interface AuditResult {
  /** Raw output from the audit command. */
  rawOutput: string;
  /** Parsed vulnerability counts by severity. */
  vulnerabilities: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    info: number;
    total: number;
  };
}

/**
 * Run `pnpm audit` (or `npm audit`) and parse the results.
 * Returns structured vulnerability counts.
 */
export async function runDependencyAudit(projectDir: string): Promise<AuditResult> {
  const defaultResult: AuditResult = {
    rawOutput: "",
    vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 },
  };

  // Try pnpm audit first, then npm audit
  for (const cmd of ["pnpm", "npm"]) {
    try {
      const { stdout } = await execFileAsync(cmd, ["audit", "--json"], {
        cwd: projectDir,
        maxBuffer: 10 * 1024 * 1024,
      });
      return parseAuditOutput(stdout);
    } catch (error: unknown) {
      // pnpm/npm audit exits with non-zero when vulnerabilities are found
      if (
        error &&
        typeof error === "object" &&
        "stdout" in error &&
        typeof (error as { stdout: unknown }).stdout === "string"
      ) {
        return parseAuditOutput((error as { stdout: string }).stdout);
      }
      // Command not found or other error — try next
      continue;
    }
  }

  return defaultResult;
}

/**
 * Parse JSON output from pnpm/npm audit.
 */
export function parseAuditOutput(rawOutput: string): AuditResult {
  const result: AuditResult = {
    rawOutput,
    vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 },
  };

  try {
    const parsed = JSON.parse(rawOutput) as Record<string, unknown>;

    // npm audit format
    if (parsed.metadata && typeof parsed.metadata === "object") {
      const meta = parsed.metadata as Record<string, unknown>;
      if (meta.vulnerabilities && typeof meta.vulnerabilities === "object") {
        const vulns = meta.vulnerabilities as Record<string, number>;
        result.vulnerabilities.critical = vulns.critical ?? 0;
        result.vulnerabilities.high = vulns.high ?? 0;
        result.vulnerabilities.moderate = vulns.moderate ?? 0;
        result.vulnerabilities.low = vulns.low ?? 0;
        result.vulnerabilities.info = vulns.info ?? 0;
        result.vulnerabilities.total = vulns.total ?? 0;
      }
    }

    // pnpm audit format (advisories-based)
    if (parsed.advisories && typeof parsed.advisories === "object") {
      const advisories = parsed.advisories as Record<
        string,
        { severity?: string }
      >;
      for (const advisory of Object.values(advisories)) {
        const sev = advisory.severity?.toLowerCase();
        if (sev === "critical") result.vulnerabilities.critical++;
        else if (sev === "high") result.vulnerabilities.high++;
        else if (sev === "moderate") result.vulnerabilities.moderate++;
        else if (sev === "low") result.vulnerabilities.low++;
        else result.vulnerabilities.info++;
        result.vulnerabilities.total++;
      }
    }
  } catch {
    // JSON parse failed — return raw output with zero counts
  }

  return result;
}

// ---------------------------------------------------------------------------
// SAST via Claude SDK
// ---------------------------------------------------------------------------

const SAST_SYSTEM_PROMPT = `You are an expert security analyst performing Static Application Security Testing (SAST) on a TypeScript Node.js project called Boop.

Analyze the source code for security vulnerabilities including but not limited to:
- Command injection (exec, execFile, spawn with unsanitized input)
- Path traversal (joining user input to file paths without validation)
- SQL injection (if applicable)
- XSS (cross-site scripting)
- Insecure deserialization
- Hardcoded secrets or credentials
- Insecure cryptographic practices
- Missing input validation at system boundaries
- Prototype pollution
- Insecure file operations (world-readable permissions, temp file races)
- Missing authentication/authorization checks
- Information leakage in error messages

For each vulnerability found, output a JSON object on its own line with this exact format:
{"title":"Short description","severity":"critical|high|medium|low|info","file":"path/to/file.ts","description":"Detailed explanation including the vulnerable code pattern and recommended fix"}

After all findings, output a section starting with "## Summary" on its own line with:
- Total vulnerabilities found by severity
- Overall security posture assessment
- Priority recommendations

If no vulnerabilities are found, output:
{"title":"No vulnerabilities found","severity":"info","file":"","description":"SAST scan completed with no security findings."}

## Summary
No vulnerabilities found. Security posture is clean.

Rules:
- Severity guide: critical = remote code execution / data breach, high = exploitable vulnerability, medium = potential vulnerability with mitigating factors, low = defense-in-depth issue, info = observation/best practice
- Be specific about the vulnerable code pattern and file location
- Include concrete remediation advice in the description
- Focus on real vulnerabilities, not theoretical edge cases
- Each finding must be a single JSON line (no multi-line JSON)`;

function buildSastMessage(
  sourceContents: Array<{ path: string; content: string }>,
): string {
  const parts: string[] = [
    "Perform a SAST security scan on the following source files. For each vulnerability, output a JSON finding line.\n",
  ];

  for (const file of sourceContents) {
    parts.push(`### ${file.path}\n`);
    parts.push("```typescript\n" + truncate(file.content, 6000) + "\n```\n");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(
  sastFindings: ReviewFinding[],
  sastSummary: string,
  audit: AuditResult,
  filesScanned: number,
): string {
  const parts: string[] = ["# Security Scan Report\n"];

  // SAST section
  const blockingCount = sastFindings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  ).length;
  parts.push("## SAST Analysis\n");
  parts.push(`**Files scanned:** ${filesScanned}`);
  parts.push(`**Findings:** ${sastFindings.length} (${blockingCount} blocking)\n`);

  if (sastFindings.length > 0) {
    for (const finding of sastFindings) {
      const fileRef = finding.file ? ` in \`${finding.file}\`` : "";
      parts.push(`### [${finding.severity.toUpperCase()}] ${finding.title}${fileRef}\n`);
      parts.push(`${finding.description}\n`);
    }
  }

  parts.push(`\n${sastSummary}\n`);

  // Dependency audit section
  parts.push("## Dependency Audit\n");
  const v = audit.vulnerabilities;
  parts.push(`| Severity | Count |`);
  parts.push(`| --- | --- |`);
  parts.push(`| Critical | ${v.critical} |`);
  parts.push(`| High | ${v.high} |`);
  parts.push(`| Moderate | ${v.moderate} |`);
  parts.push(`| Low | ${v.low} |`);
  parts.push(`| Info | ${v.info} |`);
  parts.push(`| **Total** | **${v.total}** |\n`);

  if (v.critical > 0 || v.high > 0) {
    parts.push(
      `**BLOCKING:** ${v.critical} critical and ${v.high} high dependency vulnerabilities must be resolved.\n`,
    );
  } else if (v.total > 0) {
    parts.push(
      `${v.total} non-blocking dependency vulnerabilities found (moderate/low/info).\n`,
    );
  } else {
    parts.push("No dependency vulnerabilities found.\n");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Main agent
// ---------------------------------------------------------------------------

export interface SecurityScannerOptions {
  /** Claude client options (API key, model). */
  clientOptions?: ClaudeClientOptions;
  /** Maximum number of API retries. Defaults to 2. */
  maxRetries?: number;
  /** Maximum number of source files to include in the API call. Defaults to 40. */
  maxFilesForApi?: number;
  /** Maximum total chars of file content for the API call. Defaults to 100000. */
  maxTotalChars?: number;
  /** Custom dependency audit function (for testing). */
  auditFn?: (projectDir: string) => Promise<AuditResult>;
}

/**
 * Create a security scanner agent function that conforms to ReviewAgentFn.
 */
export function createSecurityScanner(options: SecurityScannerOptions = {}) {
  const {
    clientOptions = {},
    maxRetries = 2,
    maxFilesForApi = 40,
    maxTotalChars = 100_000,
    auditFn = runDependencyAudit,
  } = options;

  return async function securityScanner(context: ReviewContext): Promise<AgentResult> {
    const { projectDir } = context;

    // 1. Collect source files
    const sourceFiles = collectSourceFiles(path.join(projectDir, "src"), projectDir);

    // 2. Run dependency audit in parallel with SAST
    const auditPromise = auditFn(projectDir);

    // 3. SAST via Claude SDK
    let sastFindings: ReviewFinding[] = [];
    let sastSummary = "## Summary\nNo source files to scan.";

    if (sourceFiles.length > 0) {
      // Read file contents (respect limits)
      const sourceContents: Array<{ path: string; content: string }> = [];
      let totalChars = 0;

      for (const filePath of sourceFiles) {
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

      if (sourceContents.length > 0) {
        const message = buildSastMessage(sourceContents);

        const response = await retry(
          () =>
            sendMessage({ ...clientOptions, maxTokens: 8192 }, SAST_SYSTEM_PROMPT, [
              { role: "user", content: message },
            ]),
          {
            maxRetries,
            isRetryable: isRetryableApiError,
          },
        );

        sastFindings = parseFindings(response.text);
        sastSummary = extractSummary(response.text);
      }
    }

    // 4. Await dependency audit
    const audit = await auditPromise;

    // 5. Convert audit findings to ReviewFindings
    const auditFindings: ReviewFinding[] = [];
    const v = audit.vulnerabilities;

    if (v.critical > 0) {
      auditFindings.push({
        title: `${v.critical} critical dependency vulnerabilities`,
        severity: "critical",
        description: `npm/pnpm audit found ${v.critical} critical vulnerabilities in dependencies. Run \`pnpm audit\` for details.`,
      });
    }
    if (v.high > 0) {
      auditFindings.push({
        title: `${v.high} high dependency vulnerabilities`,
        severity: "high",
        description: `npm/pnpm audit found ${v.high} high-severity vulnerabilities in dependencies. Run \`pnpm audit\` for details.`,
      });
    }
    if (v.moderate > 0) {
      auditFindings.push({
        title: `${v.moderate} moderate dependency vulnerabilities`,
        severity: "medium",
        description: `npm/pnpm audit found ${v.moderate} moderate vulnerabilities in dependencies.`,
      });
    }
    if (v.low > 0) {
      auditFindings.push({
        title: `${v.low} low dependency vulnerabilities`,
        severity: "low",
        description: `npm/pnpm audit found ${v.low} low-severity vulnerabilities in dependencies.`,
      });
    }

    // 6. Combine all findings
    const allFindings = [...sastFindings, ...auditFindings];

    // 7. Determine blocking issues (critical/high)
    const blockingIssues = allFindings
      .filter((f) => f.severity === "critical" || f.severity === "high")
      .map((f) => `[${f.severity}] ${f.title}${f.file ? ` in ${f.file}` : ""}`);

    // 8. Generate report
    const report = generateReport(sastFindings, sastSummary, audit, sourceFiles.length);

    return {
      agent: "security-scan",
      success: true,
      report,
      findings: allFindings,
      blockingIssues,
    };
  };
}
