/**
 * Structured logging defaults for generated projects.
 *
 * Generates a lightweight, zero-dependency logger (`src/lib/logger.ts`)
 * that outputs human-readable lines to the console and JSON lines to
 * `logs/app.jsonl` for backend/full-stack projects. Frontend-only
 * projects get a console-only variant (no `node:fs` imports).
 */
import type { DeveloperProfile } from "../../profile/schema.js";
import type { GeneratedFile } from "./shared.js";

// ---------------------------------------------------------------------------
// Logger variants
// ---------------------------------------------------------------------------

function buildBackendLogger(): string {
  return `/**
 * Structured logger — zero dependencies.
 *
 * Usage:
 *   import { createLogger } from "./logger";
 *   const log = createLogger("my-module");
 *   log.info("server started", { port: 3000 });
 *
 * Console: HH:mm:ss.SSS [LEVEL] [module] message {data}
 * File:    JSON lines appended to logs/app.jsonl
 *
 * Env vars:
 *   LOG_LEVEL — minimum level: debug | info | warn | error (default: "info")
 *   LOG_FILE  — override path, or "false" to disable file output
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const MIN_LEVEL: LogLevel = (() => {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return env in LEVELS ? (env as LogLevel) : "info";
})();

const LOG_FILE: string | false = (() => {
  const env = process.env.LOG_FILE;
  if (env === "false") return false;
  return env ?? resolve("logs/app.jsonl");
})();

// Ensure log directory exists (once)
if (LOG_FILE) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
  } catch {
    // Silent — never crash the app over logging
  }
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function timestamp(): string {
  const d = new Date();
  return \`\${pad(d.getHours())}:\${pad(d.getMinutes())}:\${pad(d.getSeconds())}.\${pad(d.getMilliseconds(), 3)}\`;
}

function write(level: LogLevel, module: string, msg: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;

  // Console output — human-readable
  const tag = level.toUpperCase().padEnd(5);
  const suffix = data !== undefined ? \` \${JSON.stringify(data)}\` : "";
  const line = \`\${timestamp()} [\${tag}] [\${module}] \${msg}\${suffix}\`;

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  // File output — JSON lines
  if (LOG_FILE) {
    try {
      const entry = JSON.stringify({ ts: new Date().toISOString(), level, module, msg, ...(data !== undefined ? { data } : {}) });
      appendFileSync(LOG_FILE, entry + "\\n");
    } catch {
      // Silent — never crash the app over logging
    }
  }
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export function createLogger(module: string): Logger {
  return {
    debug: (msg, data) => write("debug", module, msg, data),
    info: (msg, data) => write("info", module, msg, data),
    warn: (msg, data) => write("warn", module, msg, data),
    error: (msg, data) => write("error", module, msg, data),
  };
}
`;
}

function buildFrontendLogger(): string {
  return `/**
 * Structured logger — console-only, zero dependencies.
 *
 * Usage:
 *   import { createLogger } from "./logger";
 *   const log = createLogger("my-component");
 *   log.info("mounted", { userId: 42 });
 *
 * Console: HH:mm:ss.SSS [LEVEL] [module] message {data}
 *
 * Env vars:
 *   LOG_LEVEL — minimum level: debug | info | warn | error (default: "info")
 */
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const MIN_LEVEL: LogLevel = (() => {
  const env = (typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined) ?? "info";
  return env.toLowerCase() in LEVELS ? (env.toLowerCase() as LogLevel) : "info";
})();

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function timestamp(): string {
  const d = new Date();
  return \`\${pad(d.getHours())}:\${pad(d.getMinutes())}:\${pad(d.getSeconds())}.\${pad(d.getMilliseconds(), 3)}\`;
}

function write(level: LogLevel, module: string, msg: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;

  const tag = level.toUpperCase().padEnd(5);
  const suffix = data !== undefined ? \` \${JSON.stringify(data)}\` : "";
  const line = \`\${timestamp()} [\${tag}] [\${module}] \${msg}\${suffix}\`;

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export function createLogger(module: string): Logger {
  return {
    debug: (msg, data) => write("debug", module, msg, data),
    info: (msg, data) => write("info", module, msg, data),
    warn: (msg, data) => write("warn", module, msg, data),
    error: (msg, data) => write("error", module, msg, data),
  };
}
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate structured logging defaults for a project.
 *
 * Returns a logger file at `src/lib/logger.ts`:
 * - Backend / full-stack: logger with console + JSON file output
 * - Frontend-only: console-only logger (no `node:fs` imports)
 * - Neither: empty array (no files generated)
 */
export function generateLoggingDefaults(profile: DeveloperProfile): GeneratedFile[] {
  const hasBackend = profile.backendFramework !== "none";
  const hasFrontend = profile.frontendFramework !== "none";

  if (!hasBackend && !hasFrontend) {
    return [];
  }

  // Full-stack projects (frontend + backend) must use the frontend-safe logger
  // because Next.js/webpack will bundle src/lib/logger.ts into client code
  // and choke on node:fs / node:path imports.
  const content = hasFrontend ? buildFrontendLogger() : buildBackendLogger();

  return [{ filepath: "src/lib/logger.ts", content }];
}
