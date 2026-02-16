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
