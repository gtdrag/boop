/**
 * Credential management for Boop.
 *
 * Stores API keys securely in ~/.boop/credentials/ with 0600 file permissions.
 * Loads credentials with priority: environment variable > credential file.
 * Never writes credentials to project files or logs.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { DeveloperProfile } from "../profile/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CredentialKey =
  | "anthropic"
  | "neon"
  | "vercel"
  | "vercel-org"
  | "vercel-project"
  | "sentry"
  | "posthog"
  | "github";

export interface CredentialStore {
  /** Load a credential by key. Returns the value or null if not found. */
  load(key: CredentialKey): string | null;
  /** Save a credential by key. */
  save(key: CredentialKey, value: string): void;
  /** Delete a credential by key. Returns true if it existed. */
  delete(key: CredentialKey): boolean;
  /** Check if a credential exists (env var or file). */
  exists(key: CredentialKey): boolean;
  /** Verify that stored credential files have correct permissions (0600). */
  verifyPermissions(key: CredentialKey): CredentialPermissionResult;
}

export interface CredentialPermissionResult {
  /** Whether the file has correct permissions. */
  valid: boolean;
  /** The actual file mode (octal), or null if file doesn't exist. */
  mode: string | null;
  /** Human-readable issue description. */
  issue?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREDENTIALS_DIR = path.join(os.homedir(), ".boop", "credentials");
const REQUIRED_MODE = 0o600;

/**
 * Mapping from credential key to environment variable name.
 */
const ENV_VAR_MAP: Record<CredentialKey, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  neon: "NEON_API_KEY",
  vercel: "VERCEL_TOKEN",
  "vercel-org": "VERCEL_ORG_ID",
  "vercel-project": "VERCEL_PROJECT_ID",
  sentry: "SENTRY_DSN",
  posthog: "POSTHOG_KEY",
  github: "GH_TOKEN",
};

/**
 * Mapping from credential key to file name in the credentials directory.
 */
const FILE_MAP: Record<CredentialKey, string> = {
  anthropic: "anthropic.key",
  neon: "neon.key",
  vercel: "vercel.key",
  "vercel-org": "vercel-org.key",
  "vercel-project": "vercel-project.key",
  sentry: "sentry.key",
  posthog: "posthog.key",
  github: "github.key",
};

/**
 * Patterns that indicate a string contains a credential.
 * Used by containsCredential() for leak detection.
 *
 * Note: these patterns are intentionally non-global so .test() is safe
 * to call repeatedly without lastIndex side-effects.
 */
const CREDENTIAL_DETECTION_PATTERNS: RegExp[] = [
  /(api.?key|token|password|secret|credential)[=:]\s*\S+/i,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9]{36,}/,
  /gho_[A-Za-z0-9]{36,}/,
  /github_pat_[A-Za-z0-9_]{22,}/,
  /vercel_[A-Za-z0-9]{20,}/,
  /neon_[A-Za-z0-9_-]{20,}/,
];

/**
 * Redact credential values from a string.
 *
 * Replaces sensitive key=value patterns and known API key formats
 * with ***REDACTED***. Used by both the logger (sanitize) and
 * anywhere else that needs to strip credentials from output.
 */
export function redactCredentials(input: string): string {
  let result = input.replace(
    /(api.?key|token|password|secret|credential)[=:]\s*\S+/gi,
    "$1=***REDACTED***",
  );
  result = result.replace(/sk-ant-[A-Za-z0-9_-]+/g, "***REDACTED***");
  result = result.replace(/ghp_[A-Za-z0-9]+/g, "***REDACTED***");
  result = result.replace(/gho_[A-Za-z0-9]+/g, "***REDACTED***");
  result = result.replace(/github_pat_[A-Za-z0-9_]+/g, "***REDACTED***");
  result = result.replace(/vercel_[A-Za-z0-9]+/g, "***REDACTED***");
  result = result.replace(/neon_[A-Za-z0-9_-]+/g, "***REDACTED***");
  return result;
}

// ---------------------------------------------------------------------------
// Credential store implementation
// ---------------------------------------------------------------------------

/**
 * Create a credential store rooted at the given directory.
 * Defaults to ~/.boop/credentials/.
 */
