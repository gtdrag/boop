/**
 * Developer profile schema.
 *
 * Defines the full shape of a developer's tech-stack preferences.
 * Every field has a recommended default (see defaults.ts).
 */

/** Frontend framework preference. */
export type FrontendFramework =
  | "next"
  | "remix"
  | "astro"
  | "nuxt"
  | "sveltekit"
  | "vite-react"
  | "vite-vue"
  | "angular"
  | "none"
  | string;

/** Backend framework preference. */
export type BackendFramework = "express" | "fastify" | "hono" | "nest" | "koa" | "none" | string;

/** Database preference. */
export type Database =
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "mongodb"
  | "redis"
  | "supabase"
  | "none"
  | string;

/** Cloud / deployment target. */
export type CloudProvider =
  | "vercel"
  | "aws"
  | "gcp"
  | "azure"
  | "fly"
  | "railway"
  | "docker"
  | "none"
  | string;

/** CSS / styling approach. */
export type StylingApproach =
  | "tailwind"
  | "css-modules"
  | "styled-components"
  | "vanilla-css"
  | "none"
  | string;

/** Client-side state management. */
export type StateManagement =
  | "zustand"
  | "redux"
  | "jotai"
  | "pinia"
  | "svelte-stores"
  | "none"
  | string;

/** Analytics / telemetry service. */
export type AnalyticsProvider =
  | "posthog"
  | "plausible"
  | "google-analytics"
  | "mixpanel"
  | "none"
  | string;

/** Error tracking provider. */
export type ErrorTracker = "sentry" | "bugsnag" | "none" | string;

/** CI/CD provider. */
export type CiCdProvider = "github-actions" | "gitlab-ci" | "circleci" | "none" | string;

/** Programming language preference. */
export type Language = "typescript" | "javascript" | "python" | "go" | "rust" | string;

/** Package manager. */
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | string;

/** Test runner. */
export type TestRunner = "vitest" | "jest" | "mocha" | "playwright" | string;

/** Linter / formatter. */
export type Linter = "oxlint" | "eslint" | "biome" | "none" | string;

/** Project structure. */
export type ProjectStructure = "monorepo" | "single-repo";

/**
 * Full developer profile.
 *
 * Every category maps to a single preferred choice. The onboarding
 * flow leads with a recommendation for each and lets the user accept
 * or override.
 */
export interface DeveloperProfile {
  /** Display name. */
  name: string;

  /** Primary programming languages (ordered by preference). */
  languages: Language[];

  /** Frontend framework. */
  frontendFramework: FrontendFramework;

  /** Backend framework. */
  backendFramework: BackendFramework;

  /** Primary database. */
  database: Database;

  /** Cloud / deployment target. */
  cloudProvider: CloudProvider;

  /** CSS / styling approach. */
  styling: StylingApproach;

  /** Client-side state management. */
  stateManagement: StateManagement;

  /** Analytics / telemetry. */
  analytics: AnalyticsProvider;

  /** CI/CD provider. */
  ciCd: CiCdProvider;

  /** Package manager. */
  packageManager: PackageManager;

  /** Test runner. */
  testRunner: TestRunner;

  /** Linter / formatter. */
  linter: Linter;

  /** Project structure preference. */
  projectStructure: ProjectStructure;

  /** Error tracking provider. */
  errorTracker: ErrorTracker;

  /** AI model preference. */
  aiModel: string;

  /** Whether to run in autonomous mode by default. */
  autonomousByDefault: boolean;

  /** Notification channel for bidirectional messaging. */
  notificationChannel?: "whatsapp" | "telegram" | "none";

  /** WhatsApp phone number with country code (e.g. "+1234567890"). */
  phoneNumber?: string;

  /** Telegram chat ID (numeric string from @userinfobot). */
  telegramChatId?: string;

  /** Telegram bot token from @BotFather. */
  telegramBotToken?: string;

  /** Timeout in seconds for waiting for user replies. 0 = no timeout. Defaults to 300. */
  notificationTimeout?: number;
}

/**
 * Category metadata used by the onboarding flow.
 *
 * Each entry describes one profile field: its display label,
 * the recommended default, and a set of common alternatives.
 */
export interface ProfileCategory {
  /** Profile field key. */
  key: keyof DeveloperProfile;
  /** Human-readable label shown during onboarding. */
  label: string;
  /** The recommended default value. */
  recommended: string;
  /** Common alternatives the user can pick from. */
  alternatives: string[];
  /** Whether the field accepts multiple values (array field). */
  multi?: boolean;
}
