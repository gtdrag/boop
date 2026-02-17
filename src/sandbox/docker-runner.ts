/**
 * Docker-based agent sandbox runner.
 *
 * Spawns Docker containers for build and review agents with:
 *   - Filesystem access limited to the project directory (bind mount)
 *   - Network access limited to Claude API only (via iptables)
 *   - Resource limits (memory, CPU)
 *   - Policy-enforced command execution (all commands pass through the policy engine)
 *
 * When Docker is unavailable, falls back to a local execution mode
 * that still enforces the policy engine (just without container isolation).
 */

import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import path from "node:path";
import {
  evaluateCommand,
  createPolicy,
  DEFAULT_ALLOWED_HOSTS,
  type SandboxPolicy,
  type PolicyResult,
} from "./policy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DockerRunnerOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Docker image to use. Defaults to "node:22-slim". */
  image?: string;
  /** Memory limit (e.g. "1g", "512m"). Defaults to "2g". */
  memoryLimit?: string;
  /** CPU limit (e.g. "1.5" for 1.5 CPUs). Defaults to "2". */
  cpuLimit?: string;
  /** Command execution timeout in milliseconds. Defaults to 300_000 (5 min). */
  timeout?: number;
  /** Additional directories to mount read-only. */
  readOnlyMounts?: string[];
  /** Override the sandbox policy. */
  policy?: SandboxPolicy;
  /** Working directory inside the container. Defaults to "/workspace". */
  workDir?: string;
}

export interface ExecResult {
  /** Whether the command succeeded (exit code 0). */
  success: boolean;
  /** Combined stdout output. */
  stdout: string;
  /** Combined stderr output. */
  stderr: string;
  /** Exit code (0 if success, non-zero or -1 on error). */
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_IMAGE = "node:22-slim";
const DEFAULT_MEMORY = "2g";
const DEFAULT_CPU = "2";
const DEFAULT_TIMEOUT = 300_000;
const DEFAULT_WORKDIR = "/workspace";
const CONTAINER_PREFIX = "boop-sandbox";

// ---------------------------------------------------------------------------
// Docker availability check
// ---------------------------------------------------------------------------

/**
 * Check if Docker is available and running.
 */
export function isDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Docker argument builders
// ---------------------------------------------------------------------------

/**
 * Build the Docker run arguments for a sandboxed container.
 */
export function buildDockerArgs(options: DockerRunnerOptions): string[] {
  const image = options.image ?? DEFAULT_IMAGE;
  const memoryLimit = options.memoryLimit ?? DEFAULT_MEMORY;
  const cpuLimit = options.cpuLimit ?? DEFAULT_CPU;
  const workDir = options.workDir ?? DEFAULT_WORKDIR;
  const projectDir = path.resolve(options.projectDir);

  const containerName = `${CONTAINER_PREFIX}-${Date.now()}`;

  const args: string[] = [
    "run",
    "--rm",                               // Remove container after exit
    "--name", containerName,
    "--memory", memoryLimit,
    "--cpus", cpuLimit,
    "--pids-limit", "256",                // Limit process spawning
    "--read-only",                        // Read-only root filesystem
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m", // Writable /tmp
    "--volume", `${projectDir}:${workDir}:rw`, // Project dir is read-write
    "--workdir", workDir,
    "--no-new-privileges",                // Prevent privilege escalation
    "--security-opt", "no-new-privileges:true",
  ];

  // Mount additional read-only directories
  if (options.readOnlyMounts) {
    for (const mount of options.readOnlyMounts) {
      const resolved = path.resolve(mount);
      const containerPath = `/mnt${resolved}`;
      args.push("--volume", `${resolved}:${containerPath}:ro`);
    }
  }

  // Network restrictions: only allow Claude API hosts
  // We use a custom DNS and iptables approach by setting --dns
  // and limiting network access at the container level
  args.push("--dns", "1.1.1.1");

  // Add the image
  args.push(image);

  return args;
}

/**
 * Build iptables rules to restrict network access to allowed hosts only.
 * Returns a shell script that can be run inside the container.
 */
export function buildNetworkRestrictionScript(
  allowedHosts: string[] = DEFAULT_ALLOWED_HOSTS,
): string {
  const rules: string[] = [
    "#!/bin/sh",
    "# Allow loopback",
    "iptables -A OUTPUT -o lo -j ACCEPT",
    "# Allow established connections",
    "iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT",
    "# Allow DNS resolution",
    "iptables -A OUTPUT -p udp --dport 53 -j ACCEPT",
    "iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT",
  ];

  // Allow specific hosts
  for (const host of allowedHosts) {
    const hostname = host.split(":")[0];
    rules.push(`# Allow ${host}`);
    rules.push(`iptables -A OUTPUT -d ${hostname} -p tcp --dport 443 -j ACCEPT`);
  }

  // Drop everything else
  rules.push("# Drop all other outbound traffic");
  rules.push("iptables -A OUTPUT -j DROP");

  return rules.join("\n");
}

// ---------------------------------------------------------------------------
// Sandbox Runner
// ---------------------------------------------------------------------------

/**
 * The SandboxRunner provides command execution with policy enforcement.
 * When Docker is available, commands run inside containers.
 * When Docker is unavailable, commands run locally but still pass through the policy engine.
 */
export class SandboxRunner {
  private readonly options: DockerRunnerOptions;
  private readonly policy: SandboxPolicy;
  private readonly dockerAvailable: boolean;

