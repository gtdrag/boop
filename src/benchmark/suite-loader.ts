/**
 * Suite loader for benchmark YAML files.
 *
 * Parses suite definitions from YAML, validates required fields,
 * and lists available suites.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { BenchmarkSuite, BenchmarkCase, BenchmarkMode } from "./types.js";

const VALID_MODES: BenchmarkMode[] = ["dry-run", "live"];
const VALID_COMPLEXITIES = ["trivial", "simple", "moderate", "complex"];
const VALID_STOP_AFTER = ["PLANNING", "BRIDGING", "BUILDING", "REVIEWING"];

/** Resolve the default suites directory from the project root. */
export function resolveSuitesDir(projectRoot: string): string {
  return path.join(projectRoot, "benchmarks", "suites");
}

/**
 * Load a benchmark suite from a YAML file.
 *
 * @param filePath - Absolute path to the YAML file.
 * @returns The parsed and validated suite.
 */
export function loadSuiteFromFile(filePath: string): BenchmarkSuite {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Suite file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = parse(raw) as Record<string, unknown>;

  return validateSuite(parsed, filePath);
}

/**
 * Load a suite by name from the suites directory.
 *
 * @param suiteName - Name of the suite (without .yaml extension).
 * @param suitesDir - Directory containing suite YAML files.
 */
export function loadSuiteByName(suiteName: string, suitesDir: string): BenchmarkSuite {
  const filePath = path.join(suitesDir, `${suiteName}.yaml`);
  return loadSuiteFromFile(filePath);
}

/**
 * List all available suites in the suites directory.
 *
 * @param suitesDir - Directory containing suite YAML files.
 * @returns Array of { name, filePath } entries.
 */
export function listAvailableSuites(
  suitesDir: string,
): Array<{ name: string; filePath: string }> {
  if (!fs.existsSync(suitesDir)) {
    return [];
  }

  return fs
    .readdirSync(suitesDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => ({
      name: f.replace(/\.ya?ml$/, ""),
      filePath: path.join(suitesDir, f),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Validate a raw parsed object as a BenchmarkSuite. */
function validateSuite(raw: Record<string, unknown>, source: string): BenchmarkSuite {
  if (!raw.id || typeof raw.id !== "string") {
    throw new Error(`Suite in ${source} missing required field "id" (string)`);
  }
  if (!raw.name || typeof raw.name !== "string") {
    throw new Error(`Suite in ${source} missing required field "name" (string)`);
  }
  if (!raw.description || typeof raw.description !== "string") {
    throw new Error(`Suite in ${source} missing required field "description" (string)`);
  }
  if (!raw.mode || !VALID_MODES.includes(raw.mode as BenchmarkMode)) {
    throw new Error(`Suite in ${source} has invalid "mode". Must be: ${VALID_MODES.join(", ")}`);
  }
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    throw new Error(`Suite in ${source} must have at least one case`);
  }

  const cases = (raw.cases as Record<string, unknown>[]).map((c, i) =>
    validateCase(c, source, i),
  );

  return {
    id: raw.id as string,
    name: raw.name as string,
    description: raw.description as string,
    mode: raw.mode as BenchmarkMode,
    cases,
  };
}

/** Validate a raw parsed object as a BenchmarkCase. */
function validateCase(
  raw: Record<string, unknown>,
  source: string,
  index: number,
): BenchmarkCase {
  const ctx = `case[${index}] in ${source}`;

  if (!raw.id || typeof raw.id !== "string") {
    throw new Error(`${ctx} missing required field "id" (string)`);
  }
  if (!raw.label || typeof raw.label !== "string") {
    throw new Error(`${ctx} missing required field "label" (string)`);
  }
  if (!raw.idea || typeof raw.idea !== "string") {
    throw new Error(`${ctx} missing required field "idea" (string)`);
  }
  if (!raw.complexity || !VALID_COMPLEXITIES.includes(raw.complexity as string)) {
    throw new Error(
      `${ctx} has invalid "complexity". Must be: ${VALID_COMPLEXITIES.join(", ")}`,
    );
  }
  if (raw.stopAfter !== undefined && !VALID_STOP_AFTER.includes(raw.stopAfter as string)) {
    throw new Error(
      `${ctx} has invalid "stopAfter". Must be: ${VALID_STOP_AFTER.join(", ")}`,
    );
  }

  const benchmarkCase: BenchmarkCase = {
    id: raw.id as string,
    label: raw.label as string,
    idea: raw.idea as string,
    complexity: raw.complexity as BenchmarkCase["complexity"],
  };

  if (raw.stopAfter) {
    benchmarkCase.stopAfter = raw.stopAfter as BenchmarkCase["stopAfter"];
  }

  if (Array.isArray(raw.expectations)) {
    benchmarkCase.expectations = (raw.expectations as Record<string, unknown>[]).map((e) => ({
      metric: e.metric as "viability_recommendation" | "phase_reached" | "success",
      expected: e.expected as string | boolean,
    }));
  }

  return benchmarkCase;
}
