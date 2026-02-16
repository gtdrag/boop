import { createRequire } from "node:module";

const CORE_PACKAGE_NAME = "boop";

const PACKAGE_JSON_CANDIDATES = [
  "../package.json",
  "../../package.json",
  "../../../package.json",
  "./package.json",
] as const;

function readVersionFromPackageJson(moduleUrl: string): string | null {
  try {
    const require = createRequire(moduleUrl);
    for (const candidate of PACKAGE_JSON_CANDIDATES) {
      try {
        const parsed = require(candidate) as { name?: string; version?: string };
        const version = parsed.version?.trim();
        if (!version) {
          continue;
        }
        if (parsed.name !== CORE_PACKAGE_NAME) {
          continue;
        }
        return version;
      } catch {
        // ignore missing or unreadable candidate
      }
    }
    return null;
  } catch {
    return null;
  }
}

export const VERSION = readVersionFromPackageJson(import.meta.url) ?? "0.0.0";
