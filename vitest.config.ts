import os from "node:os";
import { defineConfig } from "vitest/config";

const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const isWindows = process.platform === "win32";
const localWorkers = Math.max(4, Math.min(16, os.cpus().length));
const ciWorkers = isWindows ? 2 : 3;

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: isWindows ? 180_000 : 120_000,
    unstubEnvs: true,
    unstubGlobals: true,
    pool: "forks",
    maxWorkers: isCI ? ciWorkers : localWorkers,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    exclude: ["dist/**", "**/node_modules/**", "**/*.live.test.ts", "**/*.e2e.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      all: false,
      include: ["./src/**/*.ts"],
      exclude: [
        "test/**",
        "src/**/*.test.ts",
        "src/entry.ts",
        "src/index.ts",
        "src/runtime.ts",
        "src/cli/**",
        "src/hooks/**",
        "src/agents/**",
        "src/channels/**",
        "src/gateway/**",
        "src/browser/**",
        "src/telegram/**",
        "src/whatsapp/**",
        "src/process/**",
      ],
    },
  },
});
