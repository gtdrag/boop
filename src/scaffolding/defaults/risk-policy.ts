/**
 * Risk policy scaffolding defaults.
 *
 * Generates a `.boop/risk-policy.json` file tailored to the developer's
 * profile. Backend/database paths are high-risk, frontend pages/components
 * are medium-risk, everything else is low-risk.
 */
import type { DeveloperProfile } from "../../profile/schema.js";
import type { GeneratedFile } from "./shared.js";
import type { RiskPolicy } from "../../review/adversarial/risk-policy.js";

// ---------------------------------------------------------------------------
// High-risk path generators
// ---------------------------------------------------------------------------

function getBackendHighRiskPaths(profile: DeveloperProfile): string[] {
  const paths: string[] = [];

  if (profile.backendFramework !== "none") {
    paths.push("src/api/**", "src/auth/**", "src/middleware/**");

    // Next.js API routes
    if (profile.frontendFramework === "next") {
      paths.push("app/api/**", "pages/api/**");
    }
  }

  return paths;
}

function getDatabaseHighRiskPaths(profile: DeveloperProfile): string[] {
  if (profile.database === "none") return [];

  const paths = ["db/**"];

  // ORM-specific paths
  if (profile.database === "postgresql" || profile.database === "mysql" || profile.database === "sqlite") {
    paths.push("prisma/**", "drizzle/**");
  }

  if (profile.database === "supabase") {
    paths.push("supabase/**");
  }

  return paths;
}

function getNextMiddlewareHighRiskPaths(profile: DeveloperProfile): string[] {
  if (profile.frontendFramework !== "next") return [];
  return ["middleware.ts", "middleware.js"];
}

// ---------------------------------------------------------------------------
// Medium-risk path generators
// ---------------------------------------------------------------------------

function getFrontendMediumRiskPaths(profile: DeveloperProfile): string[] {
  if (profile.frontendFramework === "none") return [];

  const paths = ["src/components/**", "src/routes/**", "src/pages/**"];

  if (profile.frontendFramework === "next") {
    paths.push("app/**");
  }

  if (profile.frontendFramework === "nuxt") {
    paths.push("pages/**", "components/**");
  }

  if (profile.frontendFramework === "sveltekit") {
    paths.push("src/routes/**");
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a risk policy JSON file based on the developer profile.
 *
 * Returns the file as a `GeneratedFile` array (0 or 1 element).
 * Always generates a policy — the low tier wildcard ensures full coverage.
 */
export function generateRiskPolicyDefaults(profile: DeveloperProfile): GeneratedFile[] {
  const highPaths = [
    ...getBackendHighRiskPaths(profile),
    ...getDatabaseHighRiskPaths(profile),
    ...getNextMiddlewareHighRiskPaths(profile),
  ];

  const mediumPaths = getFrontendMediumRiskPaths(profile);

  const policy: RiskPolicy = {
    version: "1",
    tiers: {
      high: {
        paths: highPaths.length > 0 ? highPaths : ["src/api/**", "src/auth/**"],
        maxIterations: 3,
        minFixSeverity: "medium",
        agents: ["code-quality", "test-coverage", "security"],
        requireApproval: true,
      },
      medium: {
        paths: mediumPaths.length > 0 ? mediumPaths : ["src/components/**", "src/pages/**"],
        maxIterations: 2,
        minFixSeverity: "high",
        agents: ["code-quality", "test-coverage"],
        requireApproval: false,
      },
      low: {
        paths: ["**"],
        maxIterations: 1,
        minFixSeverity: "critical",
        agents: ["code-quality"],
        requireApproval: false,
      },
    },
  };

  return [
    {
      filepath: ".boop/risk-policy.json",
      content: JSON.stringify(policy, null, 2) + "\n",
    },
  ];
}
