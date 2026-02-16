/**
 * Onboarding interview flow.
 *
 * Walks the user through each profile category, leading with an
 * opinionated recommendation. Pressing enter accepts the default;
 * typing a value overrides it.
 *
 * Saves the resulting DeveloperProfile to ~/.boop/profile.yaml.
 */
import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { PROFILE_CATEGORIES } from "./defaults.js";
import type { DeveloperProfile, ProfileCategory } from "./schema.js";

/**
 * Options for the onboarding interview.
 */
export interface OnboardingOptions {
  /** Directory to save profile.yaml into (default: ~/.boop/). */
  stateDir: string;
  /** Existing profile to pre-populate (for editing). */
  existingProfile?: DeveloperProfile;
}

/**
 * Result of the onboarding interview.
 */
export interface OnboardingResult {
  /** Whether the interview completed (false if cancelled). */
  completed: boolean;
  /** The generated profile (only set when completed). */
  profile?: DeveloperProfile;
  /** Path where profile.yaml was saved. */
  profilePath?: string;
}

/**
 * Prompt for a single-value category.
 *
 * Shows: "Category? recommended (recommended) — or type your preference:"
 * Enter accepts the recommended/current value; typing overrides.
 */
async function promptSingleValue(
  category: ProfileCategory,
  currentValue: string | undefined,
  clack: typeof import("@clack/prompts"),
): Promise<string | symbol> {
  const defaultValue = currentValue ?? category.recommended;
  const isCurrentValue = currentValue !== undefined;
  const tag = isCurrentValue ? "current" : "recommended";

  return clack.text({
    message: `${category.label}? ${defaultValue} (${tag})`,
    placeholder: defaultValue,
    defaultValue,
  });
}

/**
 * Prompt for a multi-value category (e.g., languages).
 *
 * Uses multiselect with the recommended value pre-selected.
 */
async function promptMultiValue(
  category: ProfileCategory,
  currentValues: string[] | undefined,
  clack: typeof import("@clack/prompts"),
): Promise<string[] | symbol> {
  const allOptions = [category.recommended, ...category.alternatives];
  const initial = currentValues ?? [category.recommended];

  return clack.multiselect({
    message: `${category.label}? (space to toggle, enter to confirm)`,
    options: allOptions.map((opt) => ({
      value: opt,
      label: opt,
    })),
    initialValues: initial,
    required: true,
  });
}

/**
 * Prompt for the name field (free text, no recommendation).
 */
async function promptName(
  currentValue: string | undefined,
  clack: typeof import("@clack/prompts"),
): Promise<string | symbol> {
  const message = currentValue
    ? `Your name? ${currentValue} (current)`
    : "What's your name?";
  return clack.text({
    message,
    placeholder: currentValue || "Your name",
    defaultValue: currentValue || undefined,
    validate(value) {
      if (!value || !value.trim()) return "Please enter your name.";
    },
  });
}

/**
 * Prompt for the boolean autonomousByDefault field.
 */
async function promptBoolean(
  category: ProfileCategory,
  currentValue: boolean | undefined,
  clack: typeof import("@clack/prompts"),
): Promise<boolean | symbol> {
  const defaultIsYes = currentValue ?? category.recommended === "true";
  const tag = currentValue !== undefined ? " (current)" : "";
  return clack.confirm({
    message: `${category.label}?${tag}`,
    initialValue: defaultIsYes,
  });
}

/**
 * Run the full onboarding interview.
 *
 * Iterates over PROFILE_CATEGORIES, prompting for each field.
 * Returns the completed profile or indicates cancellation.
 */
export async function runOnboarding(
  options: OnboardingOptions,
): Promise<OnboardingResult> {
  const clack = await import("@clack/prompts");
  const existing = options.existingProfile;

  clack.intro(
    existing
      ? "Edit your developer profile"
      : "Welcome to Boop! Let's set up your developer profile.",
  );

  const profile: Record<string, unknown> = {};

  for (const category of PROFILE_CATEGORIES) {
    const key = category.key;

    if (key === "name") {
      const result = await promptName(
        existing?.name,
        clack,
      );
      if (clack.isCancel(result)) {
        clack.outro("Profile setup cancelled.");
        return { completed: false };
      }
      profile.name = (result as string).trim();
      continue;
    }

    if (key === "autonomousByDefault") {
      const result = await promptBoolean(
        category,
        existing?.autonomousByDefault,
        clack,
      );
      if (clack.isCancel(result)) {
        clack.outro("Profile setup cancelled.");
        return { completed: false };
      }
      profile.autonomousByDefault = result;
      continue;
    }

    if (category.multi) {
      const currentArr = existing
        ? (existing[key] as string[])
        : undefined;
      const result = await promptMultiValue(category, currentArr, clack);
      if (clack.isCancel(result)) {
        clack.outro("Profile setup cancelled.");
        return { completed: false };
      }
      profile[key] = result;
      continue;
    }

    // Single-value string field
    const currentStr = existing
      ? String(existing[key])
      : undefined;
    const result = await promptSingleValue(category, currentStr, clack);
    if (clack.isCancel(result)) {
      clack.outro("Profile setup cancelled.");
      return { completed: false };
    }
    profile[key] = (result as string).trim();
  }

  const finalProfile = profile as unknown as DeveloperProfile;

  // Save to disk
  const profilePath = path.join(options.stateDir, "profile.yaml");
  fs.mkdirSync(options.stateDir, { recursive: true });
  fs.writeFileSync(profilePath, stringify(finalProfile), "utf-8");

  clack.outro("Profile saved! You're ready to boop.");

  return {
    completed: true,
    profile: finalProfile,
    profilePath,
  };
}

/**
 * Load a profile from disk.
 *
 * Returns undefined if the file doesn't exist.
 */
export function loadProfile(stateDir: string): DeveloperProfile | undefined {
  const profilePath = path.join(stateDir, "profile.yaml");
  if (!fs.existsSync(profilePath)) {
    return undefined;
  }

  const raw = fs.readFileSync(profilePath, "utf-8");
  return parse(raw) as DeveloperProfile;
}
