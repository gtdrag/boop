import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Logger, createLogger } from "./logger.js";

describe("Logger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-logger-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes to console.log for info level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger(
      { phase: "BUILDING", epic: "1", story: "1.3" },
      { fileOutput: false },
    );
    logger.info("test message");
    expect(spy).toHaveBeenCalledWith("[BUILDING] test message");
    spy.mockRestore();
  });

  it("writes to console.error for error level", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new Logger(
      { phase: "REVIEWING", epic: "1", story: "1.5" },
      { fileOutput: false },
    );
    logger.error("something broke");
    expect(spy).toHaveBeenCalledWith("[REVIEWING] something broke");
    spy.mockRestore();
  });

  it("writes to console.warn for warn level", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = new Logger(
      { phase: "PLANNING", epic: "1", story: "1.1" },
      { fileOutput: false },
    );
    logger.warn("careful");
    expect(spy).toHaveBeenCalledWith("[PLANNING] careful");
    spy.mockRestore();
  });

  it("uses [boop] prefix when phase is empty", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger({ phase: "", epic: "", story: "" }, { fileOutput: false });
    logger.info("no phase");
    expect(spy).toHaveBeenCalledWith("[boop] no phase");
    spy.mockRestore();
  });

  it("respects minimum log level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger(
      { phase: "BUILDING", epic: "1", story: "1.3" },
      { level: "warn", fileOutput: false },
    );
    logger.info("should be suppressed");
    logger.debug("also suppressed");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("writes JSON lines to log file", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger(
      { phase: "BUILDING", epic: "1", story: "1.3" },
      { logDir: tmpDir, consoleOutput: false },
    );
    logger.info("file test");

    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^boop-\d{4}-\d{2}-\d{2}\.jsonl$/);

    const content = fs.readFileSync(path.join(tmpDir, files[0]!), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.level).toBe("info");
    expect(entry.phase).toBe("BUILDING");
    expect(entry.epic).toBe("1");
    expect(entry.story).toBe("1.3");
    expect(entry.msg).toBe("file test");
    expect(entry.ts).toBeDefined();
    logSpy.mockRestore();
  });

  it("appends multiple entries to the same log file", () => {
    const logger = new Logger(
      { phase: "BUILDING", epic: "1", story: "1.3" },
      { logDir: tmpDir, consoleOutput: false },
    );
    logger.info("first");
    logger.info("second");
    logger.warn("third");

    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);

    const lines = fs.readFileSync(path.join(tmpDir, files[0]!), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  it("child() creates a logger with overridden context", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const parent = new Logger(
      { phase: "BUILDING", epic: "1", story: "1.3" },
      { fileOutput: false },
    );
    const child = parent.child({ story: "1.4", phase: "REVIEWING" });
    child.info("child message");
    expect(spy).toHaveBeenCalledWith("[REVIEWING] child message");
    spy.mockRestore();
  });

  it("fatal() writes to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new Logger(
      { phase: "BUILDING", epic: "1", story: "1.3" },
      { fileOutput: false },
    );
    logger.fatal("crash");
    expect(spy).toHaveBeenCalledWith("[BUILDING] crash");
    spy.mockRestore();
  });
});

describe("createLogger", () => {
  it("creates a logger with defaults", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger({}, { fileOutput: false });
    logger.info("default logger");
    expect(spy).toHaveBeenCalledWith("[boop] default logger");
    spy.mockRestore();
  });

  it("creates a logger with partial context", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger({ phase: "PLANNING" }, { fileOutput: false });
    logger.info("partial context");
    expect(spy).toHaveBeenCalledWith("[PLANNING] partial context");
    spy.mockRestore();
  });
});
