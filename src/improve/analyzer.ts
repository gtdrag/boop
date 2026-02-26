/**
 * Codebase analyzer — scans an existing project and runs adversarial review.
 *
 * Used by improve mode to assess a brownfield codebase. Walks the file tree
 * via `git ls-files`, collects metrics, then runs the adversarial agents
 * against all source files (not just a git diff).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

import { runAdversarialAgents } from "../review/adversarial/runner.js";
import type {
  AdversarialAgentResult,
  AdversarialAgentType,
  AdversarialFinding,
} from "../review/adversarial/runner.js";
import { verifyFindings } from "../review/adversarial/verifier.js";
import type { VerificationResult } from "../review/adversarial/verifier.js";
import { loadReviewRules } from "../review/adversarial/review-rules.js";
import type { DeveloperProfile } from "../shared/types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodebaseSnapshot {
  totalFiles: number;
  languageBreakdown: Record<string, number>;
  totalLines: number;
  hasTests: boolean;
  hasTypecheck: boolean;
  dependencyCount: number;
  fileTree: string;
}

export type ImproveFocus = "security" | "tests" | "quality" | "all";

export interface AnalysisResult {
  snapshot: CodebaseSnapshot;
  agentResults: AdversarialAgentResult[];
  verification: VerificationResult;
  verifiedFindings: AdversarialFinding[];
}

// ---------------------------------------------------------------------------
// Focus → agent subset mapping
// ---------------------------------------------------------------------------

const FOCUS_AGENTS: Record<ImproveFocus, AdversarialAgentType[]> = {
  security: ["security"],
  tests: ["test-coverage"],
  quality: ["code-quality"],
  all: ["code-quality", "test-coverage", "security"],
};

// ---------------------------------------------------------------------------
// Codebase scanner
// ---------------------------------------------------------------------------

export async function scanCodebase(projectDir: string): Promise<CodebaseSnapshot> {
  // Get tracked source files via git ls-files
  let filePaths: string[];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached"],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
    );
    filePaths = stdout.trim().split("\n").filter((f) => f.length > 0);
  } catch {
    filePaths = [];
  }

  // Language breakdown by extension
  const languageBreakdown: Record<string, number> = {};
  for (const fp of filePaths) {
    const ext = path.extname(fp).toLowerCase() || "(none)";
    languageBreakdown[ext] = (languageBreakdown[ext] ?? 0) + 1;
  }

  // Count total lines across source files
  let totalLines = 0;
  const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"]);
  for (const fp of filePaths) {
    const ext = path.extname(fp).toLowerCase();
    if (!sourceExts.has(ext)) continue;
    try {
      const content = fs.readFileSync(path.join(projectDir, fp), "utf-8");
      totalLines += content.split("\n").length;
    } catch {
      // skip unreadable
    }
  }

  // Check for test infrastructure
  const hasTests = filePaths.some(
    (f) => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__"),
  );

  // Check for TypeScript config
  const hasTypecheck = filePaths.some(
    (f) => f === "tsconfig.json" || f.endsWith("/tsconfig.json"),
  );

  // Dependency count from package.json
  let dependencyCount = 0;
  try {
    const pkgPath = path.join(projectDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    dependencyCount =
      Object.keys(pkg.dependencies ?? {}).length +
      Object.keys(pkg.devDependencies ?? {}).length;
  } catch {
    // no package.json
  }

  // Build truncated file tree for Claude context
  const treeLines = filePaths.slice(0, 200).map((f) => `  ${f}`);
  if (filePaths.length > 200) {
    treeLines.push(`  ... and ${filePaths.length - 200} more files`);
  }
  const fileTree = treeLines.join("\n");

  return {
    totalFiles: filePaths.length,
    languageBreakdown,
    totalLines,
    hasTests,
    hasTypecheck,
    dependencyCount,
    fileTree,
  };
}

// ---------------------------------------------------------------------------
// Full analysis (scan + adversarial agents + verify)
// ---------------------------------------------------------------------------

export async function analyzeCodebase(
  projectDir: string,
  options?: {
    focus?: ImproveFocus;
    profile?: DeveloperProfile;
    onProgress?: (phase: string, message: string) => void;
  },
): Promise<AnalysisResult> {
  const focus = options?.focus ?? "all";
  const onProgress = options?.onProgress;

  // Step 1: Scan
  onProgress?.("scan", "Scanning codebase...");
  const snapshot = await scanCodebase(projectDir);
  onProgress?.("scan", `Found ${snapshot.totalFiles} files, ${snapshot.totalLines} lines`);

  // Step 2: Get source files for review
  let sourcePaths: string[];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "*.ts", "*.tsx", "*.js", "*.jsx"],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
    );
    sourcePaths = stdout.trim().split("\n").filter((f) => f.length > 0);
  } catch {
    sourcePaths = [];
  }

  // Step 3: Run adversarial agents with files override
  const agents = FOCUS_AGENTS[focus];
  const reviewRules = loadReviewRules();

  onProgress?.("review", `Running ${agents.length} adversarial agent(s)...`);
  const agentResults = await runAdversarialAgents({
    projectDir,
    epicNumber: 0,
    agents,
    files: sourcePaths,
    reviewRules: reviewRules.length > 0 ? reviewRules : undefined,
  });

  const allFindings = agentResults.flatMap((r) => r.findings);
  onProgress?.("review", `Found ${allFindings.length} raw findings`);

  // Step 4: Verify findings
  onProgress?.("verify", "Verifying findings against codebase...");
  const verification = verifyFindings(projectDir, allFindings);
  onProgress?.("verify", `Verified: ${verification.stats.verified}, Discarded: ${verification.stats.discarded}`);

  return {
    snapshot,
    agentResults,
    verification,
    verifiedFindings: verification.verified,
  };
}
