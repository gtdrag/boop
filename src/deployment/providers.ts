/**
 * Deployment provider strategies.
 *
 * Maps cloud provider names to CLI commands, URL patterns, and deployment
 * strategies. Each provider returns a ProviderConfig that the deployer
 * uses to determine how to deploy.
 *
 * Three strategies:
 * - "cli"   — Run a known CLI command directly (Vercel, Railway, Fly, Docker)
 * - "agent" — Fall back to a Claude CLI agent (AWS, GCP, Azure, unknown)
 * - "skip"  — Skip deployment entirely ("none")
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A shell command to execute for deployment. */
export interface DeployCommand {
  /** Shell command to execute. */
  command: string;
  /** Args array. */
  args: string[];
  /** Env vars to pass through (in addition to process.env). */
  env?: Record<string, string>;
  /** Regex to extract deploy URL from stdout. */
  urlPattern: RegExp;
  /** Human-readable provider name. */
  displayName: string;
}

export type DeployStrategy = "cli" | "agent" | "skip";

export interface ProviderConfig {
  strategy: DeployStrategy;
  command?: DeployCommand;
  displayName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a project name for use as a Docker image tag.
 * Docker tags must match [a-z0-9]+([._-][a-z0-9]+)*.
 */
export function sanitizeDockerTag(name: string): string {
  let tag = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "");
  if (tag === "") return "app";
  return tag;
}

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

function vercelConfig(): ProviderConfig {
  const env: Record<string, string> = {};
  if (process.env.VERCEL_TOKEN) env.VERCEL_TOKEN = process.env.VERCEL_TOKEN;
  if (process.env.VERCEL_ORG_ID) env.VERCEL_ORG_ID = process.env.VERCEL_ORG_ID;
  if (process.env.VERCEL_PROJECT_ID) env.VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

  return {
    strategy: "cli",
    command: {
      command: "npx",
      args: ["vercel", "--yes", "--prod"],
      env: Object.keys(env).length > 0 ? env : undefined,
      urlPattern: /https:\/\/[\w-]+\.vercel\.app\b(?:\/[^\s)>"']*)*/,
      displayName: "Vercel",
    },
    displayName: "Vercel",
  };
}

function railwayConfig(): ProviderConfig {
  const env: Record<string, string> = {};
  if (process.env.RAILWAY_TOKEN) env.RAILWAY_TOKEN = process.env.RAILWAY_TOKEN;

  return {
    strategy: "cli",
    command: {
      command: "railway",
      args: ["up", "--detach"],
      env: Object.keys(env).length > 0 ? env : undefined,
      urlPattern: /https:\/\/[\w-]+\.up\.railway\.app\b(?:\/[^\s)>"']*)*/,
      displayName: "Railway",
    },
    displayName: "Railway",
  };
}

function flyConfig(): ProviderConfig {
  const env: Record<string, string> = {};
  if (process.env.FLY_API_TOKEN) env.FLY_API_TOKEN = process.env.FLY_API_TOKEN;

  return {
    strategy: "cli",
    command: {
      command: "fly",
      args: ["deploy"],
      env: Object.keys(env).length > 0 ? env : undefined,
      urlPattern: /https:\/\/[\w-]+\.fly\.dev\b(?:\/[^\s)>"']*)*/,
      displayName: "Fly.io",
    },
    displayName: "Fly.io",
  };
}

function dockerConfig(projectName: string): ProviderConfig {
  return {
    strategy: "cli",
    command: {
      command: "docker",
      args: ["build", "-t", sanitizeDockerTag(projectName), "."],
      urlPattern: /(?!)/, // Never matches — no deploy URL for local builds
      displayName: "Docker",
    },
    displayName: "Docker",
  };
}

function agentConfig(displayName: string): ProviderConfig {
  return {
    strategy: "agent",
    displayName,
  };
}

function skipConfig(): ProviderConfig {
  return {
    strategy: "skip",
    displayName: "none",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the deployment configuration for a cloud provider.
 *
 * Known CLI providers (vercel, railway, fly, docker) get direct CLI commands.
 * Complex providers (aws, gcp, azure) fall back to a Claude CLI agent.
 * "none" skips deployment entirely.
 * Unknown providers default to the agent strategy as a safe fallback.
 */
export function getProviderConfig(cloudProvider: string, projectName: string): ProviderConfig {
  switch (cloudProvider.toLowerCase()) {
    case "vercel":
      return vercelConfig();
    case "railway":
      return railwayConfig();
    case "fly":
      return flyConfig();
    case "docker":
      return dockerConfig(projectName);
    case "aws":
      return agentConfig("AWS");
    case "gcp":
      return agentConfig("GCP");
    case "azure":
      return agentConfig("Azure");
    case "none":
      return skipConfig();
    default:
      // Sanitize unknown provider names — they get interpolated into agent prompts
      return agentConfig(cloudProvider.replace(/[^a-zA-Z0-9.\-]/g, "").slice(0, 50) || "unknown");
  }
}
