/**
 * Sandbox policy engine — defines and enforces command execution rules.
 *
 * The policy engine wraps shell commands to enforce:
 *   - Blocked commands (rm -rf /, shutdown, etc.)
 *   - Blocked file paths (anything outside the project directory)
 *   - Blocked git operations (force push, reset --hard on main/master)
 *   - Allowed network destinations (Claude API only in sandbox mode)
 *
 * Commands are validated BEFORE execution — a denied command never runs.
 */

import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PolicyVerdict = "allow" | "deny";

export interface PolicyResult {
  /** Whether the command is allowed. */
  verdict: PolicyVerdict;
  /** Human-readable reason (set when denied). */
  reason?: string;
}

export interface SandboxPolicy {
  /** Absolute path to the project root — all file access scoped to this. */
  projectDir: string;
  /** Additional directories to allow read/write access (e.g. ~/.boop). */
  allowedPaths?: string[];
  /** Whether to enforce network restrictions. Defaults to true. */
  enforceNetwork?: boolean;
  /** Allowed network hosts when enforceNetwork is true. */
  allowedHosts?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Commands that are always blocked regardless of arguments.
 */
const BLOCKED_COMMANDS = new Set([
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init",
  "systemctl",
  "mkfs",
  "fdisk",
  "dd",
  "mount",
  "umount",
]);

/**
 * Dangerous flag patterns on git commands.
 */
const BLOCKED_GIT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bpush\b.*--force\b/,
    reason: "Force push is blocked — may overwrite remote history",
  },
  {
    pattern: /\bpush\b.*-f\b/,
    reason: "Force push (-f) is blocked — may overwrite remote history",
  },
  {
    pattern: /\breset\b.*--hard\b/,
    reason: "git reset --hard is blocked — may discard uncommitted work",
  },
  {
    pattern: /\bclean\b.*-f\b/,
    reason: "git clean -f is blocked — removes untracked files permanently",
  },
  {
    pattern: /\bbranch\b.*-D\b/,
    reason: "git branch -D is blocked — force-deletes branches",
  },
];

/**
 * Patterns for destructive file operations.
 */
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\b.*--force)\s+\//,
    reason: "Recursive force delete (rm -rf) on absolute paths is blocked",
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/(?!\S*\/)/,
    reason: "Deleting from root filesystem is blocked",
  },
  {
    pattern: /\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*)?\s*(000|777)\s+\//,
    reason: "Recursive permission changes on root filesystem are blocked",
  },
  {
    pattern: />\s*\/dev\/sd[a-z]/,
    reason: "Writing directly to block devices is blocked",
  },
];

/**
 * Default allowed hosts for Claude API access.
 */
export const DEFAULT_ALLOWED_HOSTS = [
  "api.anthropic.com",
  "api.anthropic.com:443",
];

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Check if a path is within the allowed boundaries (project dir + allowed paths).
 */
export function isPathAllowed(
  targetPath: string,
  policy: SandboxPolicy,
): PolicyResult {
  const resolved = path.resolve(targetPath);
  const normalizedProject = path.resolve(policy.projectDir);

  // Project directory is always allowed
  if (resolved.startsWith(normalizedProject + path.sep) || resolved === normalizedProject) {
    return { verdict: "allow" };
  }

  // Check additional allowed paths
  if (policy.allowedPaths) {
    for (const allowed of policy.allowedPaths) {
      const normalizedAllowed = path.resolve(allowed);
      if (resolved.startsWith(normalizedAllowed + path.sep) || resolved === normalizedAllowed) {
        return { verdict: "allow" };
      }
    }
  }

  return {
    verdict: "deny",
    reason: `Path '${resolved}' is outside the allowed directories`,
  };
}

// ---------------------------------------------------------------------------
// Command parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract the base command from a shell command string.
 * Handles pipes, redirections, env vars, sudo, etc.
 */