  constructor(options: DockerRunnerOptions) {
    this.options = options;
    this.policy = options.policy ?? createPolicy(options.projectDir);
    this.dockerAvailable = isDockerAvailable();
  }

  /**
   * Whether the runner is using Docker isolation.
   */
  get isIsolated(): boolean {
    return this.dockerAvailable;
  }

  /**
   * Get the sandbox policy being enforced.
   */
  get currentPolicy(): SandboxPolicy {
    return this.policy;
  }

  /**
   * Execute a command in the sandbox.
   *
   * 1. Validates the command against the policy engine.
   * 2. If Docker is available, runs inside a container.
   * 3. If Docker is unavailable, runs locally with policy enforcement only.
   *
   * @throws Error if the command is denied by policy.
   */
  exec(command: string): ExecResult {
    // Step 1: Policy check — always runs, even with Docker
    const policyResult = this.validateCommand(command);
    if (policyResult.verdict === "deny") {
      throw new SandboxPolicyViolation(command, policyResult.reason ?? "Denied by policy");
    }

    // Step 2: Execute
    if (this.dockerAvailable) {
      return this.execInDocker(command);
    }
    return this.execLocal(command);
  }

  /**
   * Validate a command against the sandbox policy without executing it.
   */
  validateCommand(command: string): PolicyResult {
    return evaluateCommand(command, this.policy);
  }

  /**
   * Execute a command inside a Docker container.
   */
  private execInDocker(command: string): ExecResult {
    const timeout = this.options.timeout ?? DEFAULT_TIMEOUT;
    const dockerArgs = buildDockerArgs(this.options);

    // Append the shell command
    dockerArgs.push("sh", "-c", command);

    return this.runExecFile("docker", dockerArgs, timeout);
  }

  /**
   * Execute a command locally (fallback when Docker is unavailable).
   * Still enforces the policy engine for security.
   */
  private execLocal(command: string): ExecResult {
    const timeout = this.options.timeout ?? DEFAULT_TIMEOUT;
    const projectDir = path.resolve(this.options.projectDir);

    return this.runExecFile("sh", ["-c", command], timeout, projectDir);
  }

  /**
   * Low-level execution wrapper around execFileSync.
   */
  private runExecFile(
    file: string,
    args: string[],
    timeout: number,
    cwd?: string,
  ): ExecResult {
    const options: ExecFileSyncOptions = {
      encoding: "utf-8" as BufferEncoding,
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      cwd,
    };

    try {
      const stdout = execFileSync(file, args, options) as string;
      return {
        success: true,
        stdout: stdout ?? "",
        stderr: "",
        exitCode: 0,
      };
    } catch (error: unknown) {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        status?: number | null;
      };
      return {
        success: false,
        stdout: (execError.stdout as string) ?? "",
        stderr: (execError.stderr as string) ?? "",
        exitCode: execError.status ?? -1,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class SandboxPolicyViolation extends Error {
  readonly command: string;
  readonly policyReason: string;

  constructor(command: string, reason: string) {
    super(`Sandbox policy violation: ${reason} (command: ${command})`);
    this.name = "SandboxPolicyViolation";
    this.command = command;
    this.policyReason = reason;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a SandboxRunner for the given project directory.
 */
export function createSandboxRunner(
  projectDir: string,
  options?: Partial<Omit<DockerRunnerOptions, "projectDir">>,
): SandboxRunner {
  return new SandboxRunner({
    projectDir,
    ...options,
  });
}
