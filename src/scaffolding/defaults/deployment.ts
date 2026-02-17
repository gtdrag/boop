/**
 * Deployment config scaffolding defaults.
 *
 * Generates platform-specific deployment configuration files based on
 * the developer's cloud provider preference. These files are written
 * during the SCAFFOLDING phase so the project is deployable from the start.
 */
import type { DeveloperProfile } from "../../profile/schema.js";
import type { GeneratedFile } from "./shared.js";

// ---------------------------------------------------------------------------
// Provider-specific generators
// ---------------------------------------------------------------------------

function vercelDefaults(profile: DeveloperProfile): GeneratedFile[] {
  const pm = safePackageManager(profile.packageManager);
  return [
    {
      filepath: "vercel.json",
      content:
        JSON.stringify(
          {
            $schema: "https://openapi.vercel.sh/vercel.json",
            buildCommand: `${pm} build`,
            installCommand: `${pm} install`,
            framework: null,
          },
          null,
          2,
        ) + "\n",
    },
  ];
}

function railwayDefaults(profile: DeveloperProfile): GeneratedFile[] {
  const pm = safePackageManager(profile.packageManager);
  return [
    {
      filepath: "railway.toml",
      content: `[build]
builder = "nixpacks"

[deploy]
startCommand = "${pm} start"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
`,
    },
  ];
}

function flyDefaults(profile: DeveloperProfile): GeneratedFile[] {
  return [
    {
      filepath: "fly.toml",
      content: `# app = "your-app-name"  # Set via 'fly launch' or edit manually
primary_region = "iad"

[build]

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[checks]
  [checks.health]
    port = 3000
    type = "http"
    interval = "15s"
    timeout = "2s"
    path = "/health"
`,
    },
  ];
}

const VALID_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/** Validate packageManager to a known set — prevents injection into templates. */
function safePackageManager(pm: string): string {
  return VALID_PACKAGE_MANAGERS.has(pm) ? pm : "npm";
}

function nodeDockerfile(rawPm: string): string {
  const pm = safePackageManager(rawPm);
  const lockFiles: Record<string, string> = {
    pnpm: "pnpm-lock.yaml",
    npm: "package-lock.json",
    yarn: "yarn.lock",
    bun: "bun.lockb",
  };
  const lockFile = lockFiles[pm] ?? "package-lock.json";
  const enableCmd = pm === "pnpm" ? "\nRUN corepack enable pnpm\n" : "";

  // npm uses `npm ci` (not `npm install --ci`); others use --frozen-lockfile
  const installCmd = pm === "npm" ? "npm ci" : `${pm} install --frozen-lockfile`;
  const installProdCmd =
    pm === "npm"
      ? "npm ci --omit=dev"
      : pm === "pnpm"
        ? "pnpm install --frozen-lockfile --prod"
        : `${pm} install --frozen-lockfile --production`;

  return `# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app
${enableCmd}
COPY package.json ${lockFile} ./
RUN ${installCmd}

COPY . .
RUN ${pm} build

# --- Production stage ---
FROM node:22-alpine AS runner
WORKDIR /app
${enableCmd}
COPY --from=builder /app/package.json /app/${lockFile} ./
RUN ${installProdCmd}

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
`;
}

function pythonDockerfile(): string {
  return `FROM python:3.11-slim AS builder
WORKDIR /app
RUN python -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "-m", "app"]
`;
}

function dockerDefaults(profile: DeveloperProfile): GeneratedFile[] {
  const isPython = profile.languages.includes("python");
  const dockerfile = isPython ? pythonDockerfile() : nodeDockerfile(profile.packageManager);

  const dockerignore = isPython
    ? `__pycache__
*.pyc
.git
.boop
.env
*.log
.venv
`
    : `node_modules
.git
.boop
.env
*.log
dist
coverage
.next
`;

  return [
    { filepath: "Dockerfile", content: dockerfile },
    { filepath: ".dockerignore", content: dockerignore },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate deployment config files based on the cloud provider preference.
 *
 * Returns an empty array for "none" or unknown providers.
 */
export function generateDeploymentDefaults(profile: DeveloperProfile): GeneratedFile[] {
  switch (profile.cloudProvider?.toLowerCase()) {
    case "vercel":
      return vercelDefaults(profile);
    case "railway":
      return railwayDefaults(profile);
    case "fly":
      return flyDefaults(profile);
    case "docker":
      return dockerDefaults(profile);
    default:
      return [];
  }
}
