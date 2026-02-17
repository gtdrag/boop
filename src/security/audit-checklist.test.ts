import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runSecurityAudit, formatAuditReport } from "./audit-checklist.js";
import { createCredentialStore } from "./credentials.js";

describe("runSecurityAudit", () => {
  let tmpDir: string;
  let projectDir: string;
  let credDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-audit-test-"));
    projectDir = path.join(tmpDir, "project");
    credDir = path.join(tmpDir, "credentials");
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupProjectFiles(): void {
    // Create sandbox files
    const sandboxDir = path.join(projectDir, "src", "sandbox");
    fs.mkdirSync(sandboxDir, { recursive: true });
    fs.writeFileSync(path.join(sandboxDir, "policy.ts"), "export {}");
    fs.writeFileSync(path.join(sandboxDir, "docker-runner.ts"), "export {}");

    // Create logger with sanitize function
    const sharedDir = path.join(projectDir, "src", "shared");
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(sharedDir, "logger.ts"),
      'export function sanitize(input: string) { return input; }\nconst s = sanitize("test");',
    );

    // Create .gitignore with required patterns
    fs.writeFileSync(
      path.join(projectDir, ".gitignore"),
      ".boop/\n*.key\n.env\nnode_modules/\n",
    );
  }

  describe("full passing audit", () => {
    it("passes all checks when everything is configured correctly", () => {
      setupProjectFiles();

      // Set up credentials with correct permissions
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-test-dummy");

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      expect(report.allPassed).toBe(true);
      expect(report.failedChecks).toBe(0);
      expect(report.totalChecks).toBeGreaterThan(0);
    });
  });

  describe("sandbox checks", () => {
    it("fails when sandbox policy module is missing", () => {
      setupProjectFiles();
      // Remove the policy file
      fs.unlinkSync(path.join(projectDir, "src", "sandbox", "policy.ts"));

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "sandbox-policy-exists",
      );
      expect(check?.passed).toBe(false);
    });

    it("fails when Docker runner module is missing", () => {
      setupProjectFiles();
      fs.unlinkSync(
        path.join(projectDir, "src", "sandbox", "docker-runner.ts"),
      );

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "docker-runner-exists",
      );
      expect(check?.passed).toBe(false);
    });
  });

  describe("credential checks", () => {
    it("fails when credential file has wrong permissions", () => {
      setupProjectFiles();
      const store = createCredentialStore(credDir);
      store.save("anthropic", "sk-ant-test");
      // Loosen permissions
      fs.chmodSync(path.join(credDir, "anthropic.key"), 0o644);

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "credential-permissions",
      );
      expect(check?.passed).toBe(false);
      expect(check?.details).toContain("0o644");
    });

    it("passes when no credential files exist (env var fallback)", () => {
      setupProjectFiles();

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "credential-permissions",
      );
      expect(check?.passed).toBe(true);
    });

    it("fails when credentials directory has wrong permissions", () => {
      setupProjectFiles();
      fs.mkdirSync(credDir, { recursive: true, mode: 0o755 });

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "credentials-dir-permissions",
      );
      expect(check?.passed).toBe(false);
    });
  });

  describe("logging checks", () => {
    it("fails when logger has no sanitize function", () => {
      setupProjectFiles();
      // Overwrite logger without sanitize
      fs.writeFileSync(
        path.join(projectDir, "src", "shared", "logger.ts"),
        "export class Logger {}",
      );

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "logger-sanitization",
      );
      expect(check?.passed).toBe(false);
    });

    it("fails when logger module is missing", () => {
      setupProjectFiles();
      fs.unlinkSync(path.join(projectDir, "src", "shared", "logger.ts"));

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "logger-sanitization",
      );
      expect(check?.passed).toBe(false);
    });
  });

  describe("git safety checks", () => {
    it("fails when .gitignore is missing", () => {
      setupProjectFiles();
      fs.unlinkSync(path.join(projectDir, ".gitignore"));

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "gitignore-credentials",
      );
      expect(check?.passed).toBe(false);
    });

    it("fails when .gitignore is missing required patterns", () => {
      setupProjectFiles();
      // Overwrite with incomplete gitignore
      fs.writeFileSync(
        path.join(projectDir, ".gitignore"),
        "node_modules/\n",
      );

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "gitignore-credentials",
      );
      expect(check?.passed).toBe(false);
      expect(check?.details).toContain(".boop/");
    });
  });

  describe("leak detection", () => {
    it("detects credential patterns in source files", () => {
      setupProjectFiles();
      // Add a file with a credential pattern
      fs.writeFileSync(
        path.join(projectDir, "src", "config.ts"),
        'const key = "sk-ant-api03-abcdef1234567890abcdef";',
      );

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "no-credential-leaks",
      );
      expect(check?.passed).toBe(false);
      expect(check?.details).toContain("config.ts");
    });

    it("skips node_modules directory", () => {
      setupProjectFiles();
      const nmDir = path.join(projectDir, "node_modules", "some-pkg");
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(
        path.join(nmDir, "index.ts"),
        'const key = "sk-ant-api03-abcdef1234567890abcdef";',
      );

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "no-credential-leaks",
      );
      expect(check?.passed).toBe(true);
    });

    it("passes when no credentials found in source", () => {
      setupProjectFiles();

      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });

      const check = report.checks.find(
        (c) => c.id === "no-credential-leaks",
      );
      expect(check?.passed).toBe(true);
    });
  });

  describe("report structure", () => {
    it("includes timestamp", () => {
      setupProjectFiles();
      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });
      expect(report.timestamp).toBeTruthy();
      // Should be ISO-8601
      expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
    });

    it("counts match total", () => {
      setupProjectFiles();
      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });
      expect(report.passedChecks + report.failedChecks).toBe(
        report.totalChecks,
      );
    });

    it("runs 7 checks", () => {
      setupProjectFiles();
      const report = runSecurityAudit({
        projectDir,
        credentialsDir: credDir,
      });
      expect(report.totalChecks).toBe(7);
    });
  });
});

