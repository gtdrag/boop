/**
 * Stack review checkpoint — runs between planning and the epic loop.
 *
 * Presents the recommended tech stack, lists required credentials,
 * lets the user adjust choices, and collects missing credentials.
 *
 * NOT a pipeline phase — runs inline in program.ts. Does not modify
 * the state machine or the user's global profile.yaml.
 */
import type { DeveloperProfile } from "../profile/schema.js";
import type { StackSummary } from "../planning/architecture.js";
import {
  createCredentialStore,
  getRequiredCredentials,
  getEnvVarName,
  type CredentialKey,
} from "../security/credentials.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StackReviewResult {
  /** Profile (possibly adjusted for this run). */
  profile: DeveloperProfile;
  /** Whether the user approved proceeding. */
  approved: boolean;
  /** Credentials that are available. */
  credentialsReady: CredentialKey[];
  /** Credentials still missing. */
  credentialsMissing: CredentialKey[];
}

export interface StackReviewOptions {
  profile: DeveloperProfile;
  stackSummary: StackSummary | null;
  autonomous: boolean;
  onProgress?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a category for display. */
function formatCategory(label: string, value: string | undefined): string {
  return `  ${label}: ${value ?? "not set"}`;
}

/** Build a display summary from stack summary + profile fallback. */
function buildDisplayLines(profile: DeveloperProfile, summary: StackSummary | null): string[] {
  const lines: string[] = [];

  const fe = summary?.frontend?.framework ?? profile.frontendFramework;
  const styling = summary?.frontend?.styling ?? profile.styling;
  const be = summary?.backend?.framework ?? profile.backendFramework;
  const api = summary?.backend?.apiPattern ?? "REST";
  const db = summary?.database?.primary ?? profile.database;
  const orm = summary?.database?.orm;
  const cloud = summary?.infrastructure?.cloudProvider ?? profile.cloudProvider;
  const cicd = summary?.infrastructure?.ciCd ?? profile.ciCd;
  const auth = summary?.auth?.strategy;

  lines.push(formatCategory("Frontend", fe !== "none" ? `${fe} + ${styling}` : "none"));
  lines.push(formatCategory("Backend", be !== "none" ? `${be} (${api})` : "none"));
  lines.push(formatCategory("Database", db !== "none" ? (orm ? `${db} + ${orm}` : db) : "none"));
  lines.push(formatCategory("Cloud", cloud));
  lines.push(formatCategory("CI/CD", cicd));
  if (auth) lines.push(formatCategory("Auth", auth));

  return lines;
}

// ---------------------------------------------------------------------------
// Autonomous mode
// ---------------------------------------------------------------------------

async function runAutonomousReview(options: StackReviewOptions): Promise<StackReviewResult> {
  const { profile, stackSummary, onProgress } = options;
  const store = createCredentialStore();
  const required = getRequiredCredentials(profile);

  const ready: CredentialKey[] = [];
  const missing: CredentialKey[] = [];

  for (const key of required) {
    if (store.exists(key)) {
      ready.push(key);
    } else {
      missing.push(key);
    }
  }

  // Show what was resolved
  onProgress?.("Stack review (autonomous):");
  for (const line of buildDisplayLines(profile, stackSummary)) {
    onProgress?.(line);
  }

  if (missing.length > 0) {
    const missingList = missing
      .map((k) => `  - ${getEnvVarName(k)} (${k})`)
      .join("\n");
    throw new Error(
      `Missing required credentials for autonomous mode:\n${missingList}\n\n` +
        "Set them as environment variables or save to ~/.boop/credentials/",
    );
  }

  onProgress?.(`All ${ready.length} required credentials found.`);

  return {
    profile,
    approved: true,
    credentialsReady: ready,
    credentialsMissing: [],
  };
}

// ---------------------------------------------------------------------------
// Interactive mode
// ---------------------------------------------------------------------------

async function runInteractiveReview(options: StackReviewOptions): Promise<StackReviewResult> {
  const { profile, stackSummary, onProgress } = options;
  const clack = await import("@clack/prompts");

  // Display current stack
  clack.intro("Tech Stack Review");

  const displayLines = buildDisplayLines(profile, stackSummary);
  clack.note(displayLines.join("\n"), "Recommended Stack");

  // Ask if user wants to adjust
  const action = await clack.select({
    message: "How would you like to proceed?",
    options: [
      { value: "approve", label: "Approve stack and continue" },
      { value: "adjust", label: "Adjust stack choices" },
      { value: "cancel", label: "Cancel pipeline" },
    ],
  });

  if (clack.isCancel(action) || action === "cancel") {
    return {
      profile,
      approved: false,
      credentialsReady: [],
      credentialsMissing: [],
    };
  }

  // Possibly adjust profile for this run
  let effectiveProfile = { ...profile };

  if (action === "adjust") {
    // Let user change key stack choices
    const dbChoice = await clack.select({
      message: "Database:",
      options: [
        { value: profile.database, label: `${profile.database} (current)` },
        { value: "postgresql", label: "PostgreSQL" },
        { value: "sqlite", label: "SQLite" },
        { value: "mongodb", label: "MongoDB" },
        { value: "none", label: "None" },
      ],
    });
    if (!clack.isCancel(dbChoice)) {
      effectiveProfile = { ...effectiveProfile, database: dbChoice as string };
    }

    const cloudChoice = await clack.select({
      message: "Cloud provider:",
      options: [
        { value: profile.cloudProvider, label: `${profile.cloudProvider} (current)` },
        { value: "vercel", label: "Vercel" },
        { value: "railway", label: "Railway" },
        { value: "fly", label: "Fly.io" },
        { value: "none", label: "None" },
      ],
    });
    if (!clack.isCancel(cloudChoice)) {
      effectiveProfile = { ...effectiveProfile, cloudProvider: cloudChoice as string };
    }
  }

  // Check and collect credentials
  const store = createCredentialStore();
  const required = getRequiredCredentials(effectiveProfile);
  const ready: CredentialKey[] = [];
  const missing: CredentialKey[] = [];

  for (const key of required) {
    if (store.exists(key)) {
      ready.push(key);
    } else {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    clack.note(
      missing.map((k) => `  ${getEnvVarName(k)} — not found`).join("\n"),
      "Missing Credentials",
    );

    for (const key of missing) {
      const envName = getEnvVarName(key);
      const value = await clack.password({
        message: `Enter ${envName}:`,
      });

      if (clack.isCancel(value) || !value) {
        onProgress?.(`Skipped ${envName}`);
        continue;
      }

      store.save(key, value);
      ready.push(key);
      onProgress?.(`Saved ${envName}`);
    }
  }

  // Recompute missing after collection
  const finalMissing = required.filter((k) => !store.exists(k));

  clack.outro("Stack review complete");

  return {
    profile: effectiveProfile,
    approved: true,
    credentialsReady: ready,
    credentialsMissing: finalMissing,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the stack review checkpoint.
 *
 * In autonomous mode: validates all required credentials exist and throws
 * if any are missing. In interactive mode: displays the stack, lets the
 * user adjust, and collects missing credentials.
 */
export async function runStackReview(options: StackReviewOptions): Promise<StackReviewResult> {
  if (options.autonomous) {
    return runAutonomousReview(options);
  }
  return runInteractiveReview(options);
}
