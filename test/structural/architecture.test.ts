/**
 * Structural invariant tests — mechanically enforce architectural rules.
 *
 * These tests verify that the codebase's import graph, naming conventions,
 * test coverage, and state machine definitions stay consistent as the
 * project evolves. Inspired by OpenAI's "harness engineering" approach.
 *
 * They do NOT test runtime behavior — they scan the source tree and verify
 * structural properties that should never change without a conscious decision.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "../../src");

/** Recursively collect all .ts files under a directory (excluding node_modules). */
function walk(dir: string, ext = ".ts"): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...walk(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

/** Extract import paths from a TS file (both `import` and `import type`). */
function extractImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const imports: string[] = [];
  // Match: import ... from "..." or import ... from '...'
  const re = /from\s+["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    imports.push(match[1]!);
  }
  return imports;
}

/** Get the boop module name from a relative import path. */
function resolveModuleDir(fromFile: string, importPath: string): string | null {
  if (!importPath.startsWith("..") && !importPath.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(fromFile), importPath);
  const rel = path.relative(SRC, resolved);
  const parts = rel.split(path.sep);
  return parts[0] ?? null;
}

const allSourceFiles = walk(SRC).filter((f) => !f.endsWith(".test.ts"));
const allTestFiles = walk(SRC).filter((f) => f.endsWith(".test.ts"));

// ---------------------------------------------------------------------------
// 1. Layered Architecture — import boundary enforcement
// ---------------------------------------------------------------------------

