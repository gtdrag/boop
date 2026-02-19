/**
 * Gauntlet tier loader.
 *
 * Parses gauntlet definition YAML files, validates required fields,
 * and discovers available gauntlet definitions.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { GauntletDefinition, GauntletTier, TierSuccessCriteria } from "./types.js";
import { PIPELINE_PHASES } from "../shared/types.js";

const VALID_PHASES = new Set<string>(PIPELINE_PHASES);

/** Resolve the gauntlet definitions directory from the project root. */
export function resolveGauntletDir(projectRoot: string): string {
  return path.join(projectRoot, "benchmarks", "gauntlet");
}

/**
 * Load a gauntlet definition from a YAML file.
 *
 * @param filePath - Absolute path to the YAML file.
 * @returns The parsed and validated definition.
 */
export function loadGauntletDefinition(filePath: string): GauntletDefinition {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Gauntlet definition not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = parse(raw) as Record<string, unknown>;

  return validateDefinition(parsed, filePath);
}

/**
 * Load a gauntlet definition by name from the gauntlet directory.
 *
 * @param name - Name of the definition (without .yaml extension).
 * @param gauntletDir - Directory containing gauntlet YAML files.
 */
export function loadGauntletByName(name: string, gauntletDir: string): GauntletDefinition {
  const filePath = path.join(gauntletDir, `${name}.yaml`);
  return loadGauntletDefinition(filePath);
}

/**
 * List all available gauntlet definitions in a directory.
 *
 * @param gauntletDir - Directory containing gauntlet YAML files.
 * @returns Array of { name, filePath } entries.
 */
export function listAvailableGauntlets(
  gauntletDir: string,
): Array<{ name: string; filePath: string }> {
  if (!fs.existsSync(gauntletDir)) {
    return [];
  }

  return fs
    .readdirSync(gauntletDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => ({
      name: f.replace(/\.ya?ml$/, ""),
      filePath: path.join(gauntletDir, f),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Validate a raw parsed object as a GauntletDefinition. */
function validateDefinition(
  raw: Record<string, unknown>,
  source: string,
): GauntletDefinition {
  if (!raw.id || typeof raw.id !== "string") {
    throw new Error(`Gauntlet in ${source} missing required field "id" (string)`);
  }
  if (!raw.name || typeof raw.name !== "string") {
    throw new Error(`Gauntlet in ${source} missing required field "name" (string)`);
  }
  if (!raw.description || typeof raw.description !== "string") {
    throw new Error(`Gauntlet in ${source} missing required field "description" (string)`);
  }
  if (!Array.isArray(raw.tiers) || raw.tiers.length === 0) {
    throw new Error(`Gauntlet in ${source} must have at least one tier`);
  }

  const tiers = (raw.tiers as Record<string, unknown>[]).map((t, i) =>
    validateTier(t, source, i),
  );

  return {
    id: raw.id as string,
    name: raw.name as string,
    description: raw.description as string,
    tiers,
  };
}

/** Validate a raw parsed object as a GauntletTier. */
function validateTier(
  raw: Record<string, unknown>,
  source: string,
  index: number,
): GauntletTier {
  const ctx = `tier[${index}] in ${source}`;

  if (!raw.id || typeof raw.id !== "string") {
    throw new Error(`${ctx} missing required field "id" (string)`);
  }
  if (!raw.label || typeof raw.label !== "string") {
    throw new Error(`${ctx} missing required field "label" (string)`);
  }
  if (typeof raw.level !== "number" || raw.level < 1 || raw.level > 10) {
    throw new Error(`${ctx} has invalid "level". Must be a number 1-10`);
  }
  if (!raw.idea || typeof raw.idea !== "string") {
    throw new Error(`${ctx} missing required field "idea" (string)`);
  }
  if (!raw.stack || typeof raw.stack !== "string") {
    throw new Error(`${ctx} missing required field "stack" (string)`);
  }
  if (!raw.rationale || typeof raw.rationale !== "string") {
    throw new Error(`${ctx} missing required field "rationale" (string)`);
  }

  const successCriteria = validateSuccessCriteria(raw.successCriteria, ctx);

  const tier: GauntletTier = {
    id: raw.id as string,
    label: raw.label as string,
    level: raw.level as number,
    idea: raw.idea as string,
    stack: raw.stack as string,
    rationale: raw.rationale as string,
    successCriteria,
  };

  if (raw.profileOverrides && typeof raw.profileOverrides === "object") {
    tier.profileOverrides = raw.profileOverrides as GauntletTier["profileOverrides"];
  }

  return tier;
}

/** Validate success criteria. */
function validateSuccessCriteria(
  raw: unknown,
  ctx: string,
): TierSuccessCriteria {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${ctx} missing required field "successCriteria" (object)`);
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.minPhaseReached || typeof obj.minPhaseReached !== "string") {
    throw new Error(`${ctx}.successCriteria missing "minPhaseReached" (string)`);
  }
  if (!VALID_PHASES.has(obj.minPhaseReached as string)) {
    throw new Error(
      `${ctx}.successCriteria.minPhaseReached "${obj.minPhaseReached}" is not a valid pipeline phase`,
    );
  }
  if (typeof obj.planningMustPass !== "boolean") {
    throw new Error(`${ctx}.successCriteria missing "planningMustPass" (boolean)`);
  }

  return {
    minPhaseReached: obj.minPhaseReached as TierSuccessCriteria["minPhaseReached"],
    planningMustPass: obj.planningMustPass as boolean,
  };
}
