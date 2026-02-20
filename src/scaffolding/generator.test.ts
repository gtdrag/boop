import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeveloperProfile } from "../profile/schema.js";
import { DEFAULT_PROFILE } from "../profile/defaults.js";
import { scaffoldProject } from "./generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeProfile(overrides: Partial<DeveloperProfile> = {}): DeveloperProfile {
  return { ...DEFAULT_PROFILE, name: "Test Dev", ...overrides };
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(tmpDir, relPath));
}

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(tmpDir, relPath), "utf-8");
}

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFile(relPath)) as Record<string, unknown>;
}

function git(args: string): string {
  return execSync(`git ${args}`, {
    cwd: tmpDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trimEnd();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-scaffold-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Directory generation
// ---------------------------------------------------------------------------

describe("directory generation", () => {
  it("creates base directories for every project", () => {
    const profile = makeProfile();
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("src")).toBe(true);
    expect(fileExists("test")).toBe(true);
    expect(fileExists("test/unit")).toBe(true);
    expect(fileExists("test/integration")).toBe(true);
    expect(fileExists("test/fixtures")).toBe(true);
  });

  it("creates frontend directories when frontend framework is set", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("src/components")).toBe(true);
    expect(fileExists("src/pages")).toBe(true);
    expect(fileExists("src/styles")).toBe(true);
    expect(fileExists("public")).toBe(true);
  });

  it("skips frontend directories when framework is none", () => {
    const profile = makeProfile({ frontendFramework: "none" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("src/components")).toBe(false);
    expect(fileExists("src/pages")).toBe(false);
    expect(fileExists("public")).toBe(false);
  });

  it("creates backend directories when backend framework is set", () => {
    const profile = makeProfile({ backendFramework: "express" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("src/routes")).toBe(true);
    expect(fileExists("src/middleware")).toBe(true);
    expect(fileExists("src/models")).toBe(true);
  });

  it("skips backend directories when backend framework is none", () => {
    const profile = makeProfile({ backendFramework: "none" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("src/routes")).toBe(false);
    expect(fileExists("src/middleware")).toBe(false);
  });

  it("creates packages dir for monorepo structure", () => {
    const profile = makeProfile({ projectStructure: "monorepo" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("packages")).toBe(true);
  });

  it("skips packages dir for single-repo structure", () => {
    const profile = makeProfile({ projectStructure: "single-repo" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("packages")).toBe(false);
  });

  it("returns created directories in result", () => {
    const profile = makeProfile({
      frontendFramework: "none",
      backendFramework: "none",
      projectStructure: "single-repo",
    });
    const result = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(result.directories).toContain("src");
    expect(result.directories).toContain("test");
    expect(result.directories).toContain("test/unit");
  });
});

// ---------------------------------------------------------------------------
// package.json generation
// ---------------------------------------------------------------------------

describe("package.json generation", () => {
  it("creates package.json with project name from directory", () => {
    const profile = makeProfile();
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    expect(pkg.name).toBe(path.basename(tmpDir));
    expect(pkg.version).toBe("0.0.1");
    expect(pkg.type).toBe("module");
  });

  it("includes Next.js dependencies for next framework", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps.next).toBeTruthy();
    expect(deps.react).toBeTruthy();
    expect(deps["react-dom"]).toBeTruthy();
  });

  it("includes Express dependency for express backend", () => {
    const profile = makeProfile({ backendFramework: "express" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps.express).toBeTruthy();
  });

  it("includes Fastify dependency for fastify backend", () => {
    const profile = makeProfile({ backendFramework: "fastify" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps.fastify).toBeTruthy();
  });

  it("includes vitest for vitest test runner", () => {
    const profile = makeProfile({ testRunner: "vitest" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const devDeps = pkg.devDependencies as Record<string, string>;
    expect(devDeps.vitest).toBeTruthy();

    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.test).toBe("vitest run");
  });

  it("includes jest for jest test runner", () => {
    const profile = makeProfile({ testRunner: "jest" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const devDeps = pkg.devDependencies as Record<string, string>;
    expect(devDeps.jest).toBeTruthy();

    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.test).toBe("jest");
  });

  it("includes TypeScript devDep when language is typescript", () => {
    const profile = makeProfile({ languages: ["typescript"] });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const devDeps = pkg.devDependencies as Record<string, string>;
    expect(devDeps.typescript).toBeTruthy();
  });

  it("includes lint scripts for eslint", () => {
    const profile = makeProfile({ linter: "eslint" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.lint).toBe("eslint src/");
    const devDeps = pkg.devDependencies as Record<string, string>;
    expect(devDeps.eslint).toBeTruthy();
    expect(devDeps.prettier).toBeTruthy();
  });

  it("includes lint scripts for biome", () => {
    const profile = makeProfile({ linter: "biome" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.lint).toBe("biome check src/");
    const devDeps = pkg.devDependencies as Record<string, string>;
    expect(devDeps["@biomejs/biome"]).toBeTruthy();
  });

  it("includes lint scripts for oxlint", () => {
    const profile = makeProfile({ linter: "oxlint" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.lint).toBe("oxlint src/");
    expect(scripts.format).toBe("oxfmt --write");
  });

  it("does not overwrite existing package.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "existing" }),
      "utf-8",
    );

    const profile = makeProfile();
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    expect(pkg.name).toBe("existing");
  });

  it("includes Hono dependency for hono backend", () => {
    const profile = makeProfile({ backendFramework: "hono" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps.hono).toBeTruthy();
  });

  it("includes Astro dependency for astro framework", () => {
    const profile = makeProfile({ frontendFramework: "astro" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps.astro).toBeTruthy();
  });

  it("includes SvelteKit dependency for sveltekit framework", () => {
    const profile = makeProfile({ frontendFramework: "sveltekit" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const pkg = readJson("package.json");
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps["@sveltejs/kit"]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// tsconfig.json generation
// ---------------------------------------------------------------------------

describe("tsconfig.json generation", () => {
  it("creates tsconfig.json for TypeScript projects with frontend framework", () => {
    const profile = makeProfile({ languages: ["typescript"], frontendFramework: "next" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("tsconfig.json")).toBe(true);
    const tsconfig = readJson("tsconfig.json");
    const opts = tsconfig.compilerOptions as Record<string, unknown>;
    expect(opts.strict).toBe(true);
    expect(opts.module).toBe("ESNext");
    expect(opts.moduleResolution).toBe("bundler");
    expect(opts.target).toBe("es2023");
  });

  it("creates tsconfig.json with NodeNext for backend-only projects", () => {
    const profile = makeProfile({ languages: ["typescript"], frontendFramework: "none" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const tsconfig = readJson("tsconfig.json");
    const opts = tsconfig.compilerOptions as Record<string, unknown>;
    expect(opts.module).toBe("NodeNext");
    expect(opts.moduleResolution).toBe("NodeNext");
  });

  it("skips tsconfig.json for non-TypeScript projects", () => {
    const profile = makeProfile({ languages: ["javascript"] });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("tsconfig.json")).toBe(false);
  });

  it("adds JSX config for React-based frameworks", () => {
    const profile = makeProfile({ frontendFramework: "next", languages: ["typescript"] });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const tsconfig = readJson("tsconfig.json");
    const opts = tsconfig.compilerOptions as Record<string, unknown>;
    expect(opts.jsx).toBe("react-jsx");
  });

  it("does not add JSX for non-React frameworks", () => {
    const profile = makeProfile({ frontendFramework: "astro", languages: ["typescript"] });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const tsconfig = readJson("tsconfig.json");
    const opts = tsconfig.compilerOptions as Record<string, unknown>;
    expect(opts.jsx).toBeUndefined();
  });

  it("does not overwrite existing tsconfig.json", () => {
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({ custom: true }), "utf-8");

    const profile = makeProfile();
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const tsconfig = readJson("tsconfig.json");
    expect(tsconfig.custom).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Linter config generation
// ---------------------------------------------------------------------------

describe("linter config generation", () => {
  it("creates eslint.config.js for eslint", () => {
    const profile = makeProfile({ linter: "eslint" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("eslint.config.js")).toBe(true);
    const content = readFile("eslint.config.js");
    expect(content).toContain("@eslint/js");
  });

  it("creates biome.json for biome", () => {
    const profile = makeProfile({ linter: "biome" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("biome.json")).toBe(true);
    const config = readJson("biome.json");
    expect(config.linter).toBeTruthy();
  });

  it("creates no linter config for oxlint (zero-config)", () => {
    const profile = makeProfile({ linter: "oxlint" });
    const result = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("eslint.config.js")).toBe(false);
    expect(fileExists("biome.json")).toBe(false);
    expect(result.files).not.toContain("eslint.config.js");
    expect(result.files).not.toContain("biome.json");
  });

  it("creates no linter config when linter is none", () => {
    const profile = makeProfile({ linter: "none" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("eslint.config.js")).toBe(false);
    expect(fileExists("biome.json")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test runner config generation
// ---------------------------------------------------------------------------

describe("test runner config generation", () => {
  it("creates vitest.config.ts for vitest", () => {
    const profile = makeProfile({ testRunner: "vitest" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("vitest.config.ts")).toBe(true);
    const content = readFile("vitest.config.ts");
    expect(content).toContain("vitest/config");
  });

  it("creates jest.config.js for jest", () => {
    const profile = makeProfile({ testRunner: "jest" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("jest.config.js")).toBe(true);
    const content = readFile("jest.config.js");
    expect(content).toContain("testMatch");
  });

  it("creates no test config for mocha (uses defaults)", () => {
    const profile = makeProfile({ testRunner: "mocha" });
    const result = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(result.files).not.toContain("vitest.config.ts");
    expect(result.files).not.toContain("jest.config.js");
  });
});

// ---------------------------------------------------------------------------
// CI config generation
// ---------------------------------------------------------------------------

describe("CI config generation", () => {
  it("creates GitHub Actions workflow for github-actions", () => {
    const profile = makeProfile({ ciCd: "github-actions" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists(".github/workflows/ci.yml")).toBe(true);
    const content = readFile(".github/workflows/ci.yml");
    expect(content).toContain("actions/checkout");
    expect(content).toContain("pnpm install");
  });

  it("creates GitLab CI config for gitlab-ci", () => {
    const profile = makeProfile({ ciCd: "gitlab-ci" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists(".gitlab-ci.yml")).toBe(true);
    const content = readFile(".gitlab-ci.yml");
    expect(content).toContain("node:22");
  });

  it("creates CircleCI config for circleci", () => {
    const profile = makeProfile({ ciCd: "circleci" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists(".circleci/config.yml")).toBe(true);
    const content = readFile(".circleci/config.yml");
    expect(content).toContain("cimg/node");
  });

  it("creates no CI config when ciCd is none", () => {
    const profile = makeProfile({ ciCd: "none" });
    const result = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists(".github/workflows/ci.yml")).toBe(false);
    expect(fileExists(".gitlab-ci.yml")).toBe(false);
    expect(result.files.some((f) => f.includes("ci"))).toBe(false);
  });

  it("uses correct install command for npm", () => {
    const profile = makeProfile({ ciCd: "github-actions", packageManager: "npm" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const content = readFile(".github/workflows/ci.yml");
    expect(content).toContain("npm ci");
    expect(content).toContain("npm run lint");
  });

  it("uses correct install command for yarn", () => {
    const profile = makeProfile({ ciCd: "github-actions", packageManager: "yarn" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const content = readFile(".github/workflows/ci.yml");
    expect(content).toContain("yarn install --frozen-lockfile");
    expect(content).toContain("yarn lint");
  });

  it("uses correct install command for bun", () => {
    const profile = makeProfile({ ciCd: "github-actions", packageManager: "bun" });
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    const content = readFile(".github/workflows/ci.yml");
    expect(content).toContain("bun install --frozen-lockfile");
    expect(content).toContain("bun run lint");
  });
});

// ---------------------------------------------------------------------------
// .gitignore generation
// ---------------------------------------------------------------------------

describe(".gitignore generation", () => {
  it("creates .gitignore with standard entries", () => {
    const profile = makeProfile();
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists(".gitignore")).toBe(true);
    const content = readFile(".gitignore");
    expect(content).toContain("node_modules/");
    expect(content).toContain("dist/");
    expect(content).toContain(".env");
    expect(content).toContain(".boop/");
  });

  it("does not overwrite existing .gitignore", () => {
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "custom\n", "utf-8");

    const profile = makeProfile();
    scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(readFile(".gitignore")).toBe("custom\n");
  });
});

// ---------------------------------------------------------------------------
// Git initialization
// ---------------------------------------------------------------------------

describe("git initialization", () => {
  it("initializes a git repo and creates initial commit", () => {
    const profile = makeProfile();
    const result = scaffoldProject(profile, tmpDir);

    expect(result.gitInitialized).toBe(true);
    expect(fileExists(".git")).toBe(true);

    // Verify the initial commit exists
    const log = git("log --oneline -1");
    expect(log).toContain("initial project scaffold");
  });

  it("skips git init when skipGitInit is true", () => {
    const profile = makeProfile();
    const result = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(result.gitInitialized).toBe(false);
    expect(fileExists(".git")).toBe(false);
  });

  it("skips git init when .git already exists", () => {
    // Pre-initialize a repo
    execSync("git init", { cwd: tmpDir, stdio: "pipe" });

    const profile = makeProfile();
    const result = scaffoldProject(profile, tmpDir);

    // Should not re-init (gitInitialized false because .git already existed)
    expect(result.gitInitialized).toBe(false);
  });

  it("uses profile name for git author", () => {
    const profile = makeProfile({ name: "Jane Doe" });
    scaffoldProject(profile, tmpDir);

    const authorName = git("log -1 --format=%an");
    expect(authorName).toBe("Jane Doe");
  });

  it("uses Boop as author when profile name is empty", () => {
    const profile = makeProfile({ name: "" });
    scaffoldProject(profile, tmpDir);

    const authorName = git("log -1 --format=%an");
    expect(authorName).toBe("Boop");
  });

  it("commits all generated files", () => {
    const profile = makeProfile({
      ciCd: "github-actions",
      linter: "eslint",
      testRunner: "vitest",
    });
    scaffoldProject(profile, tmpDir);

    // Working tree should be clean after scaffold
    const status = git("status --porcelain");
    expect(status).toBe("");
  });
});

// ---------------------------------------------------------------------------
// ScaffoldResult
// ---------------------------------------------------------------------------

describe("ScaffoldResult", () => {
  it("lists all created files", () => {
    const profile = makeProfile({
      ciCd: "github-actions",
      linter: "eslint",
      testRunner: "vitest",
    });
    const result = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(result.files).toContain("package.json");
    expect(result.files).toContain("tsconfig.json");
    expect(result.files).toContain("eslint.config.js");
    expect(result.files).toContain("vitest.config.ts");
    expect(result.files).toContain(".github/workflows/ci.yml");
    expect(result.files).toContain(".gitignore");
  });

  it("lists all created directories", () => {
    const profile = makeProfile();
    const result = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(result.directories).toContain("src");
    expect(result.directories).toContain("test");
  });

  it("does not double-count existing directories", () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });

    const profile = makeProfile();
    const result = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(result.directories).not.toContain("src");
    expect(result.directories).toContain("test");
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  it("running scaffold twice does not duplicate files", () => {
    const profile = makeProfile();

    const result1 = scaffoldProject(profile, tmpDir, { skipGitInit: true });
    const result2 = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    // Second run should not create any new files
    expect(result2.files).toHaveLength(0);
    // But first run should have created files
    expect(result1.files.length).toBeGreaterThan(0);
  });

  it("running scaffold twice does not duplicate directories", () => {
    const profile = makeProfile();

    scaffoldProject(profile, tmpDir, { skipGitInit: true });
    const result2 = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(result2.directories).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Full-stack profiles
// ---------------------------------------------------------------------------

describe("full-stack profiles", () => {
  it("scaffolds a complete Next.js + Express + Vitest + GitHub Actions project", () => {
    const profile = makeProfile({
      frontendFramework: "next",
      backendFramework: "express",
      testRunner: "vitest",
      ciCd: "github-actions",
      linter: "oxlint",
      packageManager: "pnpm",
    });
    const result = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    // Directories
    expect(fileExists("src/components")).toBe(true);
    expect(fileExists("src/routes")).toBe(true);

    // Files
    expect(result.files).toContain("package.json");
    expect(result.files).toContain("tsconfig.json");
    expect(result.files).toContain("vitest.config.ts");
    expect(result.files).toContain(".github/workflows/ci.yml");

    // Package contents
    const pkg = readJson("package.json");
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps.next).toBeTruthy();
    expect(deps.express).toBeTruthy();
  });

  it("scaffolds a minimal backend-only project", () => {
    const profile = makeProfile({
      frontendFramework: "none",
      backendFramework: "fastify",
      testRunner: "jest",
      ciCd: "none",
      linter: "none",
      projectStructure: "single-repo",
    });
    const result = scaffoldProject(profile, tmpDir, { skipGitInit: true });

    expect(fileExists("src/routes")).toBe(true);
    expect(fileExists("src/components")).toBe(false);
    expect(fileExists("packages")).toBe(false);

    const pkg = readJson("package.json");
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps.fastify).toBeTruthy();
    expect(deps.next).toBeUndefined();

    // No CI or linter config
    expect(result.files.some((f) => f.includes("ci"))).toBe(false);
  });
});
