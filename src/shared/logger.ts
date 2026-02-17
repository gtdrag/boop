/**
 * Structured logger for Boop.
 *
 * Writes JSON log lines to ~/.boop/logs/ and human-readable output to console.
 * Log format: {ts, level, phase, epic, story, msg}
 * Console format: [phase] message
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { LogEntry, LogLevel } from "./types.js";
import { redactCredentials } from "../security/credentials.js";

/**
 * Redact sensitive values (API keys, tokens, passwords, secrets) from a string.
 *
 * Delegates to the shared redactCredentials() in security/credentials so that
 * detection and redaction patterns are defined in a single place.
 */
export function sanitize(input: string): string {
  return redactCredentials(input);
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

export interface LoggerContext {
  /** Pipeline phase (e.g. "BUILDING"). */
  phase: string;
  /** Epic identifier (e.g. "1"). */
  epic: string;
  /** Story identifier (e.g. "1.3"). */
  story: string;
}

export interface LoggerOptions {
  /** Minimum log level to emit. Defaults to "info". */
  level?: LogLevel;
  /** Directory for JSON log files. Defaults to ~/.boop/logs/. */
  logDir?: string;
  /** Whether to write to file. Defaults to true. */
  fileOutput?: boolean;
  /** Whether to write to console. Defaults to true. */
  consoleOutput?: boolean;
}

export class Logger {
  private readonly context: LoggerContext;
  private readonly minLevel: number;
  private readonly logDir: string;
  private readonly fileOutput: boolean;
  private readonly consoleOutput: boolean;
  private logFilePath: string | null = null;

  constructor(context: LoggerContext, options: LoggerOptions = {}) {
    this.context = context;
    this.minLevel = LOG_LEVEL_PRIORITY[options.level ?? "info"];
    this.logDir = options.logDir ?? path.join(os.homedir(), ".boop", "logs");
    this.fileOutput = options.fileOutput ?? true;
    this.consoleOutput = options.consoleOutput ?? true;
  }

  fatal(msg: string): void {
    this.log("fatal", msg);
  }

  error(msg: string): void {
    this.log("error", msg);
  }

  warn(msg: string): void {
    this.log("warn", msg);
  }

  info(msg: string): void {
    this.log("info", msg);
  }

  debug(msg: string): void {
    this.log("debug", msg);
  }

  trace(msg: string): void {
    this.log("trace", msg);
  }

  /** Create a child logger with an updated context. */
  child(overrides: Partial<LoggerContext>): Logger {
    return new Logger(
      { ...this.context, ...overrides },
      {
        level: this.levelName(),
        logDir: this.logDir,
        fileOutput: this.fileOutput,
        consoleOutput: this.consoleOutput,
      },
    );
  }

  private levelName(): LogLevel {
    for (const [name, priority] of Object.entries(LOG_LEVEL_PRIORITY)) {
      if (priority === this.minLevel) return name as LogLevel;
    }
    return "info";
  }

  private log(level: LogLevel, msg: string): void {
    if (LOG_LEVEL_PRIORITY[level] > this.minLevel) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      phase: this.context.phase,
      epic: this.context.epic,
      story: this.context.story,
      msg,
    };

    if (this.consoleOutput) {
      this.writeConsole(entry);
    }

    if (this.fileOutput) {
      this.writeFile(entry);
    }
  }

  private writeConsole(entry: LogEntry): void {
    const prefix = entry.phase ? `[${entry.phase}]` : "[boop]";
    const line = `${prefix} ${entry.msg}`;

    if (entry.level === "fatal" || entry.level === "error") {
      console.error(line);
    } else if (entry.level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  private writeFile(entry: LogEntry): void {
    try {
      if (!this.logFilePath) {
        fs.mkdirSync(this.logDir, { recursive: true });
        const date = new Date().toISOString().slice(0, 10);
        this.logFilePath = path.join(this.logDir, `boop-${date}.jsonl`);
      }
      // Sanitize the entry before writing to prevent credential leakage
      const sanitized: LogEntry = { ...entry, msg: sanitize(entry.msg) };
      fs.appendFileSync(this.logFilePath, JSON.stringify(sanitized) + "\n");
    } catch {
      // Silently drop file write errors — don't crash the pipeline over logging
    }
  }
}

/** Create a logger with default context. */
export function createLogger(
  context: Partial<LoggerContext> = {},
  options: LoggerOptions = {},
): Logger {
  return new Logger(
    {
      phase: context.phase ?? "",
      epic: context.epic ?? "",
      story: context.story ?? "",
    },
    options,
  );
}
