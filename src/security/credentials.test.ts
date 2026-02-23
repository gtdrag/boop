import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createCredentialStore,
  containsCredential,
  redactCredentials,
  scanFileForCredentials,
  getEnvVarName,
  getDefaultCredentialsDir,
  getRequiredCredentials,
  validateCredential,
} from "./credentials.js";
import type { DeveloperProfile } from "../profile/schema.js";

describe("createCredentialStore", () => {
  let tmpDir: string;
  let credDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-cred-test-"));
    credDir = path.join(tmpDir, "credentials");
    // Ensure no env vars leak from the real environment
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.NEON_API_KEY;
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_ORG_ID;
    delete process.env.VERCEL_PROJECT_ID;
    delete process.env.SENTRY_DSN;
    delete process.env.POSTHOG_KEY;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Clean up env vars
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.NEON_API_KEY;
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_ORG_ID;
    delete process.env.VERCEL_PROJECT_ID;
    delete process.env.SENTRY_DSN;
    delete process.env.POSTHOG_KEY;
    delete process.env.GH_TOKEN;
  });

  describe("save and load", () => {
    it("saves a credential and loads it back", () => {
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-test-key-12345");
      const loaded = store.load("anthropic");
      expect(loaded).toBe("sk-ant-test-key-12345");
    });

    it("creates the credentials directory on save", () => {
      const store = createCredentialStore(credDir);
      expect(fs.existsSync(credDir)).toBe(false);
      store.save("anthropic", "sk-ant-test");
      expect(fs.existsSync(credDir)).toBe(true);
    });

    it("sets file permissions to 0600", () => {
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-test");
      const filePath = path.join(credDir, "anthropic.key");
      const stats = fs.statSync(filePath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("sets directory permissions to 0700", () => {
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-test");
      const stats = fs.statSync(credDir);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    });

    it("trims whitespace from loaded credentials", () => {
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-test");
      // The save appends a newline — load should trim it
      const loaded = store.load("anthropic");
      expect(loaded).toBe("sk-ant-test");
    });
  });

  describe("environment variable priority", () => {
    it("loads from env var when set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
      const store = createCredentialStore(credDir);
      const loaded = store.load("anthropic");
      expect(loaded).toBe("sk-ant-from-env");
    });

    it("env var takes priority over file", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-from-file");
      const loaded = store.load("anthropic");
      expect(loaded).toBe("sk-ant-from-env");
    });

    it("falls back to file when env var is not set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-from-file");
      const loaded = store.load("anthropic");
      expect(loaded).toBe("sk-ant-from-file");
    });
  });

  describe("load returns null when not found", () => {
    it("returns null when no env var and no file", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const store = createCredentialStore(credDir);
      expect(store.load("anthropic")).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes an existing credential file", () => {
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-test");
      expect(store.delete("anthropic")).toBe(true);
      const filePath = path.join(credDir, "anthropic.key");
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("returns false when deleting non-existent credential", () => {
      const store = createCredentialStore(credDir);
      expect(store.delete("anthropic")).toBe(false);
    });
  });

  describe("exists", () => {
    it("returns true when env var is set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
      const store = createCredentialStore(credDir);
      expect(store.exists("anthropic")).toBe(true);
    });

    it("returns true when file exists", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-test");
      expect(store.exists("anthropic")).toBe(true);
    });

    it("returns false when neither env var nor file exists", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const store = createCredentialStore(credDir);
      expect(store.exists("anthropic")).toBe(false);
    });
  });

  describe("verifyPermissions", () => {
    it("passes when file has 0600 permissions", () => {
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-test");
      const result = store.verifyPermissions("anthropic");
      expect(result.valid).toBe(true);
      expect(result.mode).toBe("0o600");
    });

    it("fails when file has wrong permissions", () => {
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-test");
      // Loosen the permissions
      const filePath = path.join(credDir, "anthropic.key");
      fs.chmodSync(filePath, 0o644);
      const result = store.verifyPermissions("anthropic");
      expect(result.valid).toBe(false);
      expect(result.mode).toBe("0o644");
      expect(result.issue).toContain("0o644");
    });

    it("fails when file does not exist", () => {
      const store = createCredentialStore(credDir);
      const result = store.verifyPermissions("anthropic");
      expect(result.valid).toBe(false);
      expect(result.mode).toBeNull();
      expect(result.issue).toContain("not found");
    });
  });
});

