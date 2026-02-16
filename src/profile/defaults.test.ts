import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, PROFILE_CATEGORIES } from "./defaults.js";
import type { DeveloperProfile, ProfileCategory } from "./schema.js";

describe("profile/defaults", () => {
  describe("DEFAULT_PROFILE", () => {
    it("has a value for every DeveloperProfile field", () => {
      const keys: (keyof DeveloperProfile)[] = [
        "name",
        "languages",
        "frontendFramework",
        "backendFramework",
        "database",
        "cloudProvider",
        "styling",
        "stateManagement",
        "analytics",
        "ciCd",
        "packageManager",
        "testRunner",
        "linter",
        "projectStructure",
        "aiModel",
        "autonomousByDefault",
      ];

      for (const key of keys) {
        expect(DEFAULT_PROFILE).toHaveProperty(key);
      }
    });

    it("uses practical modern defaults", () => {
      expect(DEFAULT_PROFILE.frontendFramework).toBe("next");
      expect(DEFAULT_PROFILE.backendFramework).toBe("express");
      expect(DEFAULT_PROFILE.database).toBe("postgresql");
      expect(DEFAULT_PROFILE.cloudProvider).toBe("vercel");
      expect(DEFAULT_PROFILE.styling).toBe("tailwind");
      expect(DEFAULT_PROFILE.stateManagement).toBe("zustand");
      expect(DEFAULT_PROFILE.packageManager).toBe("pnpm");
      expect(DEFAULT_PROFILE.testRunner).toBe("vitest");
      expect(DEFAULT_PROFILE.linter).toBe("oxlint");
      expect(DEFAULT_PROFILE.projectStructure).toBe("monorepo");
    });

    it("defaults to non-autonomous mode", () => {
      expect(DEFAULT_PROFILE.autonomousByDefault).toBe(false);
    });

    it("defaults to TypeScript", () => {
      expect(DEFAULT_PROFILE.languages).toEqual(["typescript"]);
    });
  });

  describe("PROFILE_CATEGORIES", () => {
    it("has an entry for every DeveloperProfile field", () => {
      const profileKeys = Object.keys(DEFAULT_PROFILE) as (keyof DeveloperProfile)[];
      const categoryKeys = PROFILE_CATEGORIES.map((c: ProfileCategory) => c.key);

      for (const key of profileKeys) {
        expect(categoryKeys).toContain(key);
      }
    });

    it("every category has a label and recommended value", () => {
      for (const category of PROFILE_CATEGORIES) {
        expect(category.label).toBeTruthy();
        expect(category).toHaveProperty("recommended");
        expect(category).toHaveProperty("alternatives");
        expect(Array.isArray(category.alternatives)).toBe(true);
      }
    });

    it("every category except name has at least one alternative", () => {
      for (const category of PROFILE_CATEGORIES) {
        if (category.key !== "name") {
          expect(
            category.alternatives.length,
            `${category.key} should have alternatives`,
          ).toBeGreaterThan(0);
        }
      }
    });

    it("recommended values match DEFAULT_PROFILE values", () => {
      for (const category of PROFILE_CATEGORIES) {
        const key = category.key;
        const defaultValue = DEFAULT_PROFILE[key];

        // Skip name (empty string) and array fields
        if (key === "name") continue;
        if (Array.isArray(defaultValue)) {
          // For array fields, recommended should be the first element
          expect(category.recommended).toBe(defaultValue[0]);
          continue;
        }

        expect(
          category.recommended,
          `${key}: recommended "${category.recommended}" should match default "${String(defaultValue)}"`,
        ).toBe(String(defaultValue));
      }
    });

    it("languages category is multi-select", () => {
      const langCategory = PROFILE_CATEGORIES.find((c) => c.key === "languages");
      expect(langCategory).toBeDefined();
      expect(langCategory!.multi).toBe(true);
    });
  });
});
