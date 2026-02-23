import { describe, expect, it } from "vitest";
import type { DeveloperProfile } from "../profile/schema.js";
import { resolveModel } from "./model-router.js";

const BASE_PROFILE: DeveloperProfile = {
  name: "Test Dev",
  languages: ["typescript"],
  frontendFramework: "next",
  backendFramework: "express",
  database: "postgresql",
  cloudProvider: "vercel",
  styling: "tailwind",
  stateManagement: "zustand",
  analytics: "posthog",
  ciCd: "github-actions",
  sourceControl: "github",
  packageManager: "pnpm",
  testRunner: "vitest",
  linter: "oxlint",
  projectStructure: "monorepo",
  errorTracker: "sentry",
  aiModel: "claude-opus-4-6",
  autonomousByDefault: false,
};

describe("resolveModel", () => {
  it("returns Sonnet for planning by default", () => {
    expect(resolveModel("planning", BASE_PROFILE)).toBe("claude-sonnet-4-5-20250929");
  });

  it("returns Opus for building by default", () => {
    expect(resolveModel("building", BASE_PROFILE)).toBe("claude-opus-4-6");
  });

  it("returns Sonnet for review by default", () => {
    expect(resolveModel("review", BASE_PROFILE)).toBe("claude-sonnet-4-5-20250929");
  });

  it("returns Sonnet for retrospective by default", () => {
    expect(resolveModel("retrospective", BASE_PROFILE)).toBe("claude-sonnet-4-5-20250929");
  });

  it("uses per-phase override when set", () => {
    const profile: DeveloperProfile = {
      ...BASE_PROFILE,
      modelOverrides: { planning: "claude-opus-4-6" },
    };
    expect(resolveModel("planning", profile)).toBe("claude-opus-4-6");
  });

  it("override wins over smart default", () => {
    const profile: DeveloperProfile = {
      ...BASE_PROFILE,
      modelOverrides: { review: "claude-haiku-4-5-20251001" },
    };
    expect(resolveModel("review", profile)).toBe("claude-haiku-4-5-20251001");
  });

  it("smart default wins over global aiModel", () => {
    const profile: DeveloperProfile = {
      ...BASE_PROFILE,
      aiModel: "claude-opus-4-6",
    };
    // planning smart default is Sonnet, not the global Opus
    expect(resolveModel("planning", profile)).toBe("claude-sonnet-4-5-20250929");
  });

  it("phases without override use smart defaults", () => {
    const profile: DeveloperProfile = {
      ...BASE_PROFILE,
      modelOverrides: { building: "custom-model" },
    };
    // planning has no override, should use smart default
    expect(resolveModel("planning", profile)).toBe("claude-sonnet-4-5-20250929");
    // building has override
    expect(resolveModel("building", profile)).toBe("custom-model");
  });
});
