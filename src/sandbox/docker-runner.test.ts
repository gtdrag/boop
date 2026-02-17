import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import {
  buildDockerArgs,
  buildNetworkRestrictionScript,
  SandboxRunner,
  SandboxPolicyViolation,
  createSandboxRunner,
  isDockerAvailable,
  type DockerRunnerOptions,
} from "./docker-runner.js";
import { DEFAULT_ALLOWED_HOSTS } from "./policy.js";

// ---------------------------------------------------------------------------
// Mock child_process to prevent actual Docker/shell execution
// ---------------------------------------------------------------------------

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(overrides?: Partial<DockerRunnerOptions>): DockerRunnerOptions {
  return {
    projectDir: "/home/user/my-project",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isDockerAvailable
// ---------------------------------------------------------------------------

describe("isDockerAvailable", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it("returns true when docker info succeeds", () => {
    mockExecFileSync.mockReturnValueOnce("");
    expect(isDockerAvailable()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith("docker", ["info"], expect.any(Object));
  });

  it("returns false when docker info fails", () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("Docker not found");
    });
    expect(isDockerAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildDockerArgs
// ---------------------------------------------------------------------------

describe("buildDockerArgs", () => {
  it("builds default Docker run arguments", () => {
    const args = buildDockerArgs(makeOptions());

    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(args).toContain("--read-only");
    expect(args).toContain("--no-new-privileges");
    expect(args).toContain("node:22-slim");
  });

  it("includes memory and CPU limits", () => {
    const args = buildDockerArgs(makeOptions());

    const memIdx = args.indexOf("--memory");
    expect(memIdx).toBeGreaterThan(-1);
    expect(args[memIdx + 1]).toBe("2g");

    const cpuIdx = args.indexOf("--cpus");
    expect(cpuIdx).toBeGreaterThan(-1);
    expect(args[cpuIdx + 1]).toBe("2");
  });

  it("mounts project directory as read-write", () => {
    const args = buildDockerArgs(makeOptions());

    const volumeIdx = args.indexOf("--volume");
    expect(volumeIdx).toBeGreaterThan(-1);

    const volumeArg = args[volumeIdx + 1];
    const resolved = path.resolve("/home/user/my-project");
    expect(volumeArg).toBe(`${resolved}:/workspace:rw`);
  });

  it("sets working directory", () => {
    const args = buildDockerArgs(makeOptions());
    const wdIdx = args.indexOf("--workdir");
    expect(wdIdx).toBeGreaterThan(-1);
    expect(args[wdIdx + 1]).toBe("/workspace");
  });

  it("includes PID limit", () => {
    const args = buildDockerArgs(makeOptions());
    const pidIdx = args.indexOf("--pids-limit");
    expect(pidIdx).toBeGreaterThan(-1);
    expect(args[pidIdx + 1]).toBe("256");
  });

  it("includes tmpfs for /tmp", () => {
    const args = buildDockerArgs(makeOptions());
    const tmpfsIdx = args.indexOf("--tmpfs");
    expect(tmpfsIdx).toBeGreaterThan(-1);
    expect(args[tmpfsIdx + 1]).toContain("/tmp");
    expect(args[tmpfsIdx + 1]).toContain("noexec");
  });

  it("accepts custom image", () => {
    const args = buildDockerArgs(makeOptions({ image: "ubuntu:24.04" }));
    expect(args).toContain("ubuntu:24.04");
    expect(args).not.toContain("node:22-slim");
  });

  it("accepts custom memory and CPU limits", () => {
    const args = buildDockerArgs(makeOptions({ memoryLimit: "4g", cpuLimit: "4" }));
    const memIdx = args.indexOf("--memory");
    expect(args[memIdx + 1]).toBe("4g");
    const cpuIdx = args.indexOf("--cpus");
    expect(args[cpuIdx + 1]).toBe("4");
  });

  it("includes read-only mounts", () => {
    const args = buildDockerArgs(
      makeOptions({ readOnlyMounts: ["/home/user/.boop"] }),
    );

    // Find the second --volume (after project mount)
    const volumeIndices: number[] = [];
    args.forEach((arg, i) => {
      if (arg === "--volume") volumeIndices.push(i);
    });

    expect(volumeIndices.length).toBeGreaterThanOrEqual(2);
    const roMount = args[volumeIndices[1] + 1];
    expect(roMount).toContain(":ro");
    expect(roMount).toContain("/home/user/.boop");
  });
});

// ---------------------------------------------------------------------------
// buildNetworkRestrictionScript
// ---------------------------------------------------------------------------

describe("buildNetworkRestrictionScript", () => {
  it("generates iptables rules for allowed hosts", () => {
    const script = buildNetworkRestrictionScript();

    expect(script).toContain("#!/bin/sh");
    expect(script).toContain("iptables -A OUTPUT -o lo -j ACCEPT");
    expect(script).toContain("iptables -A OUTPUT -p udp --dport 53 -j ACCEPT");
    expect(script).toContain("api.anthropic.com");
    expect(script).toContain("iptables -A OUTPUT -j DROP");
  });

  it("includes all default allowed hosts", () => {
    const script = buildNetworkRestrictionScript();
    for (const host of DEFAULT_ALLOWED_HOSTS) {
      const hostname = host.split(":")[0];
      expect(script).toContain(hostname);
    }
  });

  it("accepts custom allowed hosts", () => {
    const script = buildNetworkRestrictionScript(["custom.api.com"]);
    expect(script).toContain("custom.api.com");
    expect(script).not.toContain("api.anthropic.com");
  });

  it("allows established connections", () => {
    const script = buildNetworkRestrictionScript();
    expect(script).toContain("ESTABLISHED,RELATED");
  });
});

// ---------------------------------------------------------------------------
// SandboxRunner
// ---------------------------------------------------------------------------

describe("SandboxRunner", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  describe("with Docker unavailable (local mode)", () => {
    beforeEach(() => {
      // First call is isDockerAvailable check, which should fail
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error("Docker not found");
      });
    });

    it("falls back to local execution", () => {
      const runner = new SandboxRunner(makeOptions());
      expect(runner.isIsolated).toBe(false);
    });

    it("enforces policy in local mode", () => {
      const runner = new SandboxRunner(makeOptions());

      expect(() => runner.exec("shutdown -h now")).toThrow(SandboxPolicyViolation);
      expect(() => runner.exec("git push --force")).toThrow(SandboxPolicyViolation);
      expect(() => runner.exec("git reset --hard")).toThrow(SandboxPolicyViolation);
    });

    it("executes allowed commands locally", () => {
      mockExecFileSync.mockReturnValueOnce("OK");

      const runner = new SandboxRunner(makeOptions());
      const result = runner.exec("pnpm test");

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("OK");
    });

    it("returns failure on command error", () => {
      const err = new Error("Command failed") as Error & {
        stdout: string;
        stderr: string;
        status: number;
      };
      err.stdout = "";
      err.stderr = "Error output";
      err.status = 1;
      mockExecFileSync.mockImplementationOnce(() => {
        throw err;
      });

      const runner = new SandboxRunner(makeOptions());
      const result = runner.exec("pnpm test");

      expect(result.success).toBe(false);
      expect(result.stderr).toBe("Error output");
      expect(result.exitCode).toBe(1);
    });

    it("provides access to the current policy", () => {
      const runner = new SandboxRunner(makeOptions());
      expect(runner.currentPolicy.projectDir).toBe(path.resolve("/home/user/my-project"));
    });
  });

  describe("with Docker available (container mode)", () => {
    beforeEach(() => {
      // First call is isDockerAvailable check, which succeeds
      mockExecFileSync.mockReturnValueOnce("");
    });

    it("uses Docker isolation", () => {
      const runner = new SandboxRunner(makeOptions());
      expect(runner.isIsolated).toBe(true);
    });

    it("enforces policy even with Docker", () => {
      const runner = new SandboxRunner(makeOptions());
      expect(() => runner.exec("shutdown -h now")).toThrow(SandboxPolicyViolation);
    });

    it("executes commands in Docker container", () => {
      mockExecFileSync.mockReturnValueOnce("test output");

      const runner = new SandboxRunner(makeOptions());
      const result = runner.exec("pnpm test");

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("test output");

      // The second call (after isDockerAvailable) should be docker run
      const execCall = mockExecFileSync.mock.calls[1];
      expect(execCall[0]).toBe("docker");
      expect(execCall[1][0]).toBe("run");
      expect(execCall[1]).toContain("sh");
      expect(execCall[1]).toContain("-c");
      expect(execCall[1]).toContain("pnpm test");
    });

    it("includes --rm flag for auto-cleanup", () => {
      mockExecFileSync.mockReturnValueOnce("");

      const runner = new SandboxRunner(makeOptions());
      runner.exec("echo hello");

      const execCall = mockExecFileSync.mock.calls[1];
      expect(execCall[1]).toContain("--rm");
    });
  });

  describe("validateCommand", () => {
    beforeEach(() => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error("No Docker");
      });
    });

    it("returns allow for safe commands", () => {
      const runner = new SandboxRunner(makeOptions());
      expect(runner.validateCommand("pnpm test").verdict).toBe("allow");
      expect(runner.validateCommand("git status").verdict).toBe("allow");
    });

    it("returns deny for blocked commands", () => {
      const runner = new SandboxRunner(makeOptions());
      expect(runner.validateCommand("shutdown now").verdict).toBe("deny");
      expect(runner.validateCommand("git push --force").verdict).toBe("deny");
    });
  });
});

// ---------------------------------------------------------------------------
// SandboxPolicyViolation
// ---------------------------------------------------------------------------

describe("SandboxPolicyViolation", () => {
  it("stores command and reason", () => {
    const error = new SandboxPolicyViolation("rm -rf /", "Blocked by policy");
    expect(error.command).toBe("rm -rf /");
    expect(error.policyReason).toBe("Blocked by policy");
    expect(error.name).toBe("SandboxPolicyViolation");
    expect(error.message).toContain("rm -rf /");
    expect(error.message).toContain("Blocked by policy");
  });
});

// ---------------------------------------------------------------------------
// createSandboxRunner
// ---------------------------------------------------------------------------

describe("createSandboxRunner", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("No Docker");
    });
  });

  it("creates a runner with default options", () => {
    const runner = createSandboxRunner("/home/user/project");
    expect(runner.currentPolicy.projectDir).toBe(path.resolve("/home/user/project"));
  });

  it("passes through custom options", () => {
    const runner = createSandboxRunner("/home/user/project", {
      memoryLimit: "4g",
      timeout: 60_000,
    });
    expect(runner).toBeInstanceOf(SandboxRunner);
  });
});
