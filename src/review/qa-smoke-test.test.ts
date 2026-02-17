import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createQaSmokeTest,
  discoverRoutes,
  detectDevCommand,
  testRoutes,
} from "./qa-smoke-test.js";
import type {
  DevServerHandle,
  PlaywrightBrowserHandle,
  PlaywrightPageHandle,
} from "./qa-smoke-test.js";
import type { ReviewContext } from "./team-orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-smoke-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

function makeMockPage(opts: {
  status?: number;
  consoleErrors?: string[];
  pageErrors?: string[];
  gotoError?: Error;
} = {}): PlaywrightPageHandle {
  const consoleHandlers: Array<(msg: string) => void> = [];
  const pageErrorHandlers: Array<(err: string) => void> = [];

  return {
    goto: async (_url: string, _options?: { timeout?: number; waitUntil?: string }) => {
      if (opts.gotoError) throw opts.gotoError;
      // Fire console errors
      for (const err of opts.consoleErrors ?? []) {
        for (const handler of consoleHandlers) handler(err);
      }
      // Fire page errors
      for (const err of opts.pageErrors ?? []) {
        for (const handler of pageErrorHandlers) handler(err);
      }
      return { status: () => opts.status ?? 200 };
    },
    screenshot: async (_options: { path: string; fullPage?: boolean }) => {
      // Write a fake screenshot file
      fs.writeFileSync(_options.path, "fake-png-data");
    },
    onConsoleError: (handler: (msg: string) => void) => {
      consoleHandlers.push(handler);
    },
    onPageError: (handler: (err: string) => void) => {
      pageErrorHandlers.push(handler);
    },
    close: async () => {},
  };
}

function makeMockBrowser(pageOverrides: Parameters<typeof makeMockPage>[0] = {}): PlaywrightBrowserHandle {
  return {
    newPage: async () => makeMockPage(pageOverrides),
    close: async () => {},
  };
}

function makeMockServer(url = "http://localhost:3000"): DevServerHandle {
  return {
    url,
    kill: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// discoverRoutes
// ---------------------------------------------------------------------------

describe("discoverRoutes", () => {
  it("returns ['/'] when no framework is detected", () => {
    const routes = discoverRoutes(tmpDir);
    expect(routes).toEqual(["/"]);
  });

  it("discovers Next.js pages directory routes", () => {
    writeFile("pages/index.tsx", "export default function Home() {}");
    writeFile("pages/about.tsx", "export default function About() {}");
    writeFile("pages/blog/index.tsx", "export default function Blog() {}");

    const routes = discoverRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).toContain("/about");
    expect(routes).toContain("/blog");
  });

  it("skips Next.js api routes", () => {
    writeFile("pages/index.tsx", "");
    writeFile("pages/api/hello.ts", "");

    const routes = discoverRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).not.toContain("/api/hello");
  });

  it("skips dynamic routes (bracket segments)", () => {
    writeFile("pages/index.tsx", "");
    writeFile("pages/[id].tsx", "");
    writeFile("pages/posts/[slug].tsx", "");

    const routes = discoverRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).not.toContain("/[id]");
  });

  it("discovers Next.js app directory routes", () => {
    writeFile("app/page.tsx", "");
    writeFile("app/about/page.tsx", "");
    writeFile("app/blog/page.tsx", "");

    const routes = discoverRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).toContain("/about");
    expect(routes).toContain("/blog");
  });

  it("handles Next.js app route groups (parenthesized dirs)", () => {
    writeFile("app/(marketing)/page.tsx", "");
    writeFile("app/(marketing)/pricing/page.tsx", "");

    const routes = discoverRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).toContain("/pricing");
  });

  it("discovers src/pages routes", () => {
    writeFile("src/pages/index.tsx", "");
    writeFile("src/pages/contact.tsx", "");

    const routes = discoverRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).toContain("/contact");
  });

  it("discovers src/app routes", () => {
    writeFile("src/app/page.tsx", "");
    writeFile("src/app/settings/page.tsx", "");

    const routes = discoverRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).toContain("/settings");
  });

  it("returns ['/'] for static index.html", () => {
    writeFile("public/index.html", "<html></html>");

    const routes = discoverRoutes(tmpDir);
    expect(routes).toEqual(["/"]);
  });

  it("skips non-page files in pages directory", () => {
    writeFile("pages/index.tsx", "");
    writeFile("pages/styles.css", "body {}");
    writeFile("pages/_app.tsx", "");
    writeFile("pages/_document.tsx", "");

    const routes = discoverRoutes(tmpDir);
    expect(routes).toEqual(["/"]);
  });
});