describe("formatAuditReport", () => {
  it("formats a passing report", () => {
    const report = {
      timestamp: "2026-02-16T00:00:00.000Z",
      allPassed: true,
      totalChecks: 2,
      passedChecks: 2,
      failedChecks: 0,
      checks: [
        {
          id: "test-1",
          description: "Check one",
          category: "sandbox" as const,
          passed: true,
        },
        {
          id: "test-2",
          description: "Check two",
          category: "credentials" as const,
          passed: true,
        },
      ],
    };

    const output = formatAuditReport(report);
    expect(output).toContain("PASSED");
    expect(output).toContain("2/2 passed");
    expect(output).toContain("[PASS] Check one");
    expect(output).toContain("[PASS] Check two");
  });

  it("formats a failing report with details", () => {
    const report = {
      timestamp: "2026-02-16T00:00:00.000Z",
      allPassed: false,
      totalChecks: 2,
      passedChecks: 1,
      failedChecks: 1,
      checks: [
        {
          id: "test-1",
          description: "Check one",
          category: "sandbox" as const,
          passed: true,
        },
        {
          id: "test-2",
          description: "Check two",
          category: "credentials" as const,
          passed: false,
          details: "File has wrong permissions",
        },
      ],
    };

    const output = formatAuditReport(report);
    expect(output).toContain("FAILED");
    expect(output).toContain("1/2 passed");
    expect(output).toContain("[FAIL] Check two");
    expect(output).toContain("File has wrong permissions");
  });

  it("groups checks by category", () => {
    const report = {
      timestamp: "2026-02-16T00:00:00.000Z",
      allPassed: true,
      totalChecks: 2,
      passedChecks: 2,
      failedChecks: 0,
      checks: [
        {
          id: "s-1",
          description: "Sandbox check",
          category: "sandbox" as const,
          passed: true,
        },
        {
          id: "c-1",
          description: "Credential check",
          category: "credentials" as const,
          passed: true,
        },
      ],
    };

    const output = formatAuditReport(report);
    expect(output).toContain("## sandbox");
    expect(output).toContain("## credentials");
  });
});
