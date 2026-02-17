/**
 * Security audit checklist for Boop.
 *
 * Programmatic checks that verify:
 *   - Sandbox configuration exists and is valid
 *   - Credentials have correct file permissions (0600)
 *   - Logger has credential filtering (sanitize function)
 *   - Git hooks prevent secret commits (.gitignore covers credentials)
 *   - No credential patterns found in project files
 *
 * Run before release or as part of the pipeline's REVIEWING phase.
 */

import fs from "node:fs";
import path from "node:path";
import {
  createCredentialStore,
  containsCredential,
  getDefaultCredentialsDir,
  type CredentialKey,
} from "./credentials.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditCheck {
  /** Short identifier for the check. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Category of the check. */
  category: AuditCategory;
  /** Whether the check passed. */
  passed: boolean;
  /** Details when the check fails. */
  details?: string;
}

export type AuditCategory =
  | "sandbox"
  | "credentials"
  | "logging"
  | "git-safety"
  | "leak-detection";

export interface AuditReport {
  /** ISO-8601 timestamp of the audit run. */
  timestamp: string;
  /** Whether all checks passed. */
  allPassed: boolean;
  /** Total number of checks run. */
  totalChecks: number;
  /** Number of checks that passed. */
  passedChecks: number;
  /** Number of checks that failed. */
  failedChecks: number;
  /** Individual check results. */
  checks: AuditCheck[];
}

export interface AuditOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Credentials directory override. Defaults to ~/.boop/credentials/. */
  credentialsDir?: string;
  /** File extensions to scan for credential leaks. */
  scanExtensions?: string[];
  /** Directories to skip during leak scanning. */
  skipDirs?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SCAN_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".json",
  ".yaml",
  ".yml",
  ".env",
  ".toml",
  ".md",
  ".txt",
]);

const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
]);

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Check that sandbox policy module exists in the project.
 */
function checkSandboxPolicyExists(projectDir: string): AuditCheck {
  const policyPath = path.join(projectDir, "src", "sandbox", "policy.ts");
  const exists = fs.existsSync(policyPath);

  return {
    id: "sandbox-policy-exists",
    description: "Sandbox policy module exists",
    category: "sandbox",
    passed: exists,
    details: exists ? undefined : `Missing: ${policyPath}`,
  };
}

/**
 * Check that Docker runner module exists.
 */
function checkDockerRunnerExists(projectDir: string): AuditCheck {
  const runnerPath = path.join(projectDir, "src", "sandbox", "docker-runner.ts");
  const exists = fs.existsSync(runnerPath);

  return {
    id: "docker-runner-exists",
    description: "Docker sandbox runner module exists",
    category: "sandbox",
    passed: exists,
    details: exists ? undefined : `Missing: ${runnerPath}`,
  };
}

/**
 * Check that credential files have correct permissions (0600).
 */
function checkCredentialPermissions(
  credentialsDir: string,
): AuditCheck {
  const store = createCredentialStore(credentialsDir);
  const keys: CredentialKey[] = ["anthropic"];
  const issues: string[] = [];

  for (const key of keys) {
    const result = store.verifyPermissions(key);
    // File not existing is OK (env var might be used instead)
    if (result.mode !== null && !result.valid) {
      issues.push(result.issue!);
    }
  }

  return {
    id: "credential-permissions",
    description: "Credential files have 0600 permissions",
    category: "credentials",
    passed: issues.length === 0,
    details: issues.length > 0 ? issues.join("; ") : undefined,
  };
}

/**
 * Check that the credentials directory has correct permissions (0700).
 */
function checkCredentialsDirPermissions(
  credentialsDir: string,
): AuditCheck {
  try {
    const stats = fs.statSync(credentialsDir);
    const mode = stats.mode & 0o777;
    const valid = mode === 0o700;

    return {
      id: "credentials-dir-permissions",
      description: "Credentials directory has 0700 permissions",
      category: "credentials",
      passed: valid,
      details: valid
        ? undefined
        : `Directory ${credentialsDir} has mode 0o${mode.toString(8)}, expected 0o700`,
    };
  } catch {
    // Directory doesn't exist — that's fine if env vars are used
    return {
      id: "credentials-dir-permissions",
      description: "Credentials directory has 0700 permissions",
      category: "credentials",
      passed: true,
      details: "Credentials directory does not exist (env vars may be used)",
    };
  }
}

/**
 * Check that the logger module has a sanitize function.
 */
