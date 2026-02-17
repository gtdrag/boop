import { describe, expect, it } from "vitest";
import type { DeveloperProfile } from "../../profile/schema.js";
import { DEFAULT_PROFILE } from "../../profile/defaults.js";
import { generateSecurityHeaderDefaults, getSecurityDeps } from "./security-headers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<DeveloperProfile> = {}): DeveloperProfile {
  return { ...DEFAULT_PROFILE, name: "Test Dev", ...overrides };
}

function findFile(files: { filepath: string }[], partial: string) {
  return files.find((f) => f.filepath.includes(partial));
}

// ---------------------------------------------------------------------------
// Non-web projects
// ---------------------------------------------------------------------------

describe("non-web projects", () => {
  it("returns empty array when frontendFramework is none", () => {
    const profile = makeProfile({ frontendFramework: "none" });
    const files = generateSecurityHeaderDefaults(profile);
    expect(files).toEqual([]);
  });

  it("returns empty deps when frontendFramework is none", () => {
    const profile = makeProfile({ frontendFramework: "none" });
    const deps = getSecurityDeps(profile);
    expect(deps.dependencies).toEqual({});
    expect(deps.devDependencies).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Security headers — Next.js
// ---------------------------------------------------------------------------

describe("security headers for Next.js", () => {
  it("generates a next.config.headers.ts file", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateSecurityHeaderDefaults(profile);
    const headers = findFile(files, "next.config.headers");

    expect(headers).toBeDefined();
    expect(headers!.filepath).toBe("next.config.headers.ts");
    expect(headers!.content).toContain("Content-Security-Policy");
    expect(headers!.content).toContain("Strict-Transport-Security");
    expect(headers!.content).toContain("X-Frame-Options");
    expect(headers!.content).toContain("X-Content-Type-Options");
    expect(headers!.content).toContain("Referrer-Policy");
    expect(headers!.content).toContain("Permissions-Policy");
  });

  it("uses Next.js headers array format", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateSecurityHeaderDefaults(profile);
    const headers = findFile(files, "next.config.headers");

    expect(headers!.content).toContain("securityHeaders");
    expect(headers!.content).toContain("source");
    expect(headers!.content).toContain("/(.*");
  });
});

// ---------------------------------------------------------------------------
// Security headers — Express
// ---------------------------------------------------------------------------

describe("security headers for Express", () => {
  it("generates Express middleware when backend is express", () => {
    const profile = makeProfile({
      frontendFramework: "vite-react",
      backendFramework: "express",
    });
    const files = generateSecurityHeaderDefaults(profile);
    const headers = findFile(files, "security-headers");

    expect(headers).toBeDefined();
    expect(headers!.filepath).toBe("src/middleware/security-headers.ts");
    expect(headers!.content).toContain("securityHeaders");
    expect(headers!.content).toContain("res.setHeader");
    expect(headers!.content).toContain("Content-Security-Policy");
    expect(headers!.content).toContain("next()");
  });
});

// ---------------------------------------------------------------------------
// Security headers — Generic
// ---------------------------------------------------------------------------

describe("security headers for generic projects", () => {
  it("generates generic headers map for non-Next, non-Express projects", () => {
    const profile = makeProfile({
      frontendFramework: "astro",
      backendFramework: "none",
    });
    const files = generateSecurityHeaderDefaults(profile);
    const headers = findFile(files, "headers");

    expect(headers).toBeDefined();
    expect(headers!.filepath).toBe("src/security/headers.ts");
    expect(headers!.content).toContain("SECURITY_HEADERS");
    expect(headers!.content).toContain("applySecurityHeaders");
    expect(headers!.content).toContain("Content-Security-Policy");
    expect(headers!.content).toContain("Strict-Transport-Security");
    expect(headers!.content).toContain("X-Frame-Options");
    expect(headers!.content).toContain("X-Content-Type-Options");
  });

  it("generates generic headers for SvelteKit", () => {
    const profile = makeProfile({
      frontendFramework: "sveltekit",
      backendFramework: "fastify",
    });
    const files = generateSecurityHeaderDefaults(profile);
    const headers = files[0];

    // SvelteKit is not "next" and fastify is not "express", so generic
    expect(headers!.filepath).toBe("src/security/headers.ts");
  });
});

// ---------------------------------------------------------------------------
// All header types include required headers
// ---------------------------------------------------------------------------

describe("all header configs include required headers", () => {
  const requiredHeaders = [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Frame-Options",
    "X-Content-Type-Options",
  ];

  it("Next.js config includes all required headers", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateSecurityHeaderDefaults(profile);
    const content = files[0]!.content;
    for (const h of requiredHeaders) {
      expect(content).toContain(h);
    }
  });

  it("Express middleware includes all required headers", () => {
    const profile = makeProfile({
      frontendFramework: "vite-react",
      backendFramework: "express",
    });
    const files = generateSecurityHeaderDefaults(profile);
    const content = files[0]!.content;
    for (const h of requiredHeaders) {
      expect(content).toContain(h);
    }
  });

  it("Generic config includes all required headers", () => {
    const profile = makeProfile({
      frontendFramework: "astro",
      backendFramework: "none",
    });
    const files = generateSecurityHeaderDefaults(profile);
    const content = files[0]!.content;
    for (const h of requiredHeaders) {
      expect(content).toContain(h);
    }
  });
});

// ---------------------------------------------------------------------------
// Error tracking — Sentry
// ---------------------------------------------------------------------------

describe("Sentry error tracking", () => {
  it("generates Next.js Sentry init for Next.js projects", () => {
    const profile = makeProfile({ frontendFramework: "next", errorTracker: "sentry" });
    const files = generateSecurityHeaderDefaults(profile);
    const sentry = findFile(files, "sentry");

    expect(sentry).toBeDefined();
    expect(sentry!.filepath).toBe("src/lib/sentry.ts");
    expect(sentry!.content).toContain("@sentry/nextjs");
    expect(sentry!.content).toContain("NEXT_PUBLIC_SENTRY_DSN");
    expect(sentry!.content).toContain("initSentry");
  });

  it("generates generic Sentry init for non-Next projects", () => {
    const profile = makeProfile({ frontendFramework: "vite-react", errorTracker: "sentry" });
    const files = generateSecurityHeaderDefaults(profile);
    const sentry = findFile(files, "sentry");

    expect(sentry).toBeDefined();
    expect(sentry!.filepath).toBe("src/lib/sentry.ts");
    expect(sentry!.content).toContain("@sentry/node");
    expect(sentry!.content).toContain("SENTRY_DSN");
    expect(sentry!.content).toContain("initSentry");
  });

  it("adds @sentry/nextjs dep for Next.js", () => {
    const profile = makeProfile({ frontendFramework: "next", errorTracker: "sentry" });
    const deps = getSecurityDeps(profile);
    expect(deps.dependencies["@sentry/nextjs"]).toBeTruthy();
  });

  it("adds @sentry/node dep for non-Next", () => {
    const profile = makeProfile({ frontendFramework: "vite-react", errorTracker: "sentry" });
    const deps = getSecurityDeps(profile);
    expect(deps.dependencies["@sentry/node"]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Error tracking — Bugsnag
// ---------------------------------------------------------------------------

describe("Bugsnag error tracking", () => {
  it("generates Next.js Bugsnag init for Next.js projects", () => {
    const profile = makeProfile({ frontendFramework: "next", errorTracker: "bugsnag" });
    const files = generateSecurityHeaderDefaults(profile);
    const bugsnag = findFile(files, "bugsnag");

    expect(bugsnag).toBeDefined();
    expect(bugsnag!.filepath).toBe("src/lib/bugsnag.ts");
    expect(bugsnag!.content).toContain("@bugsnag/js");
    expect(bugsnag!.content).toContain("NEXT_PUBLIC_BUGSNAG_API_KEY");
    expect(bugsnag!.content).toContain("initBugsnag");
  });

  it("generates generic Bugsnag init for non-Next projects", () => {
    const profile = makeProfile({ frontendFramework: "astro", errorTracker: "bugsnag" });
    const files = generateSecurityHeaderDefaults(profile);
    const bugsnag = findFile(files, "bugsnag");

    expect(bugsnag).toBeDefined();
    expect(bugsnag!.filepath).toBe("src/lib/bugsnag.ts");
    expect(bugsnag!.content).toContain("@bugsnag/js");
    expect(bugsnag!.content).toContain("BUGSNAG_API_KEY");
    expect(bugsnag!.content).toContain("initBugsnag");
  });

  it("adds @bugsnag/js dep", () => {
    const profile = makeProfile({ frontendFramework: "next", errorTracker: "bugsnag" });
    const deps = getSecurityDeps(profile);
    expect(deps.dependencies["@bugsnag/js"]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Error tracking — none
// ---------------------------------------------------------------------------

describe("error tracking: none", () => {
  it("does not generate an error tracking file", () => {
    const profile = makeProfile({ frontendFramework: "next", errorTracker: "none" });
    const files = generateSecurityHeaderDefaults(profile);

    expect(files).toHaveLength(1); // Only headers file
    const sentry = findFile(files, "sentry");
    const bugsnag = findFile(files, "bugsnag");
    expect(sentry).toBeUndefined();
    expect(bugsnag).toBeUndefined();
  });

  it("returns empty deps when errorTracker is none", () => {
    const profile = makeProfile({ frontendFramework: "next", errorTracker: "none" });
    const deps = getSecurityDeps(profile);
    expect(deps.dependencies).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// File count
// ---------------------------------------------------------------------------

describe("file count", () => {
  it("generates 2 files for web project with error tracker (headers + tracker)", () => {
    const profile = makeProfile({ frontendFramework: "next", errorTracker: "sentry" });
    const files = generateSecurityHeaderDefaults(profile);
    expect(files).toHaveLength(2);
  });

  it("generates 1 file for web project with errorTracker none (headers only)", () => {
    const profile = makeProfile({ frontendFramework: "next", errorTracker: "none" });
    const files = generateSecurityHeaderDefaults(profile);
    expect(files).toHaveLength(1);
  });

  it("generates 0 files for non-web project", () => {
    const profile = makeProfile({ frontendFramework: "none" });
    const files = generateSecurityHeaderDefaults(profile);
    expect(files).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

describe("getSecurityDeps", () => {
  it("returns empty for non-web projects", () => {
    const profile = makeProfile({ frontendFramework: "none", errorTracker: "sentry" });
    const deps = getSecurityDeps(profile);
    expect(deps.dependencies).toEqual({});
  });

  it("returns empty for errorTracker none", () => {
    const profile = makeProfile({ frontendFramework: "next", errorTracker: "none" });
    const deps = getSecurityDeps(profile);
    expect(deps.dependencies).toEqual({});
    expect(deps.devDependencies).toEqual({});
  });
});
