/**
 * Core deployment runner.
 *
 * Executes deployment using the strategy determined by the provider config:
 * - "cli"   — Runs the provider's CLI command directly via spawn
 * - "agent" — Spawns a Claude CLI agent with a deploy-specific prompt
 * - "skip"  — Returns immediately with a success result
 *
 * Deployment failure is non-blocking — the pipeline continues to retrospective
 * regardless. Errors are captured in the result, not thrown.
 */

import fs from "node:fs";
import { spawn } from "node:child_process";
import { getProviderConfig } from "./providers.js";
import type { DeployCommand } from "./providers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployResult {
  /** Whether deployment succeeded. */
  success: boolean;
  /** The live URL (if available). */
  url: string | null;
  /** Full output from the deploy command. */
  output: string;
  /** Error message (if failed). */
  error?: string;
  /** Provider name. */
  provider: string;
}

export interface DeployOptions {
  projectDir: string;
  cloudProvider: string;
  projectName: string;
  /** Model for agent fallback. */
  model?: string;
  /** Timeout in ms (default 300_000 = 5 min). */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// CLI strategy
// ---------------------------------------------------------------------------

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

function runCliDeploy(
  command: DeployCommand,
  projectDir: string,
  timeout: number,
): Promise<DeployResult> {
  return new Promise((resolve) => {
    // Guard against double-resolve (error + close can both fire)
    let settled = false;
    const settle = (result: DeployResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Check project directory exists before spawning
    if (!fs.existsSync(projectDir)) {
      settle({
        success: false,
        url: null,
        output: "",
        error: `Project directory not found: ${projectDir}`,
        provider: command.displayName,
      });
      return;
    }

    const env = { ...process.env, ...command.env };

    let child;
    try {
      child = spawn(command.command, command.args, {
        cwd: projectDir,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      settle({
        success: false,
        url: null,
        output: "",
        error: `${command.displayName} error: ${msg}`,
        provider: command.displayName,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_BUFFER) {
        killed = true;
        child.kill("SIGTERM");
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > MAX_BUFFER) {
        killed = true;
        child.kill("SIGTERM");
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      const msg = err.message;
      if (msg.includes("ENOENT")) {
        const installHints: Record<string, string> = {
          npx: "Ensure Node.js is installed",
          railway: "Install the Railway CLI: npm i -g @railway/cli",
          fly: "Install the Fly CLI: https://fly.io/docs/flyctl/install/",
          docker: "Install Docker: https://docs.docker.com/get-docker/",
        };
        const hint = installHints[command.command] ?? `Install the ${command.displayName} CLI`;
        settle({
          success: false,
          url: null,
          output: "",
          error: `${command.displayName} CLI not found. ${hint}`,
          provider: command.displayName,
        });
        return;
      }
      settle({
        success: false,
        url: null,
        output: "",
        error: `${command.displayName} error: ${msg}`,
        provider: command.displayName,
      });
    });

    child.on("close", (code: number | null, signal: string | null) => {
      clearTimeout(timer);
      const fullOutput = [stdout, stderr].filter(Boolean).join("\n");

      // Handle signal-killed process (e.g., SIGTERM from timeout)
      if (signal) {
        settle({
          success: false,
          url: null,
          output: fullOutput,
          error: `Process killed by signal ${signal}${killed ? " (likely timeout)" : ""}`,
          provider: command.displayName,
        });
        return;
      }

      // Handle non-zero exit code
      if (code !== null && code !== 0) {
        settle({
          success: false,
          url: null,
          output: fullOutput,
          error: `${command.displayName} exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
          provider: command.displayName,
        });
        return;
      }

      // Extract URL from output
      const urlMatch = stdout.match(command.urlPattern) ?? stderr.match(command.urlPattern);
      const url = urlMatch ? urlMatch[0] : null;

      settle({
        success: true,
        url,
        output: fullOutput,
        provider: command.displayName,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Agent strategy
// ---------------------------------------------------------------------------

/** Sanitize provider name — only allow alphanumeric, hyphens, and dots. */
function sanitizeProvider(provider: string): string {
  return provider.replace(/[^a-zA-Z0-9.\-]/g, "").slice(0, 50) || "unknown";
}

function runAgentDeploy(
  provider: string,
  projectDir: string,
  model: string | undefined,
  timeout: number,
): Promise<DeployResult> {
  return new Promise((resolve) => {
    // Guard against double-resolve (error + close can both fire)
    let settled = false;
    const settle = (result: DeployResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Check project directory exists before spawning
    if (!fs.existsSync(projectDir)) {
      settle({
        success: false,
        url: null,
        output: "",
        error: `Project directory not found: ${projectDir}`,
        provider,
      });
      return;
    }

    const safeProvider = sanitizeProvider(provider);
    const prompt = `You are a deployment agent. Deploy this project to ${safeProvider}.

Instructions:
- Examine the project to understand its structure (package.json, Dockerfile, etc.)
- Use the ${safeProvider} CLI/SDK to deploy the project
- Output the live deployment URL when done
- If deployment fails, explain what went wrong

Deploy the project now.`;

    const args: string[] = [
      "--print",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
    ];

    if (model) {
      args.push("--model", model);
    }

    let child;
    try {
      child = spawn("claude", args, {
        cwd: projectDir,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      settle({
        success: false,
        url: null,
        output: "",
        error: `Claude CLI error: ${msg}`,
        provider,
      });
      return;
    }

    // Write prompt to stdin and close. Ignore stdin errors (process may already be dead).
    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_BUFFER) {
        killed = true;
        child.kill("SIGTERM");
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > MAX_BUFFER) {
        killed = true;
        child.kill("SIGTERM");
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      const msg = err.message;
      if (msg.includes("ENOENT")) {
        settle({
          success: false,
          url: null,
          output: "",
          error: "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
          provider,
        });
        return;
      }
      settle({
        success: false,
        url: null,
        output: "",
        error: `Claude CLI error: ${msg}`,
        provider,
      });
    });

    child.on("close", (code: number | null, signal: string | null) => {
      clearTimeout(timer);
      const fullOutput = [stdout, stderr].filter(Boolean).join("\n");

      // Handle signal-killed process (e.g., SIGTERM from timeout)
      if (signal) {
        settle({
          success: false,
          url: null,
          output: fullOutput,
          error: `Process killed by signal ${signal}${killed ? " (likely timeout)" : ""}`,
          provider,
        });
        return;
      }

      // Handle non-zero exit code
      if (code !== null && code !== 0) {
        settle({
          success: false,
          url: null,
          output: fullOutput,
          error: `Agent exited with code ${code}`,
          provider,
        });
        return;
      }

      // Extract URL from agent output (generic pattern)
      const urlMatch = stdout.match(/https?:\/\/[^\s)>\]"']+/);
      const url = urlMatch ? urlMatch[0] : null;

      settle({
        success: true,
        url,
        output: fullOutput,
        provider,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 300_000; // 5 minutes

/**
 * Deploy a project using the configured cloud provider.
 *
 * Returns a DeployResult — never throws. Callers should check result.success.
 */
export async function deploy(options: DeployOptions): Promise<DeployResult> {
  try {
    const { projectDir, cloudProvider, projectName, model, timeout = DEFAULT_TIMEOUT } = options;

    const config = getProviderConfig(cloudProvider, projectName);

    if (config.strategy === "skip") {
      return {
        success: true,
        url: null,
        output: "Deployment skipped (provider: none)",
        provider: "none",
      };
    }

    if (config.strategy === "cli" && config.command) {
      return await runCliDeploy(config.command, projectDir, timeout);
    }

    if (config.strategy === "agent") {
      return await runAgentDeploy(config.displayName, projectDir, model, timeout);
    }

    return {
      success: false,
      url: null,
      output: "",
      error: `Unknown strategy for provider: ${cloudProvider}`,
      provider: cloudProvider,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      url: null,
      output: "",
      error: msg,
      provider: options.cloudProvider,
    };
  }
}
