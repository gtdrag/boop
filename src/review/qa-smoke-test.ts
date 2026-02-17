/**
 * Browser QA smoke test agent — verifies the generated project works in a real browser.
 *
 * Uses Playwright (headless Chromium) to:
 *   1. Start the project's dev server
 *   2. Discover routes from the project's router config or crawl from /
 *   3. Visit each route and check for: HTTP 200, no console errors, no crashes
 *   4. Capture screenshots at each route
 *   5. Report results with blocking failures
 *
 * Screenshots and results are saved to .boop/reviews/epic-N/qa-smoke-test/.
 */
import fs from "node:fs";
import path from "node:path";

import type {
  AgentResult,
  ReviewContext,
  ReviewFinding,
  FindingSeverity,
} from "./team-orchestrator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouteResult {
  /** The route path (e.g. "/", "/about"). */
  route: string;
  /** HTTP status code returned. */
  status: number;
  /** Whether the page loaded without errors. */
  success: boolean;
  /** Console errors collected during page load. */
  consoleErrors: string[];
  /** Page exceptions (unhandled errors). */
  pageErrors: string[];
  /** Path to the screenshot file (if captured). */
  screenshotPath?: string;
  /** Error message if the route failed entirely. */
  error?: string;
}

export interface QaSmokeTestResult {
  /** All route results. */
  routes: RouteResult[];
  /** Whether the dev server started successfully. */
  serverStarted: boolean;
  /** Error message if the server failed to start. */
  serverError?: string;
}

export interface DevServerHandle {
  /** The URL the dev server is listening on. */
  url: string;
  /** Kill the dev server process. */
  kill: () => void;
}

// ---------------------------------------------------------------------------
// Route discovery
// ---------------------------------------------------------------------------

/**
 * Attempt to discover routes from common project configurations.
 * Looks for Next.js pages/app dirs, React Router config, Express routes, etc.
 * Falls back to ["/"] if no routes can be discovered.
 */
export function discoverRoutes(projectDir: string): string[] {
  const routes = new Set<string>();

  // Next.js: pages/ directory
  for (const pagesDir of ["pages", "src/pages"]) {
    const fullPath = path.join(projectDir, pagesDir);
    if (fs.existsSync(fullPath)) {
      collectNextPages(fullPath, "", routes);
    }
  }

  // Next.js: app/ directory (App Router)
  for (const appDir of ["app", "src/app"]) {
    const fullPath = path.join(projectDir, appDir);
    if (fs.existsSync(fullPath)) {
      collectNextAppRoutes(fullPath, "", routes);
    }
  }

  // If we found framework routes, return them
  if (routes.size > 0) {
    // Always include root
    routes.add("/");
    return [...routes].sort();
  }

  // Fallback: check for a static index.html
  if (
    fs.existsSync(path.join(projectDir, "public", "index.html")) ||
    fs.existsSync(path.join(projectDir, "index.html"))
  ) {
    return ["/"];
  }

  // Default: just check root
  return ["/"];
}

/** Collect routes from Next.js pages directory. */
function collectNextPages(dir: string, prefix: string, routes: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

    if (entry.isDirectory()) {
      // Skip api routes — they're not pages
      if (entry.name === "api") continue;
      collectNextPages(path.join(dir, entry.name), `${prefix}/${entry.name}`, routes);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (![".tsx", ".ts", ".jsx", ".js"].includes(ext)) continue;

      const basename = path.basename(entry.name, ext);
      if (basename === "index") {
        routes.add(prefix || "/");
      } else if (!basename.startsWith("[")) {
        routes.add(`${prefix}/${basename}`);
      }
    }
  }
}

/** Collect routes from Next.js app directory. */
function collectNextAppRoutes(dir: string, prefix: string, routes: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Check if this directory has a page file
  const hasPage = entries.some(
    (e) =>
      e.isFile() &&
      (e.name === "page.tsx" ||
        e.name === "page.ts" ||
        e.name === "page.jsx" ||
        e.name === "page.js"),
  );

  if (hasPage) {
    routes.add(prefix || "/");
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("(") || entry.name.startsWith("_") || entry.name.startsWith(".")) {
      // Route groups — recurse without adding prefix
      if (entry.name.startsWith("(")) {
        collectNextAppRoutes(path.join(dir, entry.name), prefix, routes);
      }
      continue;
    }
    // Skip api routes and dynamic segments
    if (entry.name === "api" || entry.name.startsWith("[")) continue;
    collectNextAppRoutes(path.join(dir, entry.name), `${prefix}/${entry.name}`, routes);
  }
}