// ---------------------------------------------------------------------------
// detectDevCommand
// ---------------------------------------------------------------------------

describe("detectDevCommand", () => {
  it("returns null when no package.json exists", () => {
    expect(detectDevCommand(tmpDir)).toBeNull();
  });

  it("returns null when package.json has no scripts", () => {
    writeFile("package.json", JSON.stringify({ name: "test" }));
    expect(detectDevCommand(tmpDir)).toBeNull();
  });

  it("detects 'dev' script", () => {
    writeFile("package.json", JSON.stringify({ scripts: { dev: "next dev" } }));
    const cmd = detectDevCommand(tmpDir);
    expect(cmd).toEqual({ cmd: "npm", args: ["run", "dev"] });
  });

  it("detects 'start' script when no 'dev'", () => {
    writeFile("package.json", JSON.stringify({ scripts: { start: "node server.js" } }));
    const cmd = detectDevCommand(tmpDir);
    expect(cmd).toEqual({ cmd: "npm", args: ["run", "start"] });
  });

  it("detects 'serve' script when no 'dev' or 'start'", () => {
    writeFile("package.json", JSON.stringify({ scripts: { serve: "vite preview" } }));
    const cmd = detectDevCommand(tmpDir);
    expect(cmd).toEqual({ cmd: "npm", args: ["run", "serve"] });
  });

  it("prefers 'dev' over 'start' and 'serve'", () => {
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { dev: "vite", start: "node server.js", serve: "vite preview" } }),
    );
    const cmd = detectDevCommand(tmpDir);
    expect(cmd).toEqual({ cmd: "npm", args: ["run", "dev"] });
  });

  it("returns null when no matching scripts", () => {
    writeFile("package.json", JSON.stringify({ scripts: { build: "tsc", test: "vitest" } }));
    expect(detectDevCommand(tmpDir)).toBeNull();
  });

  it("handles malformed package.json gracefully", () => {
    writeFile("package.json", "not json");
    expect(detectDevCommand(tmpDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// testRoutes
// ---------------------------------------------------------------------------

describe("testRoutes", () => {
  it("reports success for routes with 200 status and no errors", async () => {
    const screenshotDir = path.join(tmpDir, "screenshots");

    const results = await testRoutes({
      baseUrl: "http://localhost:3000",
      routes: ["/", "/about"],
      screenshotDir,
      launchBrowser: async () => makeMockBrowser({ status: 200 }),
    });

    expect(results).toHaveLength(2);
    expect(results[0].route).toBe("/");
    expect(results[0].success).toBe(true);
    expect(results[0].status).toBe(200);
    expect(results[0].screenshotPath).toBeDefined();
    expect(results[1].route).toBe("/about");
    expect(results[1].success).toBe(true);
  });

  it("reports failure for routes with console errors", async () => {
    const screenshotDir = path.join(tmpDir, "screenshots");

    const results = await testRoutes({
      baseUrl: "http://localhost:3000",
      routes: ["/"],
      screenshotDir,
      launchBrowser: async () =>
        makeMockBrowser({ status: 200, consoleErrors: ["Uncaught TypeError: x is not a function"] }),
    });

    expect(results[0].success).toBe(false);
    expect(results[0].consoleErrors).toHaveLength(1);
    expect(results[0].consoleErrors[0]).toContain("TypeError");
  });

  it("reports failure for routes with page errors", async () => {
    const screenshotDir = path.join(tmpDir, "screenshots");

    const results = await testRoutes({
      baseUrl: "http://localhost:3000",
      routes: ["/"],
      screenshotDir,
      launchBrowser: async () =>
        makeMockBrowser({ status: 200, pageErrors: ["ReferenceError: foo is not defined"] }),
    });

    expect(results[0].success).toBe(false);
    expect(results[0].pageErrors).toHaveLength(1);
  });

  it("reports failure for non-200 status codes", async () => {
    const screenshotDir = path.join(tmpDir, "screenshots");

    const results = await testRoutes({
      baseUrl: "http://localhost:3000",
      routes: ["/missing"],
      screenshotDir,
      launchBrowser: async () => makeMockBrowser({ status: 404 }),
    });

    expect(results[0].success).toBe(false);
    expect(results[0].status).toBe(404);
  });

  it("handles navigation errors gracefully", async () => {
    const screenshotDir = path.join(tmpDir, "screenshots");

    const results = await testRoutes({
      baseUrl: "http://localhost:3000",
      routes: ["/"],
      screenshotDir,
      launchBrowser: async () =>
        makeMockBrowser({ gotoError: new Error("Navigation timeout exceeded") }),
    });

    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain("Navigation timeout exceeded");
  });

  it("handles browser launch failure", async () => {
    const screenshotDir = path.join(tmpDir, "screenshots");

    const results = await testRoutes({
      baseUrl: "http://localhost:3000",
      routes: ["/"],
      screenshotDir,
      launchBrowser: async () => {
        throw new Error("Chromium not installed");
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain("Browser launch failed");
  });

  it("creates screenshot directory if it does not exist", async () => {
    const screenshotDir = path.join(tmpDir, "nested", "dir", "screenshots");

    await testRoutes({
      baseUrl: "http://localhost:3000",
      routes: ["/"],
      screenshotDir,
      launchBrowser: async () => makeMockBrowser({ status: 200 }),
    });

    expect(fs.existsSync(screenshotDir)).toBe(true);
  });

  it("generates correct screenshot filenames", async () => {
    const screenshotDir = path.join(tmpDir, "screenshots");

    const results = await testRoutes({
      baseUrl: "http://localhost:3000",
      routes: ["/", "/about", "/blog/posts"],
      screenshotDir,
      launchBrowser: async () => makeMockBrowser({ status: 200 }),
    });

    expect(path.basename(results[0].screenshotPath!)).toBe("index.png");
    expect(path.basename(results[1].screenshotPath!)).toBe("about.png");
    expect(path.basename(results[2].screenshotPath!)).toBe("blog_posts.png");
  });

  it("treats 3xx status as success", async () => {
    const screenshotDir = path.join(tmpDir, "screenshots");

    const results = await testRoutes({
      baseUrl: "http://localhost:3000",
      routes: ["/old"],
      screenshotDir,
      launchBrowser: async () => makeMockBrowser({ status: 301 }),
    });

    expect(results[0].success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createQaSmokeTest (full agent)
// ---------------------------------------------------------------------------

describe("createQaSmokeTest", () => {
  it("returns success when all routes pass", async () => {
    const context = makeContext();
    const agent = createQaSmokeTest({
      routes: ["/", "/about"],
      startServer: async () => makeMockServer(),
      launchBrowser: async () => makeMockBrowser({ status: 200 }),
    });

    const result = await agent(context);

    expect(result.agent).toBe("qa-smoke-test");
    expect(result.success).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.blockingIssues).toHaveLength(0);
  });

  it("returns failure when server fails to start", async () => {
    const context = makeContext();
    const agent = createQaSmokeTest({
      routes: ["/"],
      startServer: async () => {
        throw new Error("Port 3000 in use");
      },
    });

    const result = await agent(context);

    expect(result.success).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("critical");
    expect(result.findings[0].title).toContain("Dev server failed to start");
    expect(result.blockingIssues).toHaveLength(1);
  });

  it("returns failure with findings when routes have console errors", async () => {
    const context = makeContext();
    const agent = createQaSmokeTest({
      routes: ["/"],
      startServer: async () => makeMockServer(),
      launchBrowser: async () =>
        makeMockBrowser({ status: 200, consoleErrors: ["Uncaught Error: kaboom"] }),
    });

    const result = await agent(context);

    expect(result.success).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("high");
    expect(result.findings[0].description).toContain("console error");
    expect(result.blockingIssues).toHaveLength(1);
  });

  it("returns failure with critical severity for page crashes", async () => {
    const context = makeContext();
    const agent = createQaSmokeTest({
      routes: ["/"],
      startServer: async () => makeMockServer(),
      launchBrowser: async () =>
        makeMockBrowser({ status: 200, pageErrors: ["ReferenceError: x is not defined"] }),
    });

    const result = await agent(context);

    expect(result.success).toBe(false);
    expect(result.findings[0].severity).toBe("critical");
  });

  it("kills the dev server after testing", async () => {
    const context = makeContext();
    const server = makeMockServer();
    const agent = createQaSmokeTest({
      routes: ["/"],
      startServer: async () => server,
      launchBrowser: async () => makeMockBrowser({ status: 200 }),
    });

    await agent(context);

    expect(server.kill).toHaveBeenCalledOnce();
  });

  it("kills the dev server even when browser testing fails", async () => {
    const context = makeContext();
    const server = makeMockServer();
    const agent = createQaSmokeTest({
      routes: ["/"],
      startServer: async () => server,
      launchBrowser: async () => {
        throw new Error("Chromium not found");
      },
    });

    const result = await agent(context);

    expect(server.kill).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
  });

  it("saves report to qa-smoke-test subdirectory", async () => {
    const context = makeContext();
    const agent = createQaSmokeTest({
      routes: ["/"],
      startServer: async () => makeMockServer(),
      launchBrowser: async () => makeMockBrowser({ status: 200 }),
    });

    await agent(context);

    const qaDir = path.join(context.reviewDir, "qa-smoke-test");
    expect(fs.existsSync(path.join(qaDir, "results.md"))).toBe(true);
  });

  it("report includes route status and screenshot references", async () => {
    const context = makeContext();
    const agent = createQaSmokeTest({
      routes: ["/", "/about"],
      startServer: async () => makeMockServer(),
      launchBrowser: async () => makeMockBrowser({ status: 200 }),
    });

    const result = await agent(context);

    expect(result.report).toContain("QA Smoke Test Report");
    expect(result.report).toContain("[PASS] /");
    expect(result.report).toContain("[PASS] /about");
    expect(result.report).toContain("Routes tested:** 2");
    expect(result.report).toContain("Passing:** 2");
  });

  it("report includes failure details", async () => {
    const context = makeContext();
    const agent = createQaSmokeTest({
      routes: ["/"],
      startServer: async () => makeMockServer(),
      launchBrowser: async () =>
        makeMockBrowser({ status: 500, consoleErrors: ["Internal server error"] }),
    });

    const result = await agent(context);

    expect(result.report).toContain("[FAIL] /");
    expect(result.report).toContain("Failing:** 1");
  });

  it("uses custom route discovery function", async () => {
    const context = makeContext();
    const customRoutes = ["/custom", "/routes"];
    const agent = createQaSmokeTest({
      startServer: async () => makeMockServer(),
      launchBrowser: async () => makeMockBrowser({ status: 200 }),
      discoverRoutesFn: () => customRoutes,
    });

    const result = await agent(context);

    expect(result.success).toBe(true);
    expect(result.report).toContain("/custom");
    expect(result.report).toContain("/routes");
  });

  it("routes option takes precedence over discovery", async () => {
    const context = makeContext();
    const agent = createQaSmokeTest({
      routes: ["/explicit"],
      startServer: async () => makeMockServer(),
      launchBrowser: async () => makeMockBrowser({ status: 200 }),
      discoverRoutesFn: () => ["/discovered"],
    });

    const result = await agent(context);

    expect(result.report).toContain("/explicit");
    expect(result.report).not.toContain("/discovered");
  });

  it("handles mixed passing and failing routes", async () => {
    const context = makeContext();
    let callCount = 0;

    const agent = createQaSmokeTest({
      routes: ["/ok", "/broken"],
      startServer: async () => makeMockServer(),
      launchBrowser: async () => ({
        newPage: async () => {
          callCount++;
          if (callCount === 1) {
            return makeMockPage({ status: 200 });
          }
          return makeMockPage({ status: 200, pageErrors: ["crash!"] });
        },
        close: async () => {},
      }),
    });

    const result = await agent(context);

    expect(result.success).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.report).toContain("[PASS] /ok");
    expect(result.report).toContain("[FAIL] /broken");
  });

  it("report shows server start failure details", async () => {
    const context = makeContext();
    const agent = createQaSmokeTest({
      routes: ["/"],
      startServer: async () => {
        throw new Error("EADDRINUSE: port 3000");
      },
    });

    const result = await agent(context);

    expect(result.report).toContain("Server failed to start");
    expect(result.report).toContain("EADDRINUSE");
    expect(result.report).toContain("No routes were tested");
  });

  it("creates qa-smoke-test directory", async () => {
    const context = makeContext();
    const agent = createQaSmokeTest({
      routes: ["/"],
      startServer: async () => makeMockServer(),
      launchBrowser: async () => makeMockBrowser({ status: 200 }),
    });

    await agent(context);

    const qaDir = path.join(context.reviewDir, "qa-smoke-test");
    expect(fs.existsSync(qaDir)).toBe(true);
  });
});
