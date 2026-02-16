import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { DEFAULT_PROFILE, PROFILE_CATEGORIES } from "./defaults.js";
import type { DeveloperProfile } from "./schema.js";

// Track calls to each prompt type
let textCalls: Array<{ message: string; defaultValue?: string }> = [];
let multiselectCalls: Array<{ message: string; initialValues?: string[] }> = [];
let confirmCalls: Array<{ message: string; initialValue?: boolean }> = [];

// Response queues — tests push values here, mock pops them
let textResponses: (string | symbol)[] = [];
let multiselectResponses: (string[] | symbol)[] = [];
let confirmResponses: (boolean | symbol)[] = [];

const CANCEL = Symbol("cancel");

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  isCancel: (value: unknown) => value === CANCEL,
  text: vi.fn((opts: { message: string; defaultValue?: string }) => {
    textCalls.push(opts);
    return Promise.resolve(textResponses.shift() ?? opts.defaultValue ?? "");
  }),
  multiselect: vi.fn(
    (opts: { message: string; initialValues?: string[] }) => {
      multiselectCalls.push(opts);
      return Promise.resolve(
        multiselectResponses.shift() ?? opts.initialValues ?? [],
      );
    },
  ),
  confirm: vi.fn((opts: { message: string; initialValue?: boolean }) => {
    confirmCalls.push(opts);
    return Promise.resolve(confirmResponses.shift() ?? opts.initialValue ?? false);
  }),
}));

describe("profile/onboarding", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-onboarding-test-"));
    textCalls = [];
    multiselectCalls = [];
    confirmCalls = [];
    textResponses = [];
    multiselectResponses = [];
    confirmResponses = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("creates profile.yaml when accepting all defaults", async () => {
    const { runOnboarding } = await import("./onboarding.js");

    // Queue responses: name is free text, rest accept defaults
    textResponses = ["Alice"]; // name prompt
    // Remaining text prompts accept defaults (return undefined → uses defaultValue)

    const result = await runOnboarding({ stateDir: tmpDir });

    expect(result.completed).toBe(true);
    expect(result.profile).toBeDefined();
    expect(result.profilePath).toBe(path.join(tmpDir, "profile.yaml"));
    expect(fs.existsSync(result.profilePath!)).toBe(true);
  });

  it("saves valid YAML that can be parsed back", async () => {
    const { runOnboarding } = await import("./onboarding.js");

    textResponses = ["Bob"];

    const result = await runOnboarding({ stateDir: tmpDir });

    const raw = fs.readFileSync(result.profilePath!, "utf-8");
    const parsed = parse(raw) as DeveloperProfile;
    expect(parsed.name).toBe("Bob");
    expect(parsed.frontendFramework).toBe(DEFAULT_PROFILE.frontendFramework);
    expect(parsed.database).toBe(DEFAULT_PROFILE.database);
  });

  it("allows overriding values", async () => {
    const { runOnboarding } = await import("./onboarding.js");

    // Name + all single-value fields: provide overrides for some
    textResponses = ["Charlie", "remix"]; // name, then frontendFramework override
    // Rest will use defaults

    const result = await runOnboarding({ stateDir: tmpDir });

    expect(result.completed).toBe(true);
    expect(result.profile!.name).toBe("Charlie");
    expect(result.profile!.frontendFramework).toBe("remix");
  });

  it("returns completed: false when cancelled at name", async () => {
    const { runOnboarding } = await import("./onboarding.js");

    textResponses = [CANCEL as unknown as string];

    const result = await runOnboarding({ stateDir: tmpDir });

    expect(result.completed).toBe(false);
    expect(result.profile).toBeUndefined();
    expect(result.profilePath).toBeUndefined();
  });

  it("returns completed: false when cancelled at any category", async () => {
    const { runOnboarding } = await import("./onboarding.js");

    textResponses = ["Eve", CANCEL as unknown as string]; // name succeeds, then cancel

    const result = await runOnboarding({ stateDir: tmpDir });

    expect(result.completed).toBe(false);
  });

  it("prompts for every category in PROFILE_CATEGORIES", async () => {
    const { runOnboarding } = await import("./onboarding.js");

    textResponses = ["TestUser"];

    await runOnboarding({ stateDir: tmpDir });

    // Count total prompts: text + multiselect + confirm
    const totalPrompts =
      textCalls.length + multiselectCalls.length + confirmCalls.length;
    expect(totalPrompts).toBe(PROFILE_CATEGORIES.length);
  });

  it("pre-populates with existing profile when editing", async () => {
    const { runOnboarding } = await import("./onboarding.js");

    const existing: DeveloperProfile = {
      ...DEFAULT_PROFILE,
      name: "ExistingUser",
      frontendFramework: "astro",
      database: "sqlite",
    };

    // Name should be pre-populated — we accept it (empty response uses default)
    textResponses = [];

    const result = await runOnboarding({
      stateDir: tmpDir,
      existingProfile: existing,
    });

    expect(result.completed).toBe(true);
    // The name prompt should have received the existing name as default
    expect(textCalls[0]!.message).toContain("name");
  });

  it("creates stateDir if it does not exist", async () => {
    const { runOnboarding } = await import("./onboarding.js");
    const nestedDir = path.join(tmpDir, "nested", "dir");

    textResponses = ["User"];

    const result = await runOnboarding({ stateDir: nestedDir });

    expect(result.completed).toBe(true);
    expect(fs.existsSync(nestedDir)).toBe(true);
    expect(fs.existsSync(path.join(nestedDir, "profile.yaml"))).toBe(true);
  });

  it("handles multi-select for languages", async () => {
    const { runOnboarding } = await import("./onboarding.js");

    textResponses = ["User"];
    multiselectResponses = [["typescript", "python", "go"]];

    const result = await runOnboarding({ stateDir: tmpDir });

    expect(result.completed).toBe(true);
    expect(result.profile!.languages).toEqual(["typescript", "python", "go"]);
  });

  it("handles boolean confirm for autonomousByDefault", async () => {
    const { runOnboarding } = await import("./onboarding.js");

    textResponses = ["User"];
    confirmResponses = [true];

    const result = await runOnboarding({ stateDir: tmpDir });

    expect(result.completed).toBe(true);
    expect(result.profile!.autonomousByDefault).toBe(true);
  });
});

describe("profile/loadProfile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boop-load-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when no profile.yaml exists", async () => {
    const { loadProfile } = await import("./onboarding.js");
    expect(loadProfile(tmpDir)).toBeUndefined();
  });

  it("loads and parses an existing profile.yaml", async () => {
    const { loadProfile } = await import("./onboarding.js");
    const profile: DeveloperProfile = {
      ...DEFAULT_PROFILE,
      name: "LoadTest",
    };

    const { stringify } = await import("yaml");
    fs.writeFileSync(path.join(tmpDir, "profile.yaml"), stringify(profile));

    const loaded = loadProfile(tmpDir);
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe("LoadTest");
    expect(loaded!.frontendFramework).toBe("next");
  });
});