export function createCredentialStore(credentialsDir: string = CREDENTIALS_DIR): CredentialStore {
  return {
    load(key: CredentialKey): string | null {
      // Priority 1: environment variable
      const envVar = ENV_VAR_MAP[key];
      const envValue = process.env[envVar];
      if (envValue) return envValue;

      // Priority 2: credential file
      const filePath = path.join(credentialsDir, FILE_MAP[key]);
      try {
        return fs.readFileSync(filePath, "utf-8").trim();
      } catch {
        return null;
      }
    },

    save(key: CredentialKey, value: string): void {
      // Ensure credentials directory exists with restricted permissions
      fs.mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });

      const filePath = path.join(credentialsDir, FILE_MAP[key]);
      // Write the credential and set restrictive permissions
      fs.writeFileSync(filePath, value + "\n", { mode: REQUIRED_MODE });
      // Explicit chmod in case the umask overrode the mode
      fs.chmodSync(filePath, REQUIRED_MODE);
    },

    delete(key: CredentialKey): boolean {
      const filePath = path.join(credentialsDir, FILE_MAP[key]);
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch {
        return false;
      }
    },

    exists(key: CredentialKey): boolean {
      // Check env var first
      const envVar = ENV_VAR_MAP[key];
      if (process.env[envVar]) return true;

      // Check file
      const filePath = path.join(credentialsDir, FILE_MAP[key]);
      return fs.existsSync(filePath);
    },

    verifyPermissions(key: CredentialKey): CredentialPermissionResult {
      const filePath = path.join(credentialsDir, FILE_MAP[key]);

      try {
        const stats = fs.statSync(filePath);
        const mode = stats.mode & 0o777;
        const modeStr = "0o" + mode.toString(8);

        if (mode !== REQUIRED_MODE) {
          return {
            valid: false,
            mode: modeStr,
            issue: `File ${filePath} has mode ${modeStr}, expected 0o600`,
          };
        }

        return { valid: true, mode: modeStr };
      } catch {
        return {
          valid: false,
          mode: null,
          issue: `Credential file not found: ${filePath}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Profile → required credentials mapping
// ---------------------------------------------------------------------------

/**
 * Determine which credentials a profile's stack choices require.
 * Always includes "anthropic". Adds provider-specific keys based on
 * the profile's cloudProvider, database, errorTracker, and analytics.
 */
export function getRequiredCredentials(profile: DeveloperProfile): CredentialKey[] {
  const keys: CredentialKey[] = ["anthropic"];

  if (profile.cloudProvider === "vercel") {
    keys.push("vercel");
  }
  if (profile.database === "postgresql") {
    keys.push("neon");
  }
  if (profile.errorTracker === "sentry") {
    keys.push("sentry");
  }
  if (profile.analytics === "posthog") {
    keys.push("posthog");
  }
  if (profile.sourceControl === "github") {
    keys.push("github");
  }

  return keys;
}

/**
 * Basic format validation for credential values.
 * Returns null if valid, or an error message if invalid.
 */
export function validateCredential(key: CredentialKey, value: string): string | null {
  if (!value || !value.trim()) {
    return `${key} credential cannot be empty`;
  }

  switch (key) {
    case "anthropic":
      if (!value.startsWith("sk-ant-")) {
        return "Anthropic API key should start with sk-ant-";
      }
      break;
    case "sentry":
      if (!value.startsWith("https://") || !value.includes("@")) {
        return "Sentry DSN should be a URL like https://<key>@<host>/<id>";
      }
      break;
    case "github":
      if (value.length < 10) {
        return "GitHub token appears too short";
      }
      break;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Leak detection helpers
// ---------------------------------------------------------------------------

/**
 * Check if a string contains what looks like a credential.
 * Used to prevent accidental credential leakage in logs and project files.
 */
export function containsCredential(text: string): boolean {
  return CREDENTIAL_DETECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Scan a file for credential patterns.
 * Returns true if the file contains something that looks like a credential.
 */
export function scanFileForCredentials(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return containsCredential(content);
  } catch {
    return false;
  }
}

/**
 * Get the environment variable name for a credential key.
 */
export function getEnvVarName(key: CredentialKey): string {
  return ENV_VAR_MAP[key];
}

/**
 * Get the default credentials directory path.
 */
export function getDefaultCredentialsDir(): string {
  return CREDENTIALS_DIR;
}