describe("layered architecture", () => {
  // Modules that should NEVER import from higher-layer orchestration code
  const leafModules = ["shared", "profile", "security", "types"];
  const domainModules = ["planning", "build", "bridge", "review", "retrospective", "scaffolding"];

  it("shared/ does not import from any boop domain or pipeline module", () => {
    const sharedFiles = allSourceFiles.filter((f) => f.startsWith(path.join(SRC, "shared")));
    const violations: string[] = [];

    for (const file of sharedFiles) {
      for (const imp of extractImports(file)) {
        const mod = resolveModuleDir(file, imp);
        if (mod && !leafModules.includes(mod)) {
          violations.push(`${path.relative(SRC, file)} imports from ${mod}/ (${imp})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("domain modules do not import from pipeline/ or cli/", () => {
    const forbidden = ["pipeline", "cli"];
    const violations: string[] = [];

    for (const mod of domainModules) {
      const files = allSourceFiles.filter((f) => f.startsWith(path.join(SRC, mod)));
      for (const file of files) {
        for (const imp of extractImports(file)) {
          const target = resolveModuleDir(file, imp);
          if (target && forbidden.includes(target)) {
            violations.push(`${path.relative(SRC, file)} imports from ${target}/ (${imp})`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("planning/ does not import from build/", () => {
    const forbidden = ["build"];
    // NOTE: planning/ legitimately imports type-only ReviewRule from review/
    // for the self-improvement loop (outcome injection). It also imports from
    // evolution/ for prompt augmentation. Only build/ is forbidden.
    const planningFiles = allSourceFiles.filter((f) => f.startsWith(path.join(SRC, "planning")));
    const violations: string[] = [];

    for (const file of planningFiles) {
      for (const imp of extractImports(file)) {
        const target = resolveModuleDir(file, imp);
        if (target && forbidden.includes(target)) {
          violations.push(`${path.relative(SRC, file)} imports from ${target}/ (${imp})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("build/ does not import from review/ or planning/", () => {
    const forbidden = ["review", "planning"];
    const buildFiles = allSourceFiles.filter((f) => f.startsWith(path.join(SRC, "build")));
    const violations: string[] = [];

    for (const file of buildFiles) {
      for (const imp of extractImports(file)) {
        const target = resolveModuleDir(file, imp);
        if (target && forbidden.includes(target)) {
          violations.push(`${path.relative(SRC, file)} imports from ${target}/ (${imp})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("review/ does not import from build/ or planning/", () => {
    const forbidden = ["build", "planning"];
    const reviewFiles = allSourceFiles.filter((f) => f.startsWith(path.join(SRC, "review")));
    const violations: string[] = [];

    for (const file of reviewFiles) {
      for (const imp of extractImports(file)) {
        const target = resolveModuleDir(file, imp);
        if (target && forbidden.includes(target)) {
          violations.push(`${path.relative(SRC, file)} imports from ${target}/ (${imp})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Naming conventions
// ---------------------------------------------------------------------------

describe("naming conventions", () => {
  it("all source files use kebab-case", () => {
    const violations: string[] = [];
    const kebabRe = /^[a-z0-9]+(-[a-z0-9]+)*\.(ts|d\.ts)$/;

    for (const file of [...allSourceFiles, ...allTestFiles]) {
      const basename = path.basename(file);
      // Allow index.ts and .test.ts suffix
      const normalized = basename.replace(".test.ts", ".ts");
      if (normalized !== "index.ts" && !kebabRe.test(normalized)) {
        violations.push(path.relative(SRC, file));
      }
    }

    expect(violations).toEqual([]);
  });

  it("all directories under src/ use kebab-case", () => {
    const violations: string[] = [];
    const kebabDirRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;

    function checkDirs(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== "node_modules") {
          if (!kebabDirRe.test(entry.name)) {
            violations.push(path.relative(SRC, path.join(dir, entry.name)));
          }
          checkDirs(path.join(dir, entry.name));
        }
      }
    }

    checkDirs(SRC);
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Test co-location
// ---------------------------------------------------------------------------

describe("test co-location", () => {
  // Files that are exempt from needing a paired test
  const exemptPatterns = [
    /index\.ts$/, // barrel files
    /\.d\.ts$/, // type declarations
    /types\.ts$/, // pure type files
    /shared\.ts$/, // shared utility modules (tested transitively)
    /baileys\.ts$/, // WhatsApp Baileys integration (requires real connection)
    /grammy-adapter\.ts$/, // Telegram grammy integration (requires real connection)
  ];

  /** Boop's own business logic directories (exclude OpenClaw/vendor dirs). */
  const boopDirs = [
    "pipeline",
    "planning",
    "build",
    "bridge",
    "review",
    "retrospective",
    "scaffolding",
    "deployment",
    "profile",
    "security",
    "sandbox",
    "channels",
    "gauntlet",
    "improve",
  ];

  it("every boop source file has a co-located .test.ts file", () => {
    const missing: string[] = [];

    for (const dir of boopDirs) {
      const dirPath = path.join(SRC, dir);
      if (!fs.existsSync(dirPath)) continue;

      const sourceFiles = walk(dirPath).filter(
        (f) => !f.endsWith(".test.ts") && !exemptPatterns.some((re) => re.test(path.basename(f))),
      );

      for (const file of sourceFiles) {
        const testFile = file.replace(/\.ts$/, ".test.ts");
        if (!fs.existsSync(testFile)) {
          missing.push(path.relative(SRC, file));
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. State machine integrity
// ---------------------------------------------------------------------------

describe("state machine integrity", () => {
  it("PIPELINE_PHASES starts with IDLE and ends with COMPLETE", () => {
    // Dynamically import to get the actual runtime value
    const typesPath = path.join(SRC, "shared", "types.ts");
    const content = fs.readFileSync(typesPath, "utf-8");

    // Extract the array literal from the source
    const match = content.match(/PIPELINE_PHASES\s*=\s*\[([\s\S]*?)\]\s*as\s*const/);
    expect(match).not.toBeNull();

    const phases = match![1]!
      .split(",")
      .map((s) => s.trim().replace(/['"]/g, ""))
      .filter(Boolean);

    expect(phases[0]).toBe("IDLE");
    expect(phases[phases.length - 1]).toBe("COMPLETE");

    // Core phases must be present in order
    const required = [
      "IDLE",
      "PLANNING",
      "ANALYZING",
      "BRIDGING",
      "SCAFFOLDING",
      "BUILDING",
      "REVIEWING",
      "SIGN_OFF",
      "DEPLOYING",
      "RETROSPECTIVE",
      "COMPLETE",
    ];
    for (let i = 0; i < required.length; i++) {
      expect(phases.indexOf(required[i]!)).toBe(i);
    }
  });

  it("TRANSITIONS map covers every pipeline phase", () => {
    const orchPath = path.join(SRC, "pipeline", "orchestrator.ts");
    const content = fs.readFileSync(orchPath, "utf-8");

    // Extract TRANSITIONS keys
    const transMatch = content.match(/const TRANSITIONS[\s\S]*?=\s*\{([\s\S]*?)\}\s*(?:as|;)/);
    expect(transMatch).not.toBeNull();

    const keys = [...transMatch![1]!.matchAll(/(\w+)\s*:/g)].map((m) => m[1]);

    const expectedPhases = [
      "IDLE",
      "PLANNING",
      "ANALYZING",
      "BRIDGING",
      "SCAFFOLDING",
      "BUILDING",
      "REVIEWING",
      "SIGN_OFF",
      "DEPLOYING",
      "RETROSPECTIVE",
      "COMPLETE",
    ];

    for (const phase of expectedPhases) {
      expect(keys).toContain(phase);
    }
  });

  it("REVIEWING always transitions to SIGN_OFF", () => {
    const orchPath = path.join(SRC, "pipeline", "orchestrator.ts");
    const content = fs.readFileSync(orchPath, "utf-8");

    // Find the REVIEWING entry in TRANSITIONS
    const match = content.match(/REVIEWING\s*:\s*\[(.*?)\]/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("SIGN_OFF");
  });

  it("COMPLETE can only transition back to IDLE", () => {
    const orchPath = path.join(SRC, "pipeline", "orchestrator.ts");
    const content = fs.readFileSync(orchPath, "utf-8");

    const match = content.match(/COMPLETE\s*:\s*\[(.*?)\]/);
    expect(match).not.toBeNull();

    const targets = match![1]!
      .split(",")
      .map((s) => s.trim().replace(/['"]/g, ""))
      .filter(Boolean);

    expect(targets).toEqual(["IDLE"]);
  });
});

// ---------------------------------------------------------------------------
// 5. No circular imports between top-level modules
// ---------------------------------------------------------------------------

describe("no cross-domain circular imports", () => {
  it("domain modules do not form circular dependencies", () => {
    const domains = ["planning", "build", "bridge", "review", "retrospective", "scaffolding"];
    // Build adjacency: domain -> set of domains it imports from
    const graph = new Map<string, Set<string>>();

    for (const mod of domains) {
      const files = allSourceFiles.filter((f) => f.startsWith(path.join(SRC, mod)));
      const deps = new Set<string>();

      for (const file of files) {
        for (const imp of extractImports(file)) {
          const target = resolveModuleDir(file, imp);
          if (target && domains.includes(target) && target !== mod) {
            deps.add(target);
          }
        }
      }

      graph.set(mod, deps);
    }

    // Check for cycles using DFS
    const cycles: string[] = [];

    function dfs(node: string, visited: Set<string>, path: string[]) {
      if (visited.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), node].join(" → "));
        }
        return;
      }
      visited.add(node);
      path.push(node);
      for (const dep of graph.get(node) ?? []) {
        dfs(dep, visited, path);
      }
      path.pop();
      visited.delete(node);
    }

    for (const mod of domains) {
      dfs(mod, new Set(), []);
    }

    expect(cycles).toEqual([]);
  });
});