function checkLoggerSanitization(projectDir: string): AuditCheck {
  const loggerPath = path.join(projectDir, "src", "shared", "logger.ts");

  try {
    const content = fs.readFileSync(loggerPath, "utf-8");
    const hasSanitize = content.includes("export function sanitize(");
    const usedInWrite = content.includes("sanitize(");

    return {
      id: "logger-sanitization",
      description: "Logger has credential sanitization",
      category: "logging",
      passed: hasSanitize && usedInWrite,
      details:
        !hasSanitize
          ? "sanitize() function not found in logger"
          : !usedInWrite
            ? "sanitize() exists but is not used in log writing"
            : undefined,
    };
  } catch {
    return {
      id: "logger-sanitization",
      description: "Logger has credential sanitization",
      category: "logging",
      passed: false,
      details: `Logger file not found: ${loggerPath}`,
    };
  }
}

/**
 * Check that .gitignore covers credential files.
 */
function checkGitignoreCoversCredentials(projectDir: string): AuditCheck {
  const gitignorePath = path.join(projectDir, ".gitignore");

  try {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    // Check for patterns that would match credential files
    const patterns = [".boop/", "*.key", ".env"];
    const missing = patterns.filter((p) => !content.includes(p));

    return {
      id: "gitignore-credentials",
      description: ".gitignore covers credential patterns",
      category: "git-safety",
      passed: missing.length === 0,
      details:
        missing.length > 0
          ? `Missing .gitignore patterns: ${missing.join(", ")}`
          : undefined,
    };
  } catch {
    return {
      id: "gitignore-credentials",
      description: ".gitignore covers credential patterns",
      category: "git-safety",
      passed: false,
      details: `.gitignore not found at ${gitignorePath}`,
    };
  }
}

/**
 * Scan project source files for accidental credential leakage.
 */
function checkNoCredentialLeaks(
  projectDir: string,
  scanExtensions: Set<string>,
  skipDirs: Set<string>,
): AuditCheck {
  const leaks: string[] = [];

  function walkDir(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          walkDir(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (scanExtensions.has(ext)) {
          const filePath = path.join(dir, entry.name);
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            if (containsCredential(content)) {
              leaks.push(path.relative(projectDir, filePath));
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
  }

  walkDir(projectDir);

  return {
    id: "no-credential-leaks",
    description: "No credential patterns found in source files",
    category: "leak-detection",
    passed: leaks.length === 0,
    details:
      leaks.length > 0
        ? `Credential patterns found in: ${leaks.join(", ")}`
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Main audit runner
// ---------------------------------------------------------------------------

/**
 * Run the full security audit checklist.
 */
export function runSecurityAudit(options: AuditOptions): AuditReport {
  const credentialsDir =
    options.credentialsDir ?? getDefaultCredentialsDir();
  const scanExtensions = new Set(
    options.scanExtensions ?? [...DEFAULT_SCAN_EXTENSIONS],
  );
  const skipDirs = new Set(options.skipDirs ?? [...DEFAULT_SKIP_DIRS]);

  const checks: AuditCheck[] = [
    // Sandbox checks
    checkSandboxPolicyExists(options.projectDir),
    checkDockerRunnerExists(options.projectDir),

    // Credential checks
    checkCredentialPermissions(credentialsDir),
    checkCredentialsDirPermissions(credentialsDir),

    // Logging checks
    checkLoggerSanitization(options.projectDir),

    // Git safety checks
    checkGitignoreCoversCredentials(options.projectDir),

    // Leak detection
    checkNoCredentialLeaks(options.projectDir, scanExtensions, skipDirs),
  ];

  const passedChecks = checks.filter((c) => c.passed).length;

  return {
    timestamp: new Date().toISOString(),
    allPassed: passedChecks === checks.length,
    totalChecks: checks.length,
    passedChecks,
    failedChecks: checks.length - passedChecks,
    checks,
  };
}

/**
 * Format an audit report as a human-readable string.
 */
export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push("# Boop Security Audit Report");
  lines.push(`Date: ${report.timestamp}`);
  lines.push(`Result: ${report.allPassed ? "PASSED" : "FAILED"}`);
  lines.push(`Checks: ${report.passedChecks}/${report.totalChecks} passed`);
  lines.push("");

  const categories = [...new Set(report.checks.map((c) => c.category))];

  for (const category of categories) {
    lines.push(`## ${category}`);
    const categoryChecks = report.checks.filter(
      (c) => c.category === category,
    );
    for (const check of categoryChecks) {
      const icon = check.passed ? "[PASS]" : "[FAIL]";
      lines.push(`${icon} ${check.description}`);
      if (check.details) {
        lines.push(`      ${check.details}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
