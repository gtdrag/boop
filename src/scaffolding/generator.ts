/**
 * Project scaffolding from developer profile.
 *
 * Generates a project skeleton with directories, configs, and boilerplate
 * that match the developer's preferred tech stack. Runs once per project
 * during the SCAFFOLDING pipeline phase (after BRIDGING, before BUILDING).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { DeveloperProfile } from "../profile/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaffoldResult {
  /** Directories created. */
  directories: string[];
  /** Files created (relative paths). */
  files: string[];
  /** Whether a git repo was initialized. */
  gitInitialized: boolean;
}

// ---------------------------------------------------------------------------
// Directory structures
// ---------------------------------------------------------------------------

/** Base directories that every project gets. */
const BASE_DIRS = ["src", "test", "test/unit", "test/integration", "test/fixtures"];

/** Extra dirs for frontend projects. */
const FRONTEND_DIRS = ["src/components", "src/pages", "src/styles", "public"];

/** Extra dirs for backend projects. */
const BACKEND_DIRS = ["src/routes", "src/middleware", "src/models"];

/** Extra dirs for monorepo projects. */
const MONOREPO_DIRS = ["packages"];

// ---------------------------------------------------------------------------
// Package.json generation
// ---------------------------------------------------------------------------

function buildPackageJson(projectName: string, profile: DeveloperProfile): Record<string, unknown> {
  const pkg: Record<string, unknown> = {
    name: projectName,
    version: "0.0.1",
    private: true,
    type: "module",
    scripts: {} as Record<string, string>,
    dependencies: {} as Record<string, string>,
    devDependencies: {} as Record<string, string>,
  };

  const scripts = pkg.scripts as Record<string, string>;
  const deps = pkg.dependencies as Record<string, string>;
  const devDeps = pkg.devDependencies as Record<string, string>;

  // Language-specific setup
  const isTypeScript = profile.languages[0] === "typescript";
  if (isTypeScript) {
    devDeps.typescript = "^5.0.0";
    scripts.typecheck = "tsc --noEmit";
  }

  // Tailwind CSS for frontend projects
  if (profile.frontendFramework !== "none") {
    devDeps.tailwindcss = "^4.0.0";
    devDeps["@tailwindcss/postcss"] = "^4.0.0";
  }

  // Frontend framework
  switch (profile.frontendFramework) {
    case "next":
      deps.next = "^15.0.0";
      deps.react = "^19.0.0";
      deps["react-dom"] = "^19.0.0";
      if (isTypeScript) {
        devDeps["@types/react"] = "^19.0.0";
        devDeps["@types/react-dom"] = "^19.0.0";
      }
      scripts.dev = "next dev";
      scripts.build = "next build";
      scripts.start = "next start";
      break;
    case "remix":
      deps["@remix-run/node"] = "^2.0.0";
      deps["@remix-run/react"] = "^2.0.0";
      if (isTypeScript) {
        devDeps["@types/react"] = "^19.0.0";
        devDeps["@types/react-dom"] = "^19.0.0";
      }
      scripts.dev = "remix dev";
      scripts.build = "remix build";
      break;
    case "astro":
      deps.astro = "^4.0.0";
      scripts.dev = "astro dev";
      scripts.build = "astro build";
      break;
    case "nuxt":
      deps.nuxt = "^3.0.0";
      scripts.dev = "nuxt dev";
      scripts.build = "nuxt build";
      break;
    case "sveltekit":
      deps["@sveltejs/kit"] = "^2.0.0";
      scripts.dev = "vite dev";
      scripts.build = "vite build";
      break;
    case "vite-react":
      deps.react = "^19.0.0";
      deps["react-dom"] = "^19.0.0";
      if (isTypeScript) {
        devDeps["@types/react"] = "^19.0.0";
        devDeps["@types/react-dom"] = "^19.0.0";
      }
      devDeps.vite = "^6.0.0";
      scripts.dev = "vite";
      scripts.build = "vite build";
      break;
    case "vite-vue":
      deps.vue = "^3.0.0";
      devDeps.vite = "^6.0.0";
      scripts.dev = "vite";
      scripts.build = "vite build";
      break;
    case "angular":
      deps["@angular/core"] = "^18.0.0";
      scripts.dev = "ng serve";
      scripts.build = "ng build";
      break;
  }

  // Backend framework
  switch (profile.backendFramework) {
    case "express":
      deps.express = "^5.0.0";
      if (!scripts.dev) scripts.dev = "tsx src/index.ts";
      if (!scripts.start) scripts.start = "node dist/index.js";
      break;
    case "fastify":
      deps.fastify = "^5.0.0";
      if (!scripts.dev) scripts.dev = "tsx src/index.ts";
      if (!scripts.start) scripts.start = "node dist/index.js";
      break;
    case "hono":
      deps.hono = "^4.0.0";
      if (!scripts.dev) scripts.dev = "tsx src/index.ts";
      if (!scripts.start) scripts.start = "node dist/index.js";
      break;
    case "nest":
      deps["@nestjs/core"] = "^10.0.0";
      deps["@nestjs/common"] = "^10.0.0";
      if (!scripts.dev) scripts.dev = "nest start --watch";
      if (!scripts.build) scripts.build = "nest build";
      break;
    case "koa":
      deps.koa = "^2.0.0";
      if (!scripts.dev) scripts.dev = "tsx src/index.ts";
      if (!scripts.start) scripts.start = "node dist/index.js";
      break;
  }

  // Test runner
  switch (profile.testRunner) {
    case "vitest":
      devDeps.vitest = "^3.0.0";
      scripts.test = "vitest run";
      scripts["test:watch"] = "vitest";
      break;
    case "jest":
      devDeps.jest = "^30.0.0";
      if (isTypeScript) devDeps["ts-jest"] = "^29.0.0";
      scripts.test = "jest";
      break;
    case "mocha":
      devDeps.mocha = "^11.0.0";
      scripts.test = "mocha";
      break;
    case "playwright":
      devDeps["@playwright/test"] = "^1.0.0";
      scripts.test = "playwright test";
      break;
  }

  // Linter
  switch (profile.linter) {
    case "oxlint":
      devDeps.oxlint = "^0.16.0";
      scripts.lint = "oxlint src/";
      scripts.format = "oxfmt --write";
      scripts["format:check"] = "oxfmt --check";
      break;
    case "eslint":
      devDeps.eslint = "^9.0.0";
      scripts.lint = "eslint src/";
      devDeps.prettier = "^3.0.0";
      scripts.format = "prettier --write .";
      scripts["format:check"] = "prettier --check .";
      break;
    case "biome":
      devDeps["@biomejs/biome"] = "^1.0.0";
      scripts.lint = "biome check src/";
      scripts.format = "biome format --write .";
      scripts["format:check"] = "biome format .";
      break;
  }

  return pkg;
}

