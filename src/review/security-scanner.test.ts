import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSecurityScanner,
  parseFindings,
  extractSummary,
  parseAuditOutput,
} from "./security-scanner.js";
import type { AuditResult } from "./security-scanner.js";
import type { ReviewContext } from "./team-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock the claude-client module
// ---------------------------------------------------------------------------

const mockSendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: '{"title":"No vulnerabilities found","severity":"info","file":"","description":"SAST scan completed with no security findings."}\n\n## Summary\nNo vulnerabilities found. Security posture is clean.',
    usage: { inputTokens: 100, outputTokens: 50 },
    model: "claude-opus-4-6-20250929",
  }),
);

vi.mock("../shared/claude-client.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: (error: unknown) => {
    if (error instanceof Error && "status" in error) {
      const status = (error as Error & { status: number }).status;
      return status === 429 || status >= 500;
    }
    return false;
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  const reviewDir = path.join(tmpDir, ".boop", "reviews", "epic-1");
  fs.mkdirSync(reviewDir, { recursive: true });
  return {
    projectDir: tmpDir,
    epicNumber: 1,
    reviewDir,
    ...overrides,
  };
}

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function makeCleanAudit(): AuditResult {
  return {
    rawOutput: "{}",
    vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseFindings", () => {
  it("parses valid JSON finding lines", () => {
    const text = `Some preamble
{"title":"Command injection","severity":"critical","file":"src/run.ts","description":"Unsanitized input passed to execFile"}
Other text
{"title":"Hardcoded secret","severity":"high","file":"src/config.ts","description":"API key hardcoded in source"}
## Summary
Found 2 vulnerabilities.`;

    const findings = parseFindings(text);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      title: "Command injection",
      severity: "critical",
      file: "src/run.ts",
      description: "Unsanitized input passed to execFile",
    });
    expect(findings[1]).toEqual({
      title: "Hardcoded secret",
      severity: "high",
      file: "src/config.ts",
      description: "API key hardcoded in source",
    });
  });

  it("skips invalid JSON lines", () => {
    const text = `{not valid json}
{"title":"Valid","severity":"medium","file":"x.ts","description":"desc"}`;

    const findings = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("Valid");
  });

  it("skips findings with invalid severity", () => {
    const text = `{"title":"Bad","severity":"extreme","file":"x.ts","description":"desc"}
{"title":"Good","severity":"info","file":"x.ts","description":"desc"}`;

    const findings = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
  });

  it("returns empty array for text with no JSON", () => {
    expect(parseFindings("No findings here")).toEqual([]);
  });

  it("handles finding without file field", () => {
    const text = '{"title":"General","severity":"info","description":"All good"}';
    const findings = parseFindings(text);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBeUndefined();
  });

  it("accepts all valid severities", () => {
    const severities = ["critical", "high", "medium", "low", "info"];
    for (const sev of severities) {
      const text = `{"title":"Test","severity":"${sev}","description":"d"}`;
      const findings = parseFindings(text);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe(sev);
    }
  });
});

describe("extractSummary", () => {
  it("extracts text starting from ## Summary", () => {
    const text = 'Some findings\n{"title":"x","severity":"low","description":"d"}\n## Summary\nAll good.';
    expect(extractSummary(text)).toBe("## Summary\nAll good.");
  });

  it("returns full text when no ## Summary marker exists", () => {
    const text = "No summary marker here";
    expect(extractSummary(text)).toBe(text);
  });
});

