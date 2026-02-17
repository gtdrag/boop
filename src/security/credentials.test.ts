import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createCredentialStore,
  containsCredential,
  scanFileForCredentials,
  getEnvVarName,
  getDefaultCredentialsDir,
} from "./credentials.js";

describe("createCredentialStore", () => {
  let tmpDir: string;
  let credDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-cred-test-"));
    credDir = path.join(tmpDir, "credentials");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Clean up env vars
    delete process.env.ANTHROPIC_API_KEY;
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
    expect(containsCredential("config: ANTHROPIC_API_KEY=sk-ant-api03-abcdef1234567890abcdef")).toBe(true);
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
});

describe("getDefaultCredentialsDir", () => {
  it("returns path under ~/.boop/credentials/", () => {
    const dir = getDefaultCredentialsDir();
    expect(dir).toContain(".boop");
    expect(dir).toContain("credentials");
  });
});
