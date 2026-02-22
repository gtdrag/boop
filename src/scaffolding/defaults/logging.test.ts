import { describe, expect, it } from "vitest";
import type { DeveloperProfile } from "../../profile/schema.js";
import { DEFAULT_PROFILE } from "../../profile/defaults.js";
import { generateLoggingDefaults } from "./logging.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<DeveloperProfile> = {}): DeveloperProfile {
  return { ...DEFAULT_PROFILE, name: "Test Dev", ...overrides };
}

// ---------------------------------------------------------------------------
// Backend / full-stack projects
// ---------------------------------------------------------------------------

describe("backend project", () => {
  it("generates logger with node:fs import and createLogger", () => {
    const profile = makeProfile({ backendFramework: "express", frontendFramework: "none" });
    const files = generateLoggingDefaults(profile);

    expect(files).toHaveLength(1);
    expect(files[0]!.filepath).toBe("src/lib/logger.ts");
    expect(files[0]!.content).toContain("node:fs");
    expect(files[0]!.content).toContain("createLogger");
    expect(files[0]!.content).toContain("logs/app.jsonl");
  });

  it("includes LOG_LEVEL and LOG_FILE env var handling", () => {
    const profile = makeProfile({ backendFramework: "express", frontendFramework: "none" });
    const files = generateLoggingDefaults(profile);

    expect(files[0]!.content).toContain("LOG_LEVEL");
    expect(files[0]!.content).toContain("LOG_FILE");
  });
});

// ---------------------------------------------------------------------------
// Full-stack projects (has both frontend + backend)
// ---------------------------------------------------------------------------

describe("full-stack project", () => {
  it("generates frontend-safe logger (no node: imports that break webpack)", () => {
    const profile = makeProfile({ backendFramework: "express", frontendFramework: "next" });
    const files = generateLoggingDefaults(profile);

    expect(files).toHaveLength(1);
    expect(files[0]!.filepath).toBe("src/lib/logger.ts");
    expect(files[0]!.content).not.toContain("node:fs");
    expect(files[0]!.content).not.toContain("appendFileSync");
    expect(files[0]!.content).toContain("createLogger");
  });
});

// ---------------------------------------------------------------------------
// Frontend-only projects
// ---------------------------------------------------------------------------

describe("frontend-only project", () => {
  it("generates console-only logger without fs imports", () => {
    const profile = makeProfile({ frontendFramework: "next", backendFramework: "none" });
    const files = generateLoggingDefaults(profile);

    expect(files).toHaveLength(1);
    expect(files[0]!.filepath).toBe("src/lib/logger.ts");
    expect(files[0]!.content).toContain("createLogger");
    expect(files[0]!.content).not.toContain("node:fs");
    expect(files[0]!.content).not.toContain("appendFileSync");
  });

  it("includes LOG_LEVEL env var handling", () => {
    const profile = makeProfile({ frontendFramework: "vite-react", backendFramework: "none" });
    const files = generateLoggingDefaults(profile);

    expect(files[0]!.content).toContain("LOG_LEVEL");
  });
});

// ---------------------------------------------------------------------------
// Non-project (both frameworks "none")
// ---------------------------------------------------------------------------

describe("non-project", () => {
  it("returns empty array when both frameworks are none", () => {
    const profile = makeProfile({ frontendFramework: "none", backendFramework: "none" });
    const files = generateLoggingDefaults(profile);

    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Logger content details
// ---------------------------------------------------------------------------

describe("logger content", () => {
  it("backend logger exports Logger interface", () => {
    const profile = makeProfile({ backendFramework: "express", frontendFramework: "none" });
    const files = generateLoggingDefaults(profile);

    expect(files[0]!.content).toContain("export interface Logger");
    expect(files[0]!.content).toContain("export function createLogger");
  });

  it("frontend logger exports Logger interface", () => {
    const profile = makeProfile({ frontendFramework: "next", backendFramework: "none" });
    const files = generateLoggingDefaults(profile);

    expect(files[0]!.content).toContain("export interface Logger");
    expect(files[0]!.content).toContain("export function createLogger");
  });

  it("backend logger has all four log methods", () => {
    const profile = makeProfile({ backendFramework: "express", frontendFramework: "none" });
    const files = generateLoggingDefaults(profile);
    const content = files[0]!.content;

    expect(content).toContain("debug:");
    expect(content).toContain("info:");
    expect(content).toContain("warn:");
    expect(content).toContain("error:");
  });
});