describe("parseAuditOutput", () => {
  it("parses npm audit JSON format", () => {
    const output = JSON.stringify({
      metadata: {
        vulnerabilities: {
          critical: 1,
          high: 2,
          moderate: 3,
          low: 4,
          info: 0,
          total: 10,
        },
      },
    });

    const result = parseAuditOutput(output);

    expect(result.vulnerabilities.critical).toBe(1);
    expect(result.vulnerabilities.high).toBe(2);
    expect(result.vulnerabilities.moderate).toBe(3);
    expect(result.vulnerabilities.low).toBe(4);
    expect(result.vulnerabilities.info).toBe(0);
    expect(result.vulnerabilities.total).toBe(10);
  });

  it("parses pnpm audit advisories format", () => {
    const output = JSON.stringify({
      advisories: {
        "1": { severity: "critical" },
        "2": { severity: "high" },
        "3": { severity: "moderate" },
        "4": { severity: "low" },
      },
    });

    const result = parseAuditOutput(output);

    expect(result.vulnerabilities.critical).toBe(1);
    expect(result.vulnerabilities.high).toBe(1);
    expect(result.vulnerabilities.moderate).toBe(1);
    expect(result.vulnerabilities.low).toBe(1);
    expect(result.vulnerabilities.total).toBe(4);
  });

  it("handles invalid JSON gracefully", () => {
    const result = parseAuditOutput("not json");

    expect(result.rawOutput).toBe("not json");
    expect(result.vulnerabilities.total).toBe(0);
  });

  it("handles empty JSON object", () => {
    const result = parseAuditOutput("{}");

    expect(result.vulnerabilities.total).toBe(0);
  });

  it("preserves raw output", () => {
    const output = '{"metadata":{"vulnerabilities":{"total":0}}}';
    const result = parseAuditOutput(output);

    expect(result.rawOutput).toBe(output);
  });

  it("handles missing vulnerability fields in npm format", () => {
    const output = JSON.stringify({
      metadata: {
        vulnerabilities: {},
      },
    });

    const result = parseAuditOutput(output);

    expect(result.vulnerabilities.critical).toBe(0);
    expect(result.vulnerabilities.high).toBe(0);
    expect(result.vulnerabilities.total).toBe(0);
  });

  it("handles unknown severity in pnpm advisories as info", () => {
    const output = JSON.stringify({
      advisories: {
        "1": { severity: "unknown_severity" },
      },
    });

    const result = parseAuditOutput(output);

    expect(result.vulnerabilities.info).toBe(1);
    expect(result.vulnerabilities.total).toBe(1);
  });
});

