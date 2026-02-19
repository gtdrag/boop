/**
 * Review rules — harness gap loop.
 *
 * After the adversarial loop completes, extracts finding patterns and
 * persists them as "review rules" in `~/.boop/memory/review-rules.yaml`.
 * Future reviews receive promoted rules as additional agent context,
 * making agents specifically look for recurring issues.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import type { FindingSeverity } from "../team-orchestrator.js";
import type { AdversarialAgentType, AdversarialFinding } from "./runner.js";
import type { AdversarialLoopResult } from "./loop.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewRule {
  /** Unique key: sourceAgent + slugified title. */
  key: string;
  /** Human-readable description of the pattern. */
  description: string;
  /** Severity level. */
  severity: FindingSeverity;
  /** Which agent originally found this. */
  sourceAgent: AdversarialAgentType;
  /** How many times this pattern has been seen across reviews. */
  timesSeen: number;
  /** Project names where this was seen. */
  projects: string[];
  /** ISO date string of first occurrence. */
  firstSeen: string;
  /** ISO date string of most recent occurrence. */
  lastSeen: string;
}

// ---------------------------------------------------------------------------
// Key normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a finding into a deduplication key.
 *
 * Format: `<agent>--<slugified-title>` where the title is lowercased,
 * trimmed, and non-alphanumeric chars replaced with dashes.
 */
export function normalizeToKey(source: AdversarialAgentType, title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${source}--${slug}`;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract rule candidates from an adversarial loop result.
 *
 * Collects all findings (fixed, deferred, unresolved), normalizes each
 * to a key, and groups by key. Each unique key becomes one candidate.
 */
export function extractRuleCandidates(
  loopResult: AdversarialLoopResult,
  projectName: string,
): ReviewRule[] {
  const now = new Date().toISOString();

  // Collect all findings from all iterations
  const allFindings: AdversarialFinding[] = [];

  for (const iter of loopResult.iterations) {
    for (const agentResult of iter.agentResults) {
      allFindings.push(...agentResult.findings);
    }
  }

  // Also include deferred and unresolved (they may already be in iterations,
  // but normalizeToKey will deduplicate)
  allFindings.push(...loopResult.deferredFindings);
  allFindings.push(...loopResult.unresolvedFindings);

  // Group by normalized key
  const grouped = new Map<string, { finding: AdversarialFinding; count: number }>();

  for (const finding of allFindings) {
    const key = normalizeToKey(finding.source, finding.title);
    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
    } else {
      grouped.set(key, { finding, count: 1 });
    }
  }

  // Convert to ReviewRule candidates
  const candidates: ReviewRule[] = [];
  for (const [key, { finding, count }] of grouped) {
    candidates.push({
      key,
      description: finding.description,
      severity: finding.severity,
      sourceAgent: finding.source,
      timesSeen: count,
      projects: [projectName],
      firstSeen: now,
      lastSeen: now,
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Merge new candidates into existing rules.
 *
 * Additive only — never removes or overwrites existing rules.
 * For matching keys: increments `timesSeen`, updates `lastSeen`,
 * and adds new project names.
 */
export function mergeRules(existing: ReviewRule[], candidates: ReviewRule[]): ReviewRule[] {
  const ruleMap = new Map<string, ReviewRule>();

  // Index existing rules
  for (const rule of existing) {
    ruleMap.set(rule.key, { ...rule });
  }

  // Merge candidates
  for (const candidate of candidates) {
    const found = ruleMap.get(candidate.key);
    if (found) {
      found.timesSeen += candidate.timesSeen;
      found.lastSeen = candidate.lastSeen;
      // Add new projects without duplicates
      for (const proj of candidate.projects) {
        if (!found.projects.includes(proj)) {
          found.projects.push(proj);
        }
      }
    } else {
      ruleMap.set(candidate.key, { ...candidate });
    }
  }

  return Array.from(ruleMap.values());
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

const DEFAULT_MEMORY_DIR = path.join(os.homedir(), ".boop", "memory");
const RULES_FILE = "review-rules.yaml";

/**
 * Load existing review rules from disk.
 * Returns an empty array if the file doesn't exist.
 */
export function loadReviewRules(memoryDir?: string): ReviewRule[] {
  const dir = memoryDir ?? DEFAULT_MEMORY_DIR;
  const filePath = path.join(dir, RULES_FILE);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ReviewRule[];
  } catch {
    return [];
  }
}

/**
 * Save review rules to disk. Creates the directory if needed.
 * Returns the file path where rules were saved.
 */
export function saveReviewRules(rules: ReviewRule[], memoryDir?: string): string {
  const dir = memoryDir ?? DEFAULT_MEMORY_DIR;
  const filePath = path.join(dir, RULES_FILE);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(rules), "utf-8");

  return filePath;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

const DEFAULT_PROMOTION_THRESHOLD = 2;
const MAX_RULES_PER_AGENT = 10;

/**
 * Build a prompt section for a specific agent from review rules.
 *
 * Only includes rules that:
 *   1. Were produced by the given `agentType`
 *   2. Have been seen at least `promotionThreshold` times (default: 2)
 *
 * Returns an empty string when no rules qualify (no prompt injection).
 * Caps at 10 rules per agent to avoid prompt bloat.
 */
export function buildRulesPromptSection(
  rules: ReviewRule[],
  agentType: AdversarialAgentType,
  promotionThreshold = DEFAULT_PROMOTION_THRESHOLD,
): string {
  const qualified = rules
    .filter((r) => r.sourceAgent === agentType && r.timesSeen >= promotionThreshold)
    .sort((a, b) => b.timesSeen - a.timesSeen)
    .slice(0, MAX_RULES_PER_AGENT);

  if (qualified.length === 0) return "";

  const lines: string[] = [
    "",
    "## Known Recurring Issues from Past Projects",
    "The following patterns have been found repeatedly in past reviews. Pay special attention to these:",
    "",
  ];

  for (let i = 0; i < qualified.length; i++) {
    const rule = qualified[i]!;
    const projectCount = rule.projects.length;
    lines.push(
      `${i + 1}. **${rule.description}** (severity: ${rule.severity}, seen ${rule.timesSeen} times across ${projectCount} project${projectCount === 1 ? "" : "s"})`,
    );
  }

  return lines.join("\n");
}
