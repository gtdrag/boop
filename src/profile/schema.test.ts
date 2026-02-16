import { describe, expect, it } from "vitest";
import type { DeveloperProfile, ProfileCategory } from "./schema.js";

describe("profile/schema", () => {
  it("DeveloperProfile covers all required categories", () => {
    const profile: DeveloperProfile = {
      name: "Alice",
      languages: ["typescript", "python"],
      frontendFramework: "next",
      backendFramework: "express",
      database: "postgresql",
      cloudProvider: "vercel",
      styling: "tailwind",
      stateManagement: "zustand",
      analytics: "posthog",
      ciCd: "github-actions",
      packageManager: "pnpm",
      testRunner: "vitest",
      linter: "oxlint",
      projectStructure: "monorepo",
      aiModel: "claude-opus-4-6",
      autonomousByDefault: false,
    };

    // Verify all categories from AC are present
    expect(profile.frontendFramework).toBe("next");
    expect(profile.backendFramework).toBe("express");
    expect(profile.database).toBe("postgresql");
    expect(profile.cloudProvider).toBe("vercel");
    expect(profile.styling).toBe("tailwind");
    expect(profile.stateManagement).toBe("zustand");
    expect(profile.analytics).toBe("posthog");
    expect(profile.ciCd).toBe("github-actions");
    expect(profile.languages).toEqual(["typescript", "python"]);
    expect(profile.projectStructure).toBe("monorepo");
    expect(profile.packageManager).toBe("pnpm");
    expect(profile.testRunner).toBe("vitest");
    expect(profile.linter).toBe("oxlint");
    expect(profile.aiModel).toBe("claude-opus-4-6");
    expect(profile.autonomousByDefault).toBe(false);
  });

  it("accepts custom string values for union types", () => {
    const profile: DeveloperProfile = {
      name: "Bob",
      languages: ["elixir"],
      frontendFramework: "phoenix-liveview",
      backendFramework: "phoenix",
      database: "cockroachdb",
      cloudProvider: "hetzner",
      styling: "sass",
      stateManagement: "custom-store",
      analytics: "amplitude",
      ciCd: "buildkite",
      packageManager: "npm",
      testRunner: "jest",
      linter: "eslint",
      projectStructure: "single-repo",
      aiModel: "gpt-5",
      autonomousByDefault: true,
    };

    expect(profile.frontendFramework).toBe("phoenix-liveview");
    expect(profile.database).toBe("cockroachdb");
    expect(profile.projectStructure).toBe("single-repo");
    expect(profile.autonomousByDefault).toBe(true);
  });

  it("ProfileCategory shape is valid", () => {
    const category: ProfileCategory = {
      key: "database",
      label: "Database",
      recommended: "postgresql",
      alternatives: ["mysql", "sqlite"],
    };

    expect(category.key).toBe("database");
    expect(category.recommended).toBe("postgresql");
    expect(category.alternatives).toContain("mysql");
  });

  it("ProfileCategory supports multi flag", () => {
    const category: ProfileCategory = {
      key: "languages",
      label: "Languages",
      recommended: "typescript",
      alternatives: ["python", "go"],
      multi: true,
    };

    expect(category.multi).toBe(true);
  });
});