describe("createSecurityScanner", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-security-scanner-"));
    mockSendMessage.mockReset();

    mockSendMessage.mockResolvedValue({
      text: '{"title":"No vulnerabilities found","severity":"info","file":"","description":"SAST scan completed with no security findings."}\n\n## Summary\nNo vulnerabilities found. Security posture is clean.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns clean result when no source files exist", async () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });

    const scanner = createSecurityScanner({
      auditFn: async () => makeCleanAudit(),
    });
    const result = await scanner(makeContext());

    expect(result.agent).toBe("security-scan");
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.blockingIssues).toEqual([]);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("sends source files to Claude for SAST analysis", async () => {
    writeFile("src/server.ts", "export function start() { exec(userInput); }");
    writeFile("src/utils.ts", "export function sanitize(input: string) { return input; }");

    const scanner = createSecurityScanner({
      auditFn: async () => makeCleanAudit(),
    });
    await scanner(makeContext());

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[1]).toContain("SAST");
    expect(callArgs[2][0].content).toContain("src/server.ts");
    expect(callArgs[2][0].content).toContain("src/utils.ts");
  });

  it("returns SAST findings from Claude response", async () => {
    writeFile("src/run.ts", "exec(userInput)");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Command injection","severity":"critical","file":"src/run.ts","description":"Unsanitized input passed to exec"}\n\n## Summary\n1 critical vulnerability.',
      usage: { inputTokens: 200, outputTokens: 80 },
      model: "claude-opus-4-6-20250929",
    });

    const scanner = createSecurityScanner({
      auditFn: async () => makeCleanAudit(),
    });
    const result = await scanner(makeContext());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual({
      title: "Command injection",
      severity: "critical",
      file: "src/run.ts",
      description: "Unsanitized input passed to exec",
    });
  });

  it("marks critical/high SAST findings as blocking", async () => {
    writeFile("src/auth.ts", "const apiKey = 'sk-1234';");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Hardcoded API key","severity":"high","file":"src/auth.ts","description":"API key hardcoded in source code"}\n{"title":"Minor issue","severity":"low","file":"src/auth.ts","description":"Consider using const"}\n\n## Summary\n1 high, 1 low.',
      usage: { inputTokens: 200, outputTokens: 100 },
      model: "claude-opus-4-6-20250929",
    });

    const scanner = createSecurityScanner({
      auditFn: async () => makeCleanAudit(),
    });
    const result = await scanner(makeContext());

    expect(result.findings).toHaveLength(2);
    expect(result.blockingIssues).toHaveLength(1);
    expect(result.blockingIssues[0]).toContain("Hardcoded API key");
    expect(result.blockingIssues[0]).toContain("high");
  });

  it("includes dependency audit findings", async () => {
    writeFile("src/foo.ts", "export const x = 1;");

    const scanner = createSecurityScanner({
      auditFn: async () => ({
        rawOutput: "{}",
        vulnerabilities: { critical: 1, high: 0, moderate: 2, low: 0, info: 0, total: 3 },
      }),
    });
    const result = await scanner(makeContext());

    // Should have SAST info finding + critical dep finding + moderate dep finding
    const depFindings = result.findings.filter((f) => f.title.includes("dependency"));
    expect(depFindings).toHaveLength(2);
    expect(depFindings[0].severity).toBe("critical");
    expect(depFindings[0].title).toContain("1 critical");
    expect(depFindings[1].severity).toBe("medium");
  });

  it("marks critical/high dependency vulnerabilities as blocking", async () => {
    writeFile("src/foo.ts", "export const x = 1;");

    const scanner = createSecurityScanner({
      auditFn: async () => ({
        rawOutput: "{}",
        vulnerabilities: { critical: 2, high: 1, moderate: 0, low: 0, info: 0, total: 3 },
      }),
    });
    const result = await scanner(makeContext());

    const blocking = result.blockingIssues.filter((b) => b.includes("dependency"));
    expect(blocking).toHaveLength(2);
    expect(blocking[0]).toContain("critical");
    expect(blocking[1]).toContain("high");
  });

  it("does not block on medium/low/info dependency vulnerabilities", async () => {
    writeFile("src/foo.ts", "export const x = 1;");

    const scanner = createSecurityScanner({
      auditFn: async () => ({
        rawOutput: "{}",
        vulnerabilities: { critical: 0, high: 0, moderate: 5, low: 3, info: 1, total: 9 },
      }),
    });
    const result = await scanner(makeContext());

    // Only the medium finding from deps
    const depFindings = result.findings.filter((f) => f.title.includes("dependency"));
    expect(depFindings.length).toBeGreaterThanOrEqual(1);
    // No blocking issues from deps
    expect(result.blockingIssues.filter((b) => b.includes("dependency"))).toEqual([]);
  });

  it("generates a markdown report with SAST and audit sections", async () => {
    writeFile("src/foo.ts", "export const x = 1;");

    const scanner = createSecurityScanner({
      auditFn: async () => ({
        rawOutput: "{}",
        vulnerabilities: { critical: 0, high: 0, moderate: 1, low: 0, info: 0, total: 1 },
      }),
    });
    const result = await scanner(makeContext());

    expect(result.report).toContain("# Security Scan Report");
    expect(result.report).toContain("## SAST Analysis");
    expect(result.report).toContain("Files scanned:");
    expect(result.report).toContain("## Dependency Audit");
    expect(result.report).toContain("Critical");
    expect(result.report).toContain("High");
    expect(result.report).toContain("Moderate");
  });

  it("report flags blocking dependency vulnerabilities", async () => {
    writeFile("src/foo.ts", "export const x = 1;");

    const scanner = createSecurityScanner({
      auditFn: async () => ({
        rawOutput: "{}",
        vulnerabilities: { critical: 1, high: 2, moderate: 0, low: 0, info: 0, total: 3 },
      }),
    });
    const result = await scanner(makeContext());

    expect(result.report).toContain("BLOCKING");
  });

  it("always returns agent='security-scan'", async () => {
    writeFile("src/foo.ts", "code");

    const scanner = createSecurityScanner({
      auditFn: async () => makeCleanAudit(),
    });
    const result = await scanner(makeContext());

    expect(result.agent).toBe("security-scan");
  });

  it("always returns success=true on completion", async () => {
    writeFile("src/foo.ts", "code");

    const scanner = createSecurityScanner({
      auditFn: async () => makeCleanAudit(),
    });
    const result = await scanner(makeContext());

    expect(result.success).toBe(true);
  });

  it("requests 8192 maxTokens from Claude", async () => {
    writeFile("src/foo.ts", "export const x = 1;");

    const scanner = createSecurityScanner({
      auditFn: async () => makeCleanAudit(),
    });
    await scanner(makeContext());

    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[0].maxTokens).toBe(8192);
  });

  it("respects maxTotalChars limit", async () => {
    const largeContent = "x".repeat(200);
    writeFile("src/big.ts", largeContent);
    writeFile("src/small.ts", "export const x = 1;");

    const scanner = createSecurityScanner({
      maxTotalChars: 100,
      auditFn: async () => makeCleanAudit(),
    });
    await scanner(makeContext());

    // Should still call Claude (at least one file fits)
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it("skips test/ directory files in SAST scan", async () => {
    writeFile("src/foo.ts", "production code");
    writeFile("test/unit/foo.test.ts", "test code");

    const scanner = createSecurityScanner({
      auditFn: async () => makeCleanAudit(),
    });
    await scanner(makeContext());

    expect(mockSendMessage).toHaveBeenCalled();
    const callArgs = mockSendMessage.mock.calls[0];
    const userMessage = callArgs[2][0].content;
    expect(userMessage).toContain("src/foo.ts");
    expect(userMessage).not.toContain("test/unit/foo.test.ts");
  });

  it("combines SAST and audit findings in the result", async () => {
    writeFile("src/vuln.ts", "exec(userInput)");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Command injection","severity":"critical","file":"src/vuln.ts","description":"RCE via unsanitized input"}\n\n## Summary\n1 critical.',
      usage: { inputTokens: 200, outputTokens: 80 },
      model: "claude-opus-4-6-20250929",
    });

    const scanner = createSecurityScanner({
      auditFn: async () => ({
        rawOutput: "{}",
        vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0, info: 0, total: 1 },
      }),
    });
    const result = await scanner(makeContext());

    // SAST + audit findings combined
    expect(result.findings.length).toBe(2);
    expect(result.findings[0].title).toBe("Command injection");
    expect(result.findings[1].title).toContain("high dependency");
    // Both blocking
    expect(result.blockingIssues).toHaveLength(2);
  });

  it("does not create low/info audit findings when count is zero", async () => {
    writeFile("src/foo.ts", "export const x = 1;");

    const scanner = createSecurityScanner({
      auditFn: async () => ({
        rawOutput: "{}",
        vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 },
      }),
    });
    const result = await scanner(makeContext());

    const depFindings = result.findings.filter((f) => f.title.includes("dependency"));
    expect(depFindings).toEqual([]);
  });

  it("includes blocking issue details with file path for SAST findings", async () => {
    writeFile("src/danger.ts", "eval(userInput)");

    mockSendMessage.mockResolvedValue({
      text: '{"title":"Eval injection","severity":"critical","file":"src/danger.ts","description":"eval with user input"}\n\n## Summary\n1 critical.',
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-opus-4-6-20250929",
    });

    const scanner = createSecurityScanner({
      auditFn: async () => makeCleanAudit(),
    });
    const result = await scanner(makeContext());

    expect(result.blockingIssues[0]).toContain("Eval injection");
    expect(result.blockingIssues[0]).toContain("src/danger.ts");
    expect(result.blockingIssues[0]).toContain("critical");
  });
});
