/**
 * Outcome injector — filters high-frequency review rules and injects
 * prevention guidance into planning system prompts.
 *
 * When adversarial review keeps finding the same issues (tracked by
 * `ReviewRule.timesSeen`), this module formats those rules as a
 * "Lessons from Past Reviews" section that gets appended to planning
 * prompts at runtime.
 */
import type { PlanningSubPhase } from "../shared/types.js";
import type { DeveloperProfile } from "../profile/schema.js";
import type { ReviewRule } from "../review/adversarial/review-rules.js";
import { extractStackKeywords, isStackRelevant } from "./stack-matcher.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutcomeInjection {
  targetPhase: PlanningSubPhase;
  section: string;
  sourceRuleKeys: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLD = 3;
const MAX_RULES_IN_SECTION = 12;

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Filter rules by frequency threshold and stack relevance.
 *
 * Returns rules that:
 *   1. Have been seen at least `threshold` times (default: 3)
 *   2. Are relevant to the developer's stack (via isStackRelevant)
 *
 * Results are sorted by timesSeen descending, then severity priority.
 */
export function getRelevantRules(
  rules: ReviewRule[],
  profile: DeveloperProfile,
  threshold = DEFAULT_THRESHOLD,
): ReviewRule[] {
  const stackKeywords = extractStackKeywords(profile);

  return rules
    .filter((r) => r.timesSeen >= threshold && isStackRelevant(r, stackKeywords))
    .sort((a, b) => {
      // Sort by timesSeen descending
      if (b.timesSeen !== a.timesSeen) return b.timesSeen - a.timesSeen;
      // Then by severity priority
      return severityOrder(a.severity) - severityOrder(b.severity);
    });
}

/**
 * Build a "Lessons from Past Reviews" markdown section from filtered rules.
 *
 * Groups rules by severity. Truncates by dropping lowest-timesSeen rules
 * if the section exceeds MAX_RULES_IN_SECTION entries.
 *
 * Returns empty string if no rules qualify.
 */
export function buildOutcomeSection(rules: ReviewRule[], phase: PlanningSubPhase): string {
  if (rules.length === 0) return "";

  const truncated = rules.slice(0, MAX_RULES_IN_SECTION);

  // Group by severity
  const grouped = new Map<string, ReviewRule[]>();
  for (const rule of truncated) {
    const sev = rule.severity;
    const list = grouped.get(sev) ?? [];
    list.push(rule);
    grouped.set(sev, list);
  }

  const lines: string[] = [
    "",
    `## Lessons from Past Reviews (${phase})`,
    "",
    "The following issues have been found repeatedly in past project reviews.",
    "Proactively address these patterns in your output:",
    "",
  ];

  // Output in severity order
  const severityOrder: string[] = ["critical", "high", "medium", "low", "info"];
  for (const sev of severityOrder) {
    const group = grouped.get(sev);
    if (!group || group.length === 0) continue;

    lines.push(`### ${capitalize(sev)} Issues`);
    lines.push("");
    for (const rule of group) {
      lines.push(
        `- **${rule.description}** (seen ${rule.timesSeen} times across ${rule.projects.length} project${rule.projects.length === 1 ? "" : "s"})`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Augment a planning system prompt with outcome-based lessons.
 *
 * Filters rules by threshold and stack relevance, builds the section,
 * and appends it to the base prompt. Returns the original prompt
 * unchanged when nothing qualifies.
 */
export function augmentPrompt(
  basePrompt: string,
  rules: ReviewRule[],
  phase: PlanningSubPhase,
  profile: DeveloperProfile,
): string {
  const relevant = getRelevantRules(rules, profile);
  if (relevant.length === 0) return basePrompt;

  const section = buildOutcomeSection(relevant, phase);
  if (section.length === 0) return basePrompt;

  return basePrompt + "\n" + section;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function severityOrder(severity: string): number {
  return SEVERITY_ORDER[severity] ?? 5;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