// ---------------------------------------------------------------------------
// tsconfig.json generation
// ---------------------------------------------------------------------------

function buildTsConfig(profile: DeveloperProfile): Record<string, unknown> | null {
  if (profile.languages[0] !== "typescript") return null;

  // Frontend frameworks use bundlers (webpack/vite/turbopack) which need
  // moduleResolution: "bundler". Pure Node.js backends use "NodeNext".
  const useBundler = profile.frontendFramework !== "none";

  const config: Record<string, unknown> = {
    compilerOptions: {
      target: "es2023",
      module: useBundler ? "ESNext" : "NodeNext",
      moduleResolution: useBundler ? "bundler" : "NodeNext",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      noEmit: true,
    },
    include: ["src/**/*"],
    exclude: ["node_modules", "dist"],
  };

  // Adjust for frontend frameworks that need JSX
  const jsxFrameworks = ["next", "remix", "vite-react", "angular"];
  if (jsxFrameworks.includes(profile.frontendFramework)) {
    (config.compilerOptions as Record<string, unknown>).jsx = "react-jsx";
    (config.compilerOptions as Record<string, unknown>).lib = ["DOM", "DOM.Iterable", "ES2023"];
  }

  return config;
}

// ---------------------------------------------------------------------------
// Linter config generation
// ---------------------------------------------------------------------------