describe("containsCredential", () => {
  it("detects Anthropic API key pattern", () => {
    expect(containsCredential("my key is sk-ant-api03-abcdef1234567890abcdef")).toBe(true);
  });

  it("does not flag normal text", () => {
    expect(containsCredential("hello world")).toBe(false);
  });

  it("does not flag short sk-ant prefix without sufficient length", () => {
    expect(containsCredential("sk-ant-short")).toBe(false);
  });

  it("detects key embedded in larger text", () => {
    expect(
      containsCredential("config: ANTHROPIC_API_KEY=sk-ant-api03-abcdef1234567890abcdef"),
    ).toBe(true);
  });

  it("detects GitHub personal access token (ghp_)", () => {
    expect(containsCredential("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn")).toBe(true);
  });

  it("detects GitHub OAuth token (gho_)", () => {
    expect(containsCredential("gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn")).toBe(true);
  });

  it("detects GitHub fine-grained PAT (github_pat_)", () => {
    expect(containsCredential("github_pat_ABCDEFGHIJKLMNOPQRSTUV_extradata1234")).toBe(true);
  });

  it("detects Vercel token pattern", () => {
    expect(containsCredential("vercel_ABCDEFGHIJKLMNOPQRSTUVWXYZab")).toBe(true);
  });

  it("detects Neon API key pattern", () => {
    expect(containsCredential("neon_ABCDEFGHIJKLMNOPQRSTUVWXYZab")).toBe(true);
  });
});

describe("redactCredentials", () => {
  it("redacts Anthropic API key", () => {
    const result = redactCredentials("key is sk-ant-api03-abcdef1234567890");
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("sk-ant-api03");
  });

  it("redacts GitHub personal access token", () => {
    const result = redactCredentials("GH_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn");
    expect(result).not.toContain("ghp_ABCDEF");
  });

  it("redacts GitHub OAuth token", () => {
    const result = redactCredentials("token: gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn");
    expect(result).not.toContain("gho_ABCDEF");
  });

  it("redacts GitHub fine-grained PAT", () => {
    const result = redactCredentials("github_pat_ABCDEFGHIJKLMNOPQRSTUV_moredata");
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("github_pat_ABCDEF");
  });

  it("redacts Vercel token", () => {
    const result = redactCredentials("vercel_ABCDEFGHIJKLMNOPQRSTUVWXYZab");
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("vercel_ABCDEF");
  });

  it("redacts Neon API key", () => {
    const result = redactCredentials("neon_ABCDEFGHIJKLMNOPQRSTUVWXYZab");
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("neon_ABCDEF");
  });

  it("redacts multiple credential types in one string", () => {
    const input = "keys: sk-ant-api03-abc123def456 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";
    const result = redactCredentials(input);
    expect(result).not.toContain("sk-ant-api03");
    expect(result).not.toContain("ghp_ABCDEF");
  });
});

describe("scanFileForCredentials", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-scan-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns true when file contains a credential", () => {
    const filePath = path.join(tmpDir, "config.ts");
    fs.writeFileSync(filePath, 'const key = "sk-ant-api03-abcdef1234567890abcdef";');
    expect(scanFileForCredentials(filePath)).toBe(true);
  });

  it("returns false when file is clean", () => {
    const filePath = path.join(tmpDir, "config.ts");
    fs.writeFileSync(filePath, 'const name = "boop";');
    expect(scanFileForCredentials(filePath)).toBe(false);
  });

  it("returns false for non-existent file", () => {
    expect(scanFileForCredentials(path.join(tmpDir, "nope.ts"))).toBe(false);
  });
});

describe("getEnvVarName", () => {
  it("returns ANTHROPIC_API_KEY for anthropic", () => {
    expect(getEnvVarName("anthropic")).toBe("ANTHROPIC_API_KEY");
  });

  it("returns correct env var names for all provider keys", () => {
    expect(getEnvVarName("neon")).toBe("NEON_API_KEY");
    expect(getEnvVarName("vercel")).toBe("VERCEL_TOKEN");
    expect(getEnvVarName("vercel-org")).toBe("VERCEL_ORG_ID");
    expect(getEnvVarName("vercel-project")).toBe("VERCEL_PROJECT_ID");
    expect(getEnvVarName("sentry")).toBe("SENTRY_DSN");
    expect(getEnvVarName("posthog")).toBe("POSTHOG_KEY");
  });
});

describe("getDefaultCredentialsDir", () => {
  it("returns path under ~/.boop/credentials/", () => {
    const dir = getDefaultCredentialsDir();
    expect(dir).toContain(".boop");
    expect(dir).toContain("credentials");
  });
});

