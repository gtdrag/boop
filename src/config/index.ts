/**
 * Configuration system for Boop.
 *
 * Handles loading and validating config from ~/.boop/ and .boop/
 * Derived from OpenClaw's config module (MIT license).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_DIRNAME = ".boop";
const CONFIG_FILENAME = "config.yaml";
const PROFILE_FILENAME = "profile.yaml";

export function resolveHomeDir(): string {
  const override = process.env.BOOP_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }
  return os.homedir();
}

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.BOOP_STATE_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(resolveHomeDir(), STATE_DIRNAME);
}

export function resolveConfigPath(stateDir: string = resolveStateDir()): string {
  return path.join(stateDir, CONFIG_FILENAME);
}

export function resolveProfilePath(stateDir: string = resolveStateDir()): string {
  return path.join(stateDir, PROFILE_FILENAME);
}

export function ensureStateDir(stateDir: string = resolveStateDir()): void {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

export interface BoopConfig {
  profile?: string;
  gateway?: {
    port?: number;
    host?: string;
  };
}

export interface InitResult {
  /** Whether the ~/.boop/ directory was freshly created. */
  created: boolean;
  /** Whether onboarding needs to run (no profile.yaml found). */
  needsOnboarding: boolean;
  /** Absolute path to the global config directory. */
  stateDir: string;
}

/**
 * Initialize the global ~/.boop/ directory structure.
 *
 * Creates:
 *   ~/.boop/
 *   ~/.boop/logs/
 *   ~/.boop/credentials/  (mode 0600)
 *
 * Returns whether the directory was freshly created and whether
 * onboarding is needed (profile.yaml doesn't exist).
 */
export function initGlobalConfig(stateDir?: string): InitResult {
  const dir = stateDir ?? resolveStateDir();
  const existed = fs.existsSync(dir);

  // Create base dir and subdirectories
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });

  const credentialsDir = path.join(dir, "credentials");
  fs.mkdirSync(credentialsDir, { recursive: true });

  // Set credentials directory to owner-only (0700 for dir so owner can list/traverse)
  fs.chmodSync(credentialsDir, 0o700);

  const profilePath = resolveProfilePath(dir);
  const needsOnboarding = !fs.existsSync(profilePath);

  return {
    created: !existed,
    needsOnboarding,
    stateDir: dir,
  };
}

/**
 * Run the onboarding interview.
 *
 * Walks the user through each profile category with opinionated
 * recommendations. Saves the result to ~/.boop/profile.yaml.
 */
export async function runOnboarding(stateDir?: string): Promise<void> {
  const { runOnboarding: doOnboarding } = await import("../profile/onboarding.js");
  const dir = stateDir ?? resolveStateDir();
  await doOnboarding({ stateDir: dir });
}

/**
 * Run the profile editor (re-runs onboarding with current values).
 *
 * Loads the existing profile and presents it for editing.
 */
export async function editProfile(stateDir?: string): Promise<void> {
  const { runOnboarding: doOnboarding, loadProfile } = await import("../profile/onboarding.js");
  const dir = stateDir ?? resolveStateDir();
  const existing = loadProfile(dir);
  await doOnboarding({ stateDir: dir, existingProfile: existing });
}

/**
 * @deprecated Use runOnboarding() instead. Kept for backward compatibility with tests.
 */
export function runOnboardingStub(): void {
  console.log(
    "[boop] Welcome! No developer profile found.",
  );
  console.log(
    "[boop] Run 'boop --profile' to set up your profile.",
  );
}
