/**
 * Stack matcher — maps review rules to developer profiles by stack keywords.
 *
 * Used by the outcome injector and arch decision modules to determine
 * which review rules and decisions are relevant for a given developer's
 * preferred technology stack.
 */
import type { DeveloperProfile } from "../profile/schema.js";
import type { ReviewRule } from "../review/adversarial/review-rules.js";

/**
 * Extract normalized stack keywords from all relevant profile fields.
 *
 * Returns a flat array of lowercase, trimmed keywords representing
 * the developer's complete technology stack.
 *
 * @example
 * extractStackKeywords(profile)
 * // → ["typescript", "next", "express", "postgresql", "vercel", "tailwind", ...]
 */
export function extractStackKeywords(profile: DeveloperProfile): string[] {
  const raw: string[] = [
    ...(Array.isArray(profile.languages) ? profile.languages : []),
    profile.frontendFramework,
    profile.backendFramework,
    profile.database,
    profile.cloudProvider,
    profile.styling,
    profile.stateManagement,
    profile.analytics,
    profile.ciCd,
    profile.packageManager,
    profile.testRunner,
    profile.linter,
    profile.projectStructure,
    profile.errorTracker,
  ];

  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase().trim())
    .filter((v) => v.length > 0 && v !== "none");
}

/**
 * Check if a review rule is relevant to the developer's stack.
 *
 * Returns true if:
 *   1. The rule description contains any stack keyword, OR
 *   2. The rule has no stack-specific terms (generic rules apply to all)
 *
 * Generic detection: a rule is considered generic if its description
 * does not contain any common technology terms.
 */
export function isStackRelevant(rule: ReviewRule, stackKeywords: string[]): boolean {
  const descLower = rule.description.toLowerCase();

  // Check if any stack keyword appears in the description
  for (const keyword of stackKeywords) {
    if (descLower.includes(keyword)) {
      return true;
    }
  }

  // Check if the rule is generic (no tech-specific terms)
  // If so, it applies to all stacks
  return isGenericRule(descLower);
}

/** Common tech terms that indicate a stack-specific rule. */
const TECH_TERMS = [
  // Frameworks
  "react",
  "next",
  "vue",
  "nuxt",
  "svelte",
  "angular",
  "remix",
  "astro",
  "express",
  "fastify",
  "hono",
  "nest",
  "koa",
  // Databases
  "postgres",
  "postgresql",
  "mysql",
  "sqlite",
  "mongodb",
  "redis",
  "supabase",
  "drizzle",
  "prisma",
  // Cloud
  "vercel",
  "aws",
  "gcp",
  "azure",
  "docker",
  "kubernetes",
  "lambda",
  "cloudflare",
  // Languages
  "typescript",
  "javascript",
  "python",
  "golang",
  "rust",
  // Styling
  "tailwind",
  "css-modules",
  "styled-components",
  // State
  "zustand",
  "redux",
  "jotai",
  "pinia",
  // Testing
  "vitest",
  "jest",
  "playwright",
  "cypress",
  // Other
  "graphql",
  "trpc",
  "webpack",
  "vite",
  "turbopack",
  "serverless",
];

/**
 * Returns true if the description contains no recognizable tech terms,
 * meaning the rule is generic and applies to all stacks.
 */
function isGenericRule(descLower: string): boolean {
  return !TECH_TERMS.some((term) => descLower.includes(term));
}
