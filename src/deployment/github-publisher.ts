/**
 * GitHub repository creation and code push for autonomous deployments.
 *
 * Uses the `gh` CLI to create repos and `git` to push branches.
 * Follows the same pattern as database-provisioner.ts: returns a result
 * object and never throws.
 */
import { execFileSync, execSync } from "node:child_process";
import { createCredentialStore, type CredentialKey } from "../security/credentials.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubPublishResult {
  success: boolean;
  repoUrl: string | null;
  output: string;
  error?: string;
}

export interface GitHubPublishOptions {
  projectDir: string;
  repoName: string;
  private?: boolean;
  description?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize git remote URLs (SSH → HTTPS). */
function normalizeToHttps(url: string): string {
  // git@github.com:user/repo.git → https://github.com/user/repo
  const sshMatch = url.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }
  // Strip trailing .git from HTTPS URLs
  return url.replace(/\.git$/, "");
}

/** Get all local branch names. */
function getLocalBranches(projectDir: string): string[] {
  try {
    const output = execSync("git branch --format=%(refname:short)", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    return output
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main publisher
// ---------------------------------------------------------------------------

/**
 * Create a GitHub repo and push all local branches.
 *
 * 1. Checks `gh` CLI is installed
 * 2. Loads GH_TOKEN from credential store → sets as env var
 * 3. Skips repo creation if `origin` remote already exists
 * 4. Creates repo via `gh repo create`
 * 5. Pushes all local branches
 * 6. Returns normalized HTTPS repo URL
 */
export function publishToGitHub(options: GitHubPublishOptions): GitHubPublishResult {
  const { projectDir, repoName, description } = options;
  const isPrivate = options.private !== false; // default true
  const outputLines: string[] = [];

  // 1. Check gh CLI
  try {
    execFileSync("gh", ["--version"], {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return {
      success: false,
      repoUrl: null,
      output: "",
      error: "gh CLI not found. Install it from https://cli.github.com/",
    };
  }

  // 2. Load GH_TOKEN
  const store = createCredentialStore();
  const token = store.load("github" as CredentialKey);
  const env = { ...process.env };
  if (token) {
    env.GH_TOKEN = token;
  } else if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    return {
      success: false,
      repoUrl: null,
      output: "",
      error: "GH_TOKEN not found. Set it via env var or ~/.boop/credentials/github.key",
    };
  }

  // 3. Check if origin remote already exists
  let originExists = false;
  try {
    execSync("git remote get-url origin", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    });
    originExists = true;
    outputLines.push("origin remote already exists, skipping repo creation");
  } catch {
    // No origin — will create repo
  }

  // 4. Create repo if needed
  if (!originExists) {
    try {
      const visibility = isPrivate ? "--private" : "--public";
      const args = ["repo", "create", repoName, visibility, "--source", projectDir, "--push"];
      if (description) {
        args.push("--description", description);
      }

      const createOutput = execFileSync("gh", args, {
        cwd: projectDir,
        encoding: "utf-8",
        env,
        timeout: 60_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      outputLines.push(createOutput.trim());
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        repoUrl: null,
        output: outputLines.join("\n"),
        error: `gh repo create failed: ${msg}`,
      };
    }
  }

  // 5. Push remaining branches
  const branches = getLocalBranches(projectDir);
  for (const branch of branches) {
    try {
      const pushOutput = execSync(`git push -u origin ${branch}`, {
        cwd: projectDir,
        encoding: "utf-8",
        env,
        timeout: 60_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      outputLines.push(`Pushed ${branch}: ${pushOutput.trim()}`);
    } catch (error: unknown) {
      // Non-fatal: log and continue with other branches
      const msg = error instanceof Error ? error.message : String(error);
      outputLines.push(`Warning: failed to push ${branch}: ${msg}`);
    }
  }

  // 6. Extract and normalize repo URL
  let repoUrl: string | null = null;
  try {
    const rawUrl = execSync("git remote get-url origin", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    }).trim();
    repoUrl = normalizeToHttps(rawUrl);
  } catch {
    // Non-fatal — URL extraction failed but push may have succeeded
    outputLines.push("Warning: could not extract repo URL");
  }

  return {
    success: true,
    repoUrl,
    output: outputLines.join("\n"),
  };
}