describe("new provider credential keys", () => {
  let tmpDir: string;
  let credDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-cred-prov-"));
    credDir = path.join(tmpDir, "credentials");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.NEON_API_KEY;
    delete process.env.VERCEL_TOKEN;
  });

  it("saves and loads neon credential", () => {
    const store = createCredentialStore(credDir);
    store.save("neon", "neon-key-123");
    expect(store.load("neon")).toBe("neon-key-123");
  });

  it("saves and loads vercel credential", () => {
    const store = createCredentialStore(credDir);
    store.save("vercel", "vercel-token-abc");
    expect(store.load("vercel")).toBe("vercel-token-abc");
  });

  it("loads neon from env var", () => {
    process.env.NEON_API_KEY = "neon-from-env";
    const store = createCredentialStore(credDir);
    expect(store.load("neon")).toBe("neon-from-env");
  });

  it("loads vercel from env var", () => {
    process.env.VERCEL_TOKEN = "vercel-from-env";
    const store = createCredentialStore(credDir);
    expect(store.load("vercel")).toBe("vercel-from-env");
  });

  it("checks existence for sentry credential", () => {
    const store = createCredentialStore(credDir);
    expect(store.exists("sentry")).toBe(false);
    store.save("sentry", "https://key@sentry.io/123");
    expect(store.exists("sentry")).toBe(true);
  });
});

describe("getRequiredCredentials", () => {
  const baseProfile: DeveloperProfile = {
    name: "Test Dev",
    languages: ["typescript"],
    frontendFramework: "next",
    backendFramework: "express",
    database: "none",
    cloudProvider: "none",
    styling: "tailwind",
    stateManagement: "zustand",
    analytics: "none",
    ciCd: "github-actions",
    sourceControl: "none",
    packageManager: "pnpm",
    testRunner: "vitest",
    linter: "oxlint",
    projectStructure: "single-repo",
    errorTracker: "none",
    aiModel: "claude-opus-4-6",
    autonomousByDefault: false,
  };

  it("always includes anthropic", () => {
    const keys = getRequiredCredentials(baseProfile);
    expect(keys).toContain("anthropic");
  });

  it("includes vercel when cloudProvider is vercel", () => {
    const keys = getRequiredCredentials({ ...baseProfile, cloudProvider: "vercel" });
    expect(keys).toContain("vercel");
  });

  it("includes neon when database is postgresql", () => {
    const keys = getRequiredCredentials({ ...baseProfile, database: "postgresql" });
    expect(keys).toContain("neon");
  });

  it("includes sentry when errorTracker is sentry", () => {
    const keys = getRequiredCredentials({ ...baseProfile, errorTracker: "sentry" });
    expect(keys).toContain("sentry");
  });

  it("includes posthog when analytics is posthog", () => {
    const keys = getRequiredCredentials({ ...baseProfile, analytics: "posthog" });
    expect(keys).toContain("posthog");
  });

  it("includes github when sourceControl is github", () => {
    const keys = getRequiredCredentials({ ...baseProfile, sourceControl: "github" });
    expect(keys).toContain("github");
  });

  it("returns only anthropic for minimal stack", () => {
    const keys = getRequiredCredentials(baseProfile);
    expect(keys).toEqual(["anthropic"]);
  });

  it("returns all keys for full stack", () => {
    const fullProfile = {
      ...baseProfile,
      cloudProvider: "vercel" as const,
      database: "postgresql" as const,
      errorTracker: "sentry" as const,
      analytics: "posthog" as const,
      sourceControl: "github" as const,
    };
    const keys = getRequiredCredentials(fullProfile);
    expect(keys).toEqual(["anthropic", "vercel", "neon", "sentry", "posthog", "github"]);
  });
});

describe("validateCredential", () => {
  it("returns null for valid anthropic key", () => {
    expect(validateCredential("anthropic", "sk-ant-api03-abcdef1234567890abcdef")).toBeNull();
  });

  it("returns error for anthropic key without sk-ant- prefix", () => {
    const error = validateCredential("anthropic", "bad-key");
    expect(error).toContain("sk-ant-");
  });

  it("returns error for empty value", () => {
    const error = validateCredential("vercel", "");
    expect(error).toContain("cannot be empty");
  });

  it("returns error for whitespace-only value", () => {
    const error = validateCredential("neon", "   ");
    expect(error).toContain("cannot be empty");
  });

  it("returns null for valid sentry DSN", () => {
    expect(validateCredential("sentry", "https://key123@o123.ingest.sentry.io/456")).toBeNull();
  });

  it("returns error for invalid sentry DSN", () => {
    const error = validateCredential("sentry", "not-a-dsn");
    expect(error).toContain("URL");
  });

  it("returns null for arbitrary vercel token (no format check)", () => {
    expect(validateCredential("vercel", "some-vercel-token")).toBeNull();
  });

  it("returns null for arbitrary neon key (no format check)", () => {
    expect(validateCredential("neon", "neon-api-key-123")).toBeNull();
  });

  it("returns null for valid github token", () => {
    expect(validateCredential("github", "ghp_xxxxxxxxxxxxxxxxxxxx")).toBeNull();
  });

  it("returns error for too-short github token", () => {
    const error = validateCredential("github", "short");
    expect(error).toContain("too short");
  });
});
