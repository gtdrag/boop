/**
 * Security header defaults for web projects.
 *
 * Generates framework-specific security header configuration
 * (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) and
 * error tracking setup based on the developer profile.
 */
import type {
  DeveloperProfile,
  FrontendFramework,
  BackendFramework,
  ErrorTracker,
} from "../../profile/schema.js";
import { isWebProject } from "./shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecurityHeaderFile {
  /** File path relative to the project root. */
  filepath: string;
  /** File content. */
  content: string;
}

export interface SecurityHeaderDeps {
  /** Dependencies to add to package.json. */
  dependencies: Record<string, string>;
  /** DevDependencies to add to package.json. */
  devDependencies: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Security headers — framework-specific
// ---------------------------------------------------------------------------

function buildNextHeaders(): SecurityHeaderFile {
  return {
    filepath: "next.config.headers.ts",
    content: `/**
 * Security headers for Next.js.
 *
 * Merge these into your next.config.ts \`headers()\` function:
 *
 *   import { securityHeaders } from "./next.config.headers";
 *   export default { async headers() { return securityHeaders; } };
 *
 * CSP includes 'unsafe-inline' for script-src and style-src because
 * Next.js injects inline scripts and styles at runtime. For stricter
 * CSP, implement nonce-based middleware and remove 'unsafe-inline'.
 */

export const securityHeaders = [
  {
    source: "/(.*)",
    headers: [
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https:",
          "font-src 'self'",
          "connect-src 'self' https:",
          "frame-ancestors 'none'",
        ].join("; "),
      },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ],
  },
];
`,
  };
}

function buildExpressHeaders(): SecurityHeaderFile {
  return {
    filepath: "src/middleware/security-headers.ts",
    content: `/**
 * Security headers middleware for Express.
 *
 * Adds CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
 * Referrer-Policy, and Permissions-Policy to every response.
 *
 * CSP includes 'unsafe-inline' for script-src and style-src because
 * most frontend frameworks inject inline scripts and styles. For
 * stricter CSP, implement nonce-based middleware and remove 'unsafe-inline'.
 *
 * Usage:
 *   import { securityHeaders } from "./middleware/security-headers";
 *   app.use(securityHeaders);
 */
import type { Request, Response, NextFunction } from "express";

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}
`,
  };
}

function buildGenericHeaders(): SecurityHeaderFile {
  return {
    filepath: "src/security/headers.ts",
    content: `/**
 * Security headers configuration.
 *
 * Provides a map of security headers and their values.
 * Integrate with your server framework's response pipeline.
 *
 * CSP includes 'unsafe-inline' for script-src and style-src because
 * most frontend frameworks inject inline scripts and styles. For
 * stricter CSP, implement nonce-based middleware and remove 'unsafe-inline'.
 */

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https:",
    "frame-ancestors 'none'",
  ].join("; "),
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Apply security headers to a Headers object (e.g. for fetch Response).
 */
export function applySecurityHeaders(headers: Headers): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
}
`,
  };
}

function buildSecurityHeadersConfig(
  frontend: FrontendFramework,
  backend: BackendFramework,
): SecurityHeaderFile {
  // Next.js has its own headers config system
  if (frontend === "next") return buildNextHeaders();

  // Express has middleware pattern
  if (backend === "express") return buildExpressHeaders();

  // Everything else gets a generic headers map
  return buildGenericHeaders();
}

// ---------------------------------------------------------------------------
// Error tracking
// ---------------------------------------------------------------------------

function buildSentry(framework: FrontendFramework): SecurityHeaderFile {
  if (framework === "next") {
    return {
      filepath: "src/lib/sentry.ts",
      content: `/**
 * Sentry error tracking for Next.js.
 *
 * Initialize in your instrumentation.ts or root layout.
 * Set NEXT_PUBLIC_SENTRY_DSN in your environment.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

export async function initSentry(): Promise<void> {
  if (!SENTRY_DSN) return;

  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1.0,
    environment: process.env.NODE_ENV,
  });
}
`,
    };
  }

  return {
    filepath: "src/lib/sentry.ts",
    content: `/**
 * Sentry error tracking initialization.
 *
 * Call initSentry() once at application startup.
 * Set SENTRY_DSN in your environment.
 */

const SENTRY_DSN = typeof process !== "undefined"
  ? process.env.SENTRY_DSN ?? ""
  : "";

export async function initSentry(): Promise<void> {
  if (!SENTRY_DSN) return;

  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1.0,
    environment: process.env.NODE_ENV,
  });
}
`,
  };
}

function buildBugsnag(framework: FrontendFramework): SecurityHeaderFile {
  if (framework === "next") {
    return {
      filepath: "src/lib/bugsnag.ts",
      content: `/**
 * Bugsnag error tracking for Next.js.
 *
 * Initialize in your instrumentation.ts or root layout.
 * Set NEXT_PUBLIC_BUGSNAG_API_KEY in your environment.
 */

const API_KEY = process.env.NEXT_PUBLIC_BUGSNAG_API_KEY ?? "";

export async function initBugsnag(): Promise<void> {
  if (!API_KEY) return;

  const Bugsnag = await import("@bugsnag/js");
  Bugsnag.default.start({ apiKey: API_KEY });
}
`,
    };
  }

  return {
    filepath: "src/lib/bugsnag.ts",
    content: `/**
 * Bugsnag error tracking initialization.
 *
 * Call initBugsnag() once at application startup.
 * Set BUGSNAG_API_KEY in your environment.
 */

const API_KEY = typeof process !== "undefined"
  ? process.env.BUGSNAG_API_KEY ?? ""
  : "";

export async function initBugsnag(): Promise<void> {
  if (!API_KEY) return;

  const Bugsnag = await import("@bugsnag/js");
  Bugsnag.default.start({ apiKey: API_KEY });
}
`,
  };
}

function buildErrorTracker(
  tracker: ErrorTracker,
  framework: FrontendFramework,
): SecurityHeaderFile | null {
  switch (tracker) {
    case "sentry":
      return buildSentry(framework);
    case "bugsnag":
      return buildBugsnag(framework);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Returns the npm dependencies needed for security/error tracking setup.
 */
export function getSecurityDeps(profile: DeveloperProfile): SecurityHeaderDeps {
  const deps: Record<string, string> = {};
  const devDeps: Record<string, string> = {};

  if (!isWebProject(profile)) {
    return { dependencies: deps, devDependencies: devDeps };
  }

  switch (profile.errorTracker) {
    case "sentry":
      if (profile.frontendFramework === "next") {
        deps["@sentry/nextjs"] = "^8.0.0";
      } else {
        deps["@sentry/node"] = "^8.0.0";
      }
      break;
    case "bugsnag":
      deps["@bugsnag/js"] = "^8.0.0";
      break;
  }

  return { dependencies: deps, devDependencies: devDeps };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate security header and error tracking default files.
 *
 * Returns an empty array if the project is not a web project
 * (frontendFramework === "none").
 *
 * Always generates 1 security headers file. Generates 1 error
 * tracking file when errorTracker is not "none". So returns
 * 1 or 2 files for web projects.
 */
export function generateSecurityHeaderDefaults(profile: DeveloperProfile): SecurityHeaderFile[] {
  if (!isWebProject(profile)) {
    return [];
  }

  const files: SecurityHeaderFile[] = [];

  // Security headers config
  files.push(buildSecurityHeadersConfig(profile.frontendFramework, profile.backendFramework));

  // Error tracking
  const errorFile = buildErrorTracker(profile.errorTracker, profile.frontendFramework);
  if (errorFile) {
    files.push(errorFile);
  }

  return files;
}