function buildLinterConfig(
  profile: DeveloperProfile,
): { filename: string; content: string } | null {
  switch (profile.linter) {
    case "eslint":
      return {
        filename: "eslint.config.js",
        content: `import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": "warn",
    },
  },
];
`,
      };
    case "biome":
      return {
        filename: "biome.json",
        content:
          JSON.stringify(
            {
              $schema: "https://biomejs.dev/schemas/1.0.0/schema.json",
              organizeImports: { enabled: true },
              linter: {
                enabled: true,
                rules: { recommended: true },
              },
              formatter: {
                enabled: true,
                indentStyle: "space",
                indentWidth: 2,
              },
            },
            null,
            2,
          ) + "\n",
      };
    case "oxlint":
      // oxlint works with zero config — no file needed
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Test runner config generation
// ---------------------------------------------------------------------------

function buildTestRunnerConfig(
  profile: DeveloperProfile,
): { filename: string; content: string } | null {
  switch (profile.testRunner) {
    case "vitest":
      return {
        filename: "vitest.config.ts",
        content: `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
});
`,
      };
    case "jest":
      return {
        filename: "jest.config.js",
        content: `/** @type {import("jest").Config} */
export default {
  testMatch: ["**/*.test.ts", "**/*.test.js"],
  transform: ${profile.languages[0] === "typescript" ? '{ "^.+\\\\.tsx?$": "ts-jest" }' : "{}"},
};
`,
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// CI config generation
// ---------------------------------------------------------------------------

function buildCiConfig(profile: DeveloperProfile): { filepath: string; content: string } | null {
  const installCmd =
    profile.packageManager === "npm"
      ? "npm ci"
      : profile.packageManager === "yarn"
        ? "yarn install --frozen-lockfile"
        : profile.packageManager === "bun"
          ? "bun install --frozen-lockfile"
          : "pnpm install --frozen-lockfile";

  const runPrefix =
    profile.packageManager === "npm"
      ? "npm run"
      : profile.packageManager === "yarn"
        ? "yarn"
        : profile.packageManager === "bun"
          ? "bun run"
          : "pnpm";

  switch (profile.ciCd) {
    case "github-actions":
      return {
        filepath: ".github/workflows/ci.yml",
        content: `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: ${installCmd}
      - run: ${runPrefix} lint
      - run: ${runPrefix} typecheck
      - run: ${runPrefix} test
`,
      };
    case "gitlab-ci":
      return {
        filepath: ".gitlab-ci.yml",
        content: `image: node:22

stages:
  - test

test:
  stage: test
  script:
    - ${installCmd}
    - ${runPrefix} lint
    - ${runPrefix} typecheck
    - ${runPrefix} test
`,
      };
    case "circleci":
      return {
        filepath: ".circleci/config.yml",
        content: `version: 2.1

jobs:
  test:
    docker:
      - image: cimg/node:22.0
    steps:
      - checkout
      - run: ${installCmd}
      - run: ${runPrefix} lint
      - run: ${runPrefix} typecheck
      - run: ${runPrefix} test

workflows:
  main:
    jobs:
      - test
`,
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tailwind / PostCSS config generation
// ---------------------------------------------------------------------------

function buildPostCssConfig(
  profile: DeveloperProfile,
): { filename: string; content: string } | null {
  if (profile.frontendFramework === "none") return null;

  return {
    filename: "postcss.config.mjs",
    content: `export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
`,
  };
}

function buildGlobalsCss(
  profile: DeveloperProfile,
): { filepath: string; content: string } | null {
  switch (profile.frontendFramework) {
    case "next":
      return { filepath: "src/app/globals.css", content: "@import \"tailwindcss\";\n" };
    case "vite-react":
    case "vite-vue":
      return { filepath: "src/index.css", content: "@import \"tailwindcss\";\n" };
    case "remix":
    case "astro":
    case "sveltekit":
    case "nuxt":
      return { filepath: "src/styles/globals.css", content: "@import \"tailwindcss\";\n" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Gitignore
// ---------------------------------------------------------------------------

function buildGitignore(): string {
  return `node_modules/
dist/
.env
.env.local
*.log
logs/
.DS_Store
coverage/
.boop/
`;
}

// ---------------------------------------------------------------------------
// Main scaffolding function
// ---------------------------------------------------------------------------

/**
 * Scaffold a project skeleton based on the developer profile.
 *
 * Creates directories, config files, and optionally initializes
 * a git repo with an initial commit.
 *
 * @param profile - Developer profile with tech-stack preferences
 * @param projectDir - Absolute path to the target project directory
 * @param options - Optional overrides
 */
export function scaffoldProject(
  profile: DeveloperProfile,
  projectDir: string,
  options?: { skipGitInit?: boolean },
): ScaffoldResult {
  const createdDirs: string[] = [];
  const createdFiles: string[] = [];

  // Derive project name from directory basename
  const projectName = path.basename(projectDir);

  // --- 1. Create directories ---
  const dirs = [...BASE_DIRS];

  if (profile.frontendFramework !== "none") {
    dirs.push(...FRONTEND_DIRS);
  }
  if (profile.backendFramework !== "none") {
    dirs.push(...BACKEND_DIRS);
  }
  if (profile.projectStructure === "monorepo") {
    dirs.push(...MONOREPO_DIRS);
  }

  for (const dir of dirs) {
    const fullPath = path.join(projectDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      createdDirs.push(dir);
    }
  }

  // --- 2. Generate package.json ---
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    const pkg = buildPackageJson(projectName, profile);
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    createdFiles.push("package.json");
  }

  // --- 3. Generate tsconfig.json ---
  const tsConfig = buildTsConfig(profile);
  if (tsConfig) {
    const tsPath = path.join(projectDir, "tsconfig.json");
    if (!fs.existsSync(tsPath)) {
      fs.writeFileSync(tsPath, JSON.stringify(tsConfig, null, 2) + "\n", "utf-8");
      createdFiles.push("tsconfig.json");
    }
  }

  // --- 4. Generate linter config ---
  const linterConfig = buildLinterConfig(profile);
  if (linterConfig) {
    const linterPath = path.join(projectDir, linterConfig.filename);
    if (!fs.existsSync(linterPath)) {
      fs.writeFileSync(linterPath, linterConfig.content, "utf-8");
      createdFiles.push(linterConfig.filename);
    }
  }

  // --- 5. Generate test runner config ---
  const testConfig = buildTestRunnerConfig(profile);
  if (testConfig) {
    const testPath = path.join(projectDir, testConfig.filename);
    if (!fs.existsSync(testPath)) {
      fs.writeFileSync(testPath, testConfig.content, "utf-8");
      createdFiles.push(testConfig.filename);
    }
  }

  // --- 6. Generate CI config ---
  const ciConfig = buildCiConfig(profile);
  if (ciConfig) {
    const ciDir = path.dirname(path.join(projectDir, ciConfig.filepath));
    fs.mkdirSync(ciDir, { recursive: true });
    const ciPath = path.join(projectDir, ciConfig.filepath);
    if (!fs.existsSync(ciPath)) {
      fs.writeFileSync(ciPath, ciConfig.content, "utf-8");
      createdFiles.push(ciConfig.filepath);
      // Track the CI directory if it was new
      const relDir = path.relative(projectDir, ciDir);
      if (!createdDirs.includes(relDir)) {
        createdDirs.push(relDir);
      }
    }
  }

  // --- 7. Generate PostCSS config (Tailwind) ---
  const postCssConfig = buildPostCssConfig(profile);
  if (postCssConfig) {
    const postCssPath = path.join(projectDir, postCssConfig.filename);
    if (!fs.existsSync(postCssPath)) {
      fs.writeFileSync(postCssPath, postCssConfig.content, "utf-8");
      createdFiles.push(postCssConfig.filename);
    }
  }

  // --- 8. Generate globals CSS (Tailwind base import) ---
  const globalsCss = buildGlobalsCss(profile);
  if (globalsCss) {
    const cssDir = path.dirname(path.join(projectDir, globalsCss.filepath));
    fs.mkdirSync(cssDir, { recursive: true });
    const cssPath = path.join(projectDir, globalsCss.filepath);
    if (!fs.existsSync(cssPath)) {
      fs.writeFileSync(cssPath, globalsCss.content, "utf-8");
      createdFiles.push(globalsCss.filepath);
    }
  }

  // --- 9. Generate .gitignore ---
  const gitignorePath = path.join(projectDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, buildGitignore(), "utf-8");
    createdFiles.push(".gitignore");
  }

  // --- 10. Initialize git repo ---
  let gitInitialized = false;
  if (!options?.skipGitInit) {
    const gitDir = path.join(projectDir, ".git");
    if (!fs.existsSync(gitDir)) {
      execFileSync("git", ["init"], { cwd: projectDir, stdio: "pipe" });
      execFileSync("git", ["add", "-A"], { cwd: projectDir, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "chore: initial project scaffold"], {
        cwd: projectDir,
        stdio: "pipe",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: profile.name || "Boop",
          GIT_AUTHOR_EMAIL: "boop@scaffold",
          GIT_COMMITTER_NAME: profile.name || "Boop",
          GIT_COMMITTER_EMAIL: "boop@scaffold",
        },
      });
      gitInitialized = true;
    }
  }

  return { directories: createdDirs, files: createdFiles, gitInitialized };
}
