import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  evaluateCommand,
  isPathAllowed,
  extractBaseCommand,
  extractPaths,
  createPolicy,
  DEFAULT_ALLOWED_HOSTS,
  type SandboxPolicy,
} from "./policy.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides?: Partial<SandboxPolicy>): SandboxPolicy {
  return {
    projectDir: "/home/user/my-project",
    allowedPaths: ["/home/user/.boop"],
    enforceNetwork: true,
    allowedHosts: DEFAULT_ALLOWED_HOSTS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractBaseCommand
// ---------------------------------------------------------------------------

describe("extractBaseCommand", () => {
  it("extracts simple commands", () => {
    expect(extractBaseCommand("pnpm test")).toBe("pnpm");
    expect(extractBaseCommand("git status")).toBe("git");
    expect(extractBaseCommand("ls -la")).toBe("ls");
  });

  it("skips env var assignments", () => {
    expect(extractBaseCommand("NODE_ENV=production node app.js")).toBe("node");
    expect(extractBaseCommand("CI=true pnpm test")).toBe("pnpm");
  });

  it("skips sudo", () => {
    expect(extractBaseCommand("sudo rm -rf /")).toBe("rm");
    expect(extractBaseCommand("sudo -u user cat /etc/passwd")).toBe("cat");
  });

  it("handles empty/whitespace input", () => {
    expect(extractBaseCommand("")).toBe("");
    expect(extractBaseCommand("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// extractPaths
// ---------------------------------------------------------------------------

describe("extractPaths", () => {
  it("extracts absolute paths", () => {
    const paths = extractPaths("cat /etc/passwd /var/log/syslog");
    expect(paths).toContain("/etc/passwd");
    expect(paths).toContain("/var/log/syslog");
  });

  it("extracts home directory paths", () => {
    const paths = extractPaths("cat ~/Documents/file.txt");
    expect(paths).toContain("~/Documents/file.txt");
  });

  it("extracts relative parent paths", () => {
    const paths = extractPaths("cat ../secret/keys.txt");
    expect(paths).toContain("../secret/keys.txt");
  });

  it("returns empty array for commands without paths", () => {
    expect(extractPaths("echo hello")).toEqual([]);
    expect(extractPaths("pnpm test")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isPathAllowed
// ---------------------------------------------------------------------------

describe("isPathAllowed", () => {
  const policy = makePolicy();

  it("allows paths within the project directory", () => {
    expect(isPathAllowed("/home/user/my-project/src/index.ts", policy).verdict).toBe("allow");
    expect(isPathAllowed("/home/user/my-project", policy).verdict).toBe("allow");
    expect(isPathAllowed("/home/user/my-project/", policy).verdict).toBe("allow");
  });

  it("allows paths within allowedPaths", () => {
    expect(isPathAllowed("/home/user/.boop/state.yaml", policy).verdict).toBe("allow");
    expect(isPathAllowed("/home/user/.boop", policy).verdict).toBe("allow");
  });

  it("denies paths outside allowed directories", () => {
    const result = isPathAllowed("/etc/passwd", policy);
    expect(result.verdict).toBe("deny");
    expect(result.reason).toContain("outside the allowed directories");
  });

  it("denies paths that are prefix matches but not subdirectories", () => {
    // "/home/user/my-project-secrets" should NOT match "/home/user/my-project"
    const result = isPathAllowed("/home/user/my-project-secrets/key.pem", policy);
    expect(result.verdict).toBe("deny");
  });

  it("denies paths in other user directories", () => {
    const result = isPathAllowed("/home/other/my-project/src/index.ts", policy);
    expect(result.verdict).toBe("deny");
  });

  it("denies root paths", () => {
    expect(isPathAllowed("/", policy).verdict).toBe("deny");
    expect(isPathAllowed("/root/.ssh/id_rsa", policy).verdict).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// evaluateCommand — blocked commands
// ---------------------------------------------------------------------------

describe("evaluateCommand — blocked commands", () => {
  const policy = makePolicy();

  it("blocks dangerous system commands", () => {
    const dangerous = ["shutdown", "reboot", "halt", "poweroff", "init", "mkfs", "fdisk", "dd"];
    for (const cmd of dangerous) {
      const result = evaluateCommand(`${cmd} -h`, policy);
      expect(result.verdict).toBe("deny");
      expect(result.reason).toContain("blocked by sandbox policy");
    }
  });

  it("allows safe commands", () => {
    expect(evaluateCommand("pnpm test", policy).verdict).toBe("allow");
    expect(evaluateCommand("node app.js", policy).verdict).toBe("allow");
    expect(evaluateCommand("git status", policy).verdict).toBe("allow");
    expect(evaluateCommand("tsc --noEmit", policy).verdict).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// evaluateCommand — git rules
// ---------------------------------------------------------------------------

describe("evaluateCommand — git rules", () => {
  const policy = makePolicy();

  it("blocks git push --force", () => {
    const result = evaluateCommand("git push --force origin main", policy);
    expect(result.verdict).toBe("deny");
    expect(result.reason).toContain("Force push");
  });

  it("blocks git push -f", () => {
    const result = evaluateCommand("git push -f", policy);
    expect(result.verdict).toBe("deny");
    expect(result.reason).toContain("Force push");
  });

  it("blocks git reset --hard", () => {
    const result = evaluateCommand("git reset --hard HEAD~1", policy);
    expect(result.verdict).toBe("deny");
    expect(result.reason).toContain("reset --hard");
  });

  it("blocks git clean -f", () => {
    const result = evaluateCommand("git clean -f", policy);
    expect(result.verdict).toBe("deny");
    expect(result.reason).toContain("git clean");
  });

  it("blocks git branch -D", () => {
    const result = evaluateCommand("git branch -D feature/old", policy);
    expect(result.verdict).toBe("deny");
    expect(result.reason).toContain("force-deletes");
  });

  it("allows safe git commands", () => {
    expect(evaluateCommand("git status", policy).verdict).toBe("allow");
    expect(evaluateCommand("git add -A", policy).verdict).toBe("allow");
    expect(evaluateCommand("git commit -m 'test'", policy).verdict).toBe("allow");
    expect(evaluateCommand("git push origin main", policy).verdict).toBe("allow");
    expect(evaluateCommand("git branch -d feature/old", policy).verdict).toBe("allow");
    expect(evaluateCommand("git log --oneline", policy).verdict).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// evaluateCommand — destructive patterns
// ---------------------------------------------------------------------------

describe("evaluateCommand — destructive patterns", () => {
  const policy = makePolicy();

  it("blocks rm -rf with absolute paths", () => {
    const result = evaluateCommand("rm -rf /", policy);
    expect(result.verdict).toBe("deny");
  });

  it("blocks rm -rf with root-level paths", () => {
    const result = evaluateCommand("rm -rf /usr", policy);
    expect(result.verdict).toBe("deny");
  });

  it("blocks rm -fr (reversed flags) with absolute paths", () => {
    const result = evaluateCommand("rm -fr /tmp/important", policy);
    expect(result.verdict).toBe("deny");
  });

  it("allows rm -rf with relative paths (within project)", () => {
    expect(evaluateCommand("rm -rf node_modules", policy).verdict).toBe("allow");
    expect(evaluateCommand("rm -rf dist", policy).verdict).toBe("allow");
  });

  it("blocks writing to block devices", () => {
    const result = evaluateCommand("cat file > /dev/sda", policy);
    expect(result.verdict).toBe("deny");
    expect(result.reason).toContain("block devices");
  });
});

// ---------------------------------------------------------------------------
// evaluateCommand — path enforcement
// ---------------------------------------------------------------------------

describe("evaluateCommand — path enforcement", () => {
  const policy = makePolicy();

  it("allows commands with paths inside project dir", () => {
    expect(evaluateCommand("cat /home/user/my-project/src/index.ts", policy).verdict).toBe("allow");
  });

  it("allows commands with paths inside ~/.boop", () => {
    expect(evaluateCommand("cat /home/user/.boop/state.yaml", policy).verdict).toBe("allow");
  });

  it("denies commands with paths outside project dir", () => {
    const result = evaluateCommand("cat /etc/passwd", policy);
    expect(result.verdict).toBe("deny");
    expect(result.reason).toContain("outside the allowed directories");
  });

  it("denies commands accessing other users' directories", () => {
    const result = evaluateCommand("ls /home/other/secrets/", policy);
    expect(result.verdict).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// createPolicy
// ---------------------------------------------------------------------------

describe("createPolicy", () => {
  it("creates a policy with sensible defaults", () => {
    const policy = createPolicy("/home/user/project");
    expect(policy.projectDir).toBe(path.resolve("/home/user/project"));
    expect(policy.enforceNetwork).toBe(true);
    expect(policy.allowedHosts).toEqual(DEFAULT_ALLOWED_HOSTS);
    expect(policy.allowedPaths).toBeDefined();
    expect(policy.allowedPaths!.length).toBeGreaterThan(0);
  });

  it("accepts custom options", () => {
    const policy = createPolicy("/home/user/project", {
      enforceNetwork: false,
      allowedHosts: ["custom.api.com"],
      allowedPaths: ["/tmp/shared"],
    });
    expect(policy.enforceNetwork).toBe(false);
    expect(policy.allowedHosts).toEqual(["custom.api.com"]);
    expect(policy.allowedPaths).toEqual(["/tmp/shared"]);
  });
});
