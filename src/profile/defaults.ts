/**
 * Opinionated defaults for the developer profile.
 *
 * Every category has a single recommended value and a list of common
 * alternatives. The onboarding flow uses PROFILE_CATEGORIES to walk
 * through each field.
 */
import type { DeveloperProfile, ProfileCategory } from "./schema.js";

/**
 * The default developer profile.
 *
 * Reflects practical, modern choices for a full-stack TypeScript developer.
 */
export const DEFAULT_PROFILE: DeveloperProfile = {
  name: "",
  languages: ["typescript"],
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

/**
 * Ordered list of profile categories for the onboarding interview.
 *
 * Each entry maps a profile field to its label, recommended value,
 * and common alternatives. The onboarding flow iterates over this
 * list and presents each category to the user.
 */
export const PROFILE_CATEGORIES: ProfileCategory[] = [
  {
    key: "name",
    label: "Your name",
    recommended: "",
    alternatives: [],
  },
  {
    key: "languages",
    label: "Programming languages",
    recommended: "typescript",
    alternatives: ["javascript", "python", "go", "rust"],
    multi: true,
  },
  {
    key: "frontendFramework",
    label: "Frontend framework",
    recommended: "next",
    alternatives: ["remix", "astro", "nuxt", "sveltekit", "vite-react", "none"],
  },
  {
    key: "backendFramework",
    label: "Backend framework",
    recommended: "express",
    alternatives: ["fastify", "hono", "nest", "koa", "none"],
  },
  {
    key: "database",
    label: "Database",
    recommended: "postgresql",
    alternatives: ["mysql", "sqlite", "mongodb", "supabase", "none"],
  },
  {
    key: "cloudProvider",
    label: "Cloud / deployment",
    recommended: "vercel",
    alternatives: ["aws", "gcp", "fly", "railway", "docker", "none"],
  },
  {
    key: "styling",
    label: "Styling",
    recommended: "tailwind",
    alternatives: ["css-modules", "styled-components", "vanilla-css", "none"],
  },
  {
    key: "stateManagement",
    label: "State management",
    recommended: "zustand",
    alternatives: ["redux", "jotai", "pinia", "none"],
  },
  {
    key: "analytics",
    label: "Analytics",
    recommended: "posthog",
    alternatives: ["plausible", "google-analytics", "mixpanel", "none"],
  },
  {
    key: "ciCd",
    label: "CI/CD",
    recommended: "github-actions",
    alternatives: ["gitlab-ci", "circleci", "none"],
  },
  {
    key: "packageManager",
    label: "Package manager",
    recommended: "pnpm",
    alternatives: ["npm", "yarn", "bun"],
  },
  {
    key: "testRunner",
    label: "Test runner",
    recommended: "vitest",
    alternatives: ["jest", "mocha", "playwright"],
  },
  {
    key: "linter",
    label: "Linter / formatter",
    recommended: "oxlint",
    alternatives: ["eslint", "biome", "none"],
  },
  {
    key: "projectStructure",
    label: "Project structure",
    recommended: "monorepo",
    alternatives: ["single-repo"],
  },
  {
    key: "aiModel",
    label: "AI model",
    recommended: "claude-opus-4-6",
    alternatives: ["claude-sonnet-4-5-20250929"],
  },
  {
    key: "autonomousByDefault",
    label: "Autonomous mode by default",
    recommended: "false",
    alternatives: ["true"],
  },
];