// ---------------------------------------------------------------------------
// Dev server management
// ---------------------------------------------------------------------------

/**
 * Detect and return the dev server command for the project.
 * Checks package.json scripts for common dev commands.
 */
export function detectDevCommand(projectDir: string): { cmd: string; args: string[] } | null {
  const pkgPath = path.join(projectDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const scripts = pkg.scripts as Record<string, string> | undefined;
  if (!scripts) return null;

  // Check for common dev script names
  for (const name of ["dev", "start", "serve"]) {
    if (scripts[name]) {
      return { cmd: "npm", args: ["run", name] };
    }
  }

  return null;
}

/**
 * Start the project's dev server and wait for it to be ready.
 * Returns a handle to kill the server process.
 */
export async function startDevServer(
  projectDir: string,
  options: {
    /** Override the dev command. */
    devCommand?: { cmd: string; args: string[] };
    /** Port to expect the server on. Defaults to 3000. */
    port?: number;
    /** Timeout in ms to wait for the server. Defaults to 30000. */
    startupTimeoutMs?: number;
    /** Custom fetch function (for testing). */
    fetchFn?: typeof globalThis.fetch;
  } = {},
): Promise<DevServerHandle> {
  const { port = 3000, startupTimeoutMs = 30_000, fetchFn = globalThis.fetch } = options;

  const devCmd = options.devCommand ?? detectDevCommand(projectDir);
  if (!devCmd) {
    throw new Error("No dev command found in package.json (looked for: dev, start, serve)");
  }

  const url = `http://localhost:${port}`;

  // Spawn the dev server process
  const { spawn } = await import("node:child_process");
  const proc = spawn(devCmd.cmd, devCmd.args, {
    cwd: projectDir,
    stdio: "pipe",
    env: { ...process.env, PORT: String(port), NODE_ENV: "development" },
    detached: false,
  });

  const handle: DevServerHandle = {
    url,
    kill: () => {
      try {
        proc.kill("SIGTERM");
      } catch {
        // Process already exited
      }
    },
  };

  // Wait for the server to be ready (poll until reachable)
  const startTime = Date.now();
  const pollIntervalMs = 500;

  while (Date.now() - startTime < startupTimeoutMs) {
    try {
      const resp = await fetchFn(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok || resp.status < 500) {
        return handle;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout — kill and throw
  handle.kill();
  throw new Error(`Dev server did not start within ${startupTimeoutMs}ms on ${url}`);
}

// ---------------------------------------------------------------------------
// Browser testing with Playwright
// ---------------------------------------------------------------------------

export interface BrowserTestOptions {
  /** The base URL of the dev server. */
  baseUrl: string;
  /** Routes to test. */
  routes: string[];
  /** Directory to save screenshots. */
  screenshotDir: string;
  /** Navigation timeout in ms. Defaults to 15000. */
  navigationTimeoutMs?: number;
  /** Custom Playwright launcher (for testing). */
  launchBrowser?: () => Promise<PlaywrightBrowserHandle>;
}

/** Minimal abstraction over Playwright browser for testability. */
export interface PlaywrightBrowserHandle {
  newPage: () => Promise<PlaywrightPageHandle>;
  close: () => Promise<void>;
}

/** Minimal abstraction over Playwright page for testability. */
export interface PlaywrightPageHandle {
  goto: (
    url: string,
    options?: { timeout?: number; waitUntil?: string },
  ) => Promise<{ status: () => number | null }>;
  screenshot: (options: { path: string; fullPage?: boolean }) => Promise<void>;
  onConsoleError: (handler: (msg: string) => void) => void;
  onPageError: (handler: (err: string) => void) => void;
  close: () => Promise<void>;
}

/**
 * Default Playwright browser launcher using playwright-core.
 * Launches headless Chromium.
 */
export async function launchPlaywrightBrowser(): Promise<PlaywrightBrowserHandle> {
  const { chromium } = await import("playwright-core");

  const browser = await chromium.launch({ headless: true });

  return {
    newPage: async () => {
      const page = await browser.newPage();
      return {
        goto: async (url: string, opts?: { timeout?: number; waitUntil?: string }) => {
          const response = await page.goto(url, {
            timeout: opts?.timeout,
            waitUntil: (opts?.waitUntil as "load" | "networkidle") ?? "load",
          });
          return { status: () => response?.status() ?? null };
        },
        screenshot: async (opts: { path: string; fullPage?: boolean }) => {
          await page.screenshot({ path: opts.path, fullPage: opts.fullPage ?? true });
        },
        onConsoleError: (handler: (msg: string) => void) => {
          page.on("console", (msg) => {
            if (msg.type() === "error") {
              handler(msg.text());
            }
          });
        },
        onPageError: (handler: (err: string) => void) => {
          page.on("pageerror", (err) => {
            handler(err.message);
          });
        },
        close: async () => {
          await page.close();
        },
      };
    },
    close: async () => {
      await browser.close();
    },
  };
}

/**
 * Test a set of routes in a headless browser and capture results + screenshots.
 */
export async function testRoutes(options: BrowserTestOptions): Promise<RouteResult[]> {
  const {
    baseUrl,
    routes,
    screenshotDir,
    navigationTimeoutMs = 15_000,
    launchBrowser = launchPlaywrightBrowser,
  } = options;

  fs.mkdirSync(screenshotDir, { recursive: true });

  const results: RouteResult[] = [];
  let browser: PlaywrightBrowserHandle | null = null;

  try {
    browser = await launchBrowser();

    for (const route of routes) {
      const routeResult = await testSingleRoute(
        browser,
        baseUrl,
        route,
        screenshotDir,
        navigationTimeoutMs,
      );
      results.push(routeResult);
    }
  } catch (error: unknown) {
    // Browser launch failure — report as a single failing result
    const msg = error instanceof Error ? error.message : String(error);
    results.push({
      route: "/",
      status: 0,
      success: false,
      consoleErrors: [],
      pageErrors: [],
      error: `Browser launch failed: ${msg}`,
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  return results;
}

async function testSingleRoute(
  browser: PlaywrightBrowserHandle,
  baseUrl: string,
  route: string,
  screenshotDir: string,
  timeoutMs: number,
): Promise<RouteResult> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let page: PlaywrightPageHandle | null = null;

  try {
    page = await browser.newPage();

    // Collect console errors and page exceptions
    page.onConsoleError((msg) => consoleErrors.push(msg));
    page.onPageError((err) => pageErrors.push(err));

    const url = `${baseUrl}${route}`;
    const response = await page.goto(url, { timeout: timeoutMs, waitUntil: "load" });
    const status = response.status() ?? 0;

    // Take screenshot
    const safeName = route === "/" ? "index" : route.replace(/\//g, "_").replace(/^_/, "");
    const screenshotPath = path.join(screenshotDir, `${safeName}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const success =
      status >= 200 && status < 400 && consoleErrors.length === 0 && pageErrors.length === 0;

    return {
      route,
      status,
      success,
      consoleErrors,
      pageErrors,
      screenshotPath,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      route,
      status: 0,
      success: false,
      consoleErrors,
      pageErrors,
      error: `Navigation failed: ${msg}`,
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(smokeResult: QaSmokeTestResult): string {
  const parts: string[] = ["# QA Smoke Test Report\n"];

  if (!smokeResult.serverStarted) {
    parts.push(`**Server failed to start:** ${smokeResult.serverError ?? "Unknown error"}\n`);
    parts.push("No routes were tested.\n");
    return parts.join("\n");
  }

  const totalRoutes = smokeResult.routes.length;
  const passing = smokeResult.routes.filter((r) => r.success).length;
  const failing = totalRoutes - passing;

  parts.push(`**Routes tested:** ${totalRoutes}`);
  parts.push(`**Passing:** ${passing}`);
  parts.push(`**Failing:** ${failing}\n`);

  for (const result of smokeResult.routes) {
    const icon = result.success ? "PASS" : "FAIL";
    parts.push(`## [${icon}] ${result.route}\n`);
    parts.push(`- **Status:** ${result.status}`);

    if (result.consoleErrors.length > 0) {
      parts.push(`- **Console errors:** ${result.consoleErrors.length}`);
      for (const err of result.consoleErrors.slice(0, 5)) {
        parts.push(`  - \`${err}\``);
      }
    }

    if (result.pageErrors.length > 0) {
      parts.push(`- **Page errors:** ${result.pageErrors.length}`);
      for (const err of result.pageErrors.slice(0, 5)) {
        parts.push(`  - \`${err}\``);
      }
    }

    if (result.error) {
      parts.push(`- **Error:** ${result.error}`);
    }

    if (result.screenshotPath) {
      parts.push(`- **Screenshot:** ${path.basename(result.screenshotPath)}`);
    }

    parts.push("");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Convert smoke test results to review findings
// ---------------------------------------------------------------------------

function routeResultsToFindings(results: RouteResult[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const result of results) {
    if (result.success) continue;

    const issues: string[] = [];
    if (result.status === 0 && result.error) {
      issues.push(result.error);
    } else if (result.status >= 400) {
      issues.push(`HTTP ${result.status} response`);
    }
    if (result.consoleErrors.length > 0) {
      issues.push(
        `${result.consoleErrors.length} console error(s): ${result.consoleErrors.slice(0, 3).join("; ")}`,
      );
    }
    if (result.pageErrors.length > 0) {
      issues.push(
        `${result.pageErrors.length} page error(s): ${result.pageErrors.slice(0, 3).join("; ")}`,
      );
    }

    const severity: FindingSeverity =
      result.status === 0 || result.pageErrors.length > 0 ? "critical" : "high";

    findings.push({
      title: `Route ${result.route} failed QA smoke test`,
      severity,
      description: issues.join(". "),
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main agent
// ---------------------------------------------------------------------------

export interface QaSmokeTestOptions {
  /** Override the port for the dev server. Defaults to 3000. */
  port?: number;
  /** Override the dev command. */
  devCommand?: { cmd: string; args: string[] };
  /** Timeout in ms to wait for the dev server to start. Defaults to 30000. */
  startupTimeoutMs?: number;
  /** Navigation timeout in ms per route. Defaults to 15000. */
  navigationTimeoutMs?: number;
  /** Override route discovery. */
  routes?: string[];
  /** Custom browser launcher (for testing). */
  launchBrowser?: () => Promise<PlaywrightBrowserHandle>;
  /** Custom dev server starter (for testing). */
  startServer?: (projectDir: string) => Promise<DevServerHandle>;
  /** Custom route discoverer (for testing). */
  discoverRoutesFn?: (projectDir: string) => string[];
  /** Custom fetch function for server readiness check (for testing). */
  fetchFn?: typeof globalThis.fetch;
}

/**
 * Create a QA smoke test agent function that conforms to ReviewAgentFn.
 */
export function createQaSmokeTest(options: QaSmokeTestOptions = {}) {
  const {
    port = 3000,
    startupTimeoutMs = 30_000,
    navigationTimeoutMs = 15_000,
    launchBrowser = launchPlaywrightBrowser,
  } = options;

  return async function qaSmokeTest(context: ReviewContext): Promise<AgentResult> {
    const { projectDir, reviewDir } = context;

    const qaDir = path.join(reviewDir, "qa-smoke-test");
    fs.mkdirSync(qaDir, { recursive: true });

    // 1. Discover routes
    const routes = options.routes ?? (options.discoverRoutesFn ?? discoverRoutes)(projectDir);

    // 2. Start dev server
    let server: DevServerHandle | null = null;
    const smokeResult: QaSmokeTestResult = {
      routes: [],
      serverStarted: false,
    };

    try {
      if (options.startServer) {
        server = await options.startServer(projectDir);
      } else {
        server = await startDevServer(projectDir, {
          devCommand: options.devCommand,
          port,
          startupTimeoutMs,
          fetchFn: options.fetchFn,
        });
      }
      smokeResult.serverStarted = true;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      smokeResult.serverError = msg;

      // Server failed — report it and return
      const report = generateReport(smokeResult);
      fs.writeFileSync(path.join(qaDir, "results.md"), report, "utf-8");

      return {
        agent: "qa-smoke-test",
        success: false,
        report,
        findings: [
          {
            title: "Dev server failed to start",
            severity: "critical",
            description: `Could not start the dev server: ${msg}`,
          },
        ],
        blockingIssues: ["Dev server failed to start — cannot run QA smoke test"],
      };
    }

    // 3. Test routes in headless browser
    try {
      smokeResult.routes = await testRoutes({
        baseUrl: server.url,
        routes,
        screenshotDir: qaDir,
        navigationTimeoutMs,
        launchBrowser,
      });
    } finally {
      // Always kill the dev server
      server.kill();
    }

    // 4. Generate findings
    const findings = routeResultsToFindings(smokeResult.routes);
    const blockingIssues = findings
      .filter((f) => f.severity === "critical" || f.severity === "high")
      .map((f) => `[${f.severity}] ${f.title}`);

    // 5. Generate and save report
    const report = generateReport(smokeResult);
    fs.writeFileSync(path.join(qaDir, "results.md"), report, "utf-8");

    // 6. Determine success
    const allRoutesPassed = smokeResult.routes.every((r) => r.success);

    return {
      agent: "qa-smoke-test",
      success: allRoutesPassed,
      report,
      findings,
      blockingIssues,
    };
  };
}
