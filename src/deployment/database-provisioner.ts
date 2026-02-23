/**
 * Database provisioning for autonomous deployments.
 *
 * Uses the Neon CLI (`neonctl`) to create PostgreSQL databases and
 * the Vercel CLI to set environment variables on the deploy target.
 */
import { execFileSync } from "node:child_process";
import { createCredentialStore, type CredentialKey } from "../security/credentials.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvisionResult {
  success: boolean;
  projectId: string | null;
  connectionString: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Neon database provisioning
// ---------------------------------------------------------------------------

/**
 * Provision a new Neon PostgreSQL database.
 *
 * 1. Loads NEON_API_KEY from the credential store
 * 2. Creates a project via `npx neonctl`
 * 3. Retrieves the pooled connection string
 */
export function provisionNeonDatabase(options: {
  projectName: string;
  region?: string;
}): ProvisionResult {
  const store = createCredentialStore();
  const apiKey = store.load("neon" as CredentialKey);
  if (!apiKey) {
    return {
      success: false,
      projectId: null,
      connectionString: null,
      error: "NEON_API_KEY not found. Set it via env var or ~/.boop/credentials/neon.key",
    };
  }

  const regionArgs = options.region ? ["--region-id", options.region] : [];
  const env = { ...process.env, NEON_API_KEY: apiKey };

  try {
    // Create project
    const createOutput = execFileSync(
      "npx",
      [
        "neonctl",
        "projects",
        "create",
        "--name",
        options.projectName,
        ...regionArgs,
        "--output",
        "json",
      ],
      { encoding: "utf-8", env, timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] },
    );

    const parsed = JSON.parse(createOutput);
    const projectId: string = parsed.project?.id ?? parsed.id ?? null;

    if (!projectId) {
      return {
        success: false,
        projectId: null,
        connectionString: null,
        error: "Failed to parse project ID from neonctl output",
      };
    }

    // Get connection string
    const connOutput = execFileSync(
      "npx",
      ["neonctl", "connection-string", "--project-id", projectId, "--pooled"],
      { encoding: "utf-8", env, timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] },
    );

    const connectionString = connOutput.trim();

    return {
      success: true,
      projectId,
      connectionString: connectionString || null,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      projectId: null,
      connectionString: null,
      error: `Neon provisioning failed: ${msg}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Vercel env var management
// ---------------------------------------------------------------------------

/**
 * Set an environment variable on a Vercel project for all environments.
 *
 * Uses `npx vercel env add` with the value piped to stdin.
 */
export function setVercelEnvVar(
  key: string,
  value: string,
  projectDir: string,
): { success: boolean; error?: string } {
  try {
    execFileSync(
      "npx",
      ["vercel", "env", "add", key, "production", "preview", "development", "--yes"],
      {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 30_000,
        input: value,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to set Vercel env var ${key}: ${msg}` };
  }
}