export function extractBaseCommand(command: string): string {
  const trimmed = command.trim();

  // Skip env var assignments (KEY=value command)
  const afterEnvVars = trimmed.replace(/^(\s*\w+=\S+\s+)+/, "");

  // Skip sudo and its options. Sudo flags that take arguments (-u, -g, -C, etc.)
  // consume the next token too.
  let afterSudo = afterEnvVars;
  if (/^sudo\b/.test(afterSudo)) {
    afterSudo = afterSudo.replace(/^sudo\s+/, "");
    // Consume flags: flags with required arguments (-u user, -g group, -C fd)
    // and simple flags (-E, -H, -n, etc.)
    const flagsWithArgs = new Set(["u", "g", "C", "D", "R", "T", "h", "p"]);
    while (/^-/.test(afterSudo)) {
      const flagMatch = afterSudo.match(/^-(\S+)\s*/);
      if (!flagMatch) break;
      const flag = flagMatch[1];
      afterSudo = afterSudo.slice(flagMatch[0].length);
      // If the flag takes an argument, skip the next token too
      if (flag.length === 1 && flagsWithArgs.has(flag)) {
        afterSudo = afterSudo.replace(/^\S+\s*/, "");
      }
    }
  }

  // Get the first word (the actual command)
  const match = afterSudo.match(/^(\S+)/);
  return match ? match[1] : "";
}

/**
 * Extract file path arguments from a command string.
 * Looks for paths that start with / or ~ or ../ or contain path separators.
 */
export function extractPaths(command: string): string[] {
  const paths: string[] = [];
  // Match absolute paths, relative paths, and home-dir paths
  const pathPattern = /(?:^|\s)(\/\S+|~\/\S+|\.\.\/\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pathPattern.exec(command)) !== null) {
    paths.push(match[1].trim());
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Main policy evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a shell command against the sandbox policy.
 *
 * @returns A PolicyResult indicating whether the command is allowed.
 */
export function evaluateCommand(
  command: string,
  policy: SandboxPolicy,
): PolicyResult {
  const baseCommand = extractBaseCommand(command);

  // 1. Check blocked commands
  if (BLOCKED_COMMANDS.has(baseCommand)) {
    return {
      verdict: "deny",
      reason: `Command '${baseCommand}' is blocked by sandbox policy`,
    };
  }

  // 2. Check git-specific rules
  if (baseCommand === "git") {
    for (const rule of BLOCKED_GIT_PATTERNS) {
      if (rule.pattern.test(command)) {
        return { verdict: "deny", reason: rule.reason };
      }
    }
  }

  // 3. Check destructive patterns
  for (const rule of DESTRUCTIVE_PATTERNS) {
    if (rule.pattern.test(command)) {
      return { verdict: "deny", reason: rule.reason };
    }
  }

  // 4. Check file paths in the command
  const paths = extractPaths(command);
  for (const p of paths) {
    const expanded = p.startsWith("~")
      ? path.join(process.env.HOME ?? "/root", p.slice(1))
      : p;
    const pathResult = isPathAllowed(expanded, policy);
    if (pathResult.verdict === "deny") {
      return pathResult;
    }
  }

  return { verdict: "allow" };
}

// ---------------------------------------------------------------------------
// Policy factory
// ---------------------------------------------------------------------------

/**
 * Create a sandbox policy for the given project directory.
 * Includes sensible defaults (allows ~/.boop, enforces network restrictions).
 */
export function createPolicy(
  projectDir: string,
  options?: Partial<Omit<SandboxPolicy, "projectDir">>,
): SandboxPolicy {
  const homeDir = process.env.HOME ?? "/root";

  return {
    projectDir: path.resolve(projectDir),
    allowedPaths: options?.allowedPaths ?? [
      path.join(homeDir, ".boop"),
    ],
    enforceNetwork: options?.enforceNetwork ?? true,
    allowedHosts: options?.allowedHosts ?? DEFAULT_ALLOWED_HOSTS,
  };
}
