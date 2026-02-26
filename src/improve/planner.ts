/**
 * Improvement planner — converts adversarial findings into improvement stories.
 *
 * Uses Claude to group related findings into stories, prioritize by severity,
 * and produce a Prd that the existing build pipeline can consume.
 */
import fs from "node:fs";
import path from "node:path";

import { sendMessage, isRetryableApiError } from "../shared/claude-client.js";
import { buildCacheableSystemPrompt } from "../shared/system-prompt-builder.js";
import { retry } from "../shared/retry.js";
import { resolveModel } from "../shared/model-router.js";
import type { DeveloperProfile, Prd, Story } from "../shared/types.js";
import type { AdversarialFinding } from "../review/adversarial/runner.js";
import type { CodebaseSnapshot, ImproveFocus } from "./analyzer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImprovementPlan {
  prd: Prd;
  themes: Record<string, number>;
}

export interface ImprovePlannerOptions {
  focus?: ImproveFocus;
  cycleNumber?: number;
  previousFindingIds?: string[];
}

// ---------------------------------------------------------------------------
// Prompt loading
// ---------------------------------------------------------------------------

const PROMPTS_DIR = fs.existsSync(path.resolve(import.meta.dirname, "prompts", "improve"))
  ? path.resolve(import.meta.dirname, "prompts", "improve")
  : path.resolve(import.meta.dirname, "..", "..", "prompts", "improve");

function loadSystemPrompt(): string {
  const promptPath = path.join(PROMPTS_DIR, "planner.md");
  return fs.readFileSync(promptPath, "utf-8");
}

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

function buildUserMessage(
  findings: AdversarialFinding[],
  snapshot: CodebaseSnapshot,
  projectName: string,
  cycleNumber: number,
  focus: ImproveFocus,
  previousFindingIds: string[],
): string {
  const parts: string[] = [];

  parts.push(`## Project: ${projectName}`);
  parts.push(`## Cycle: ${cycleNumber}`);
  parts.push(`## Focus: ${focus}`);
  parts.push("");

  // Codebase snapshot
  parts.push("## Codebase Snapshot");
  parts.push(`- Files: ${snapshot.totalFiles}`);
  parts.push(`- Lines: ${snapshot.totalLines}`);
  parts.push(`- Dependencies: ${snapshot.dependencyCount}`);
  parts.push(`- Has tests: ${snapshot.hasTests}`);
  parts.push(`- Has TypeScript: ${snapshot.hasTypecheck}`);
  parts.push(`- Languages: ${Object.entries(snapshot.languageBreakdown).map(([ext, count]) => `${ext}(${count})`).join(", ")}`);
  parts.push("");

  // Previously addressed findings
  if (previousFindingIds.length > 0) {
    parts.push(`## Previously Addressed Finding IDs`);
    parts.push(previousFindingIds.join(", "));
    parts.push("");
  }

  // Findings
  parts.push(`## Verified Findings (${findings.length})`);
  parts.push("");

  for (const f of findings) {
    parts.push(`### [${f.severity.toUpperCase()}] ${f.id}: ${f.title}`);
    parts.push(`- Source: ${f.source}`);
    if (f.file) parts.push(`- File: ${f.file}`);
    parts.push(`- Description: ${f.description}`);
    parts.push("");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateImprovementPrd(
  projectDir: string,
  findings: AdversarialFinding[],
  snapshot: CodebaseSnapshot,
  profile: DeveloperProfile,
  options?: ImprovePlannerOptions,
): Promise<ImprovementPlan> {
  const cycleNumber = options?.cycleNumber ?? 1;
  const focus = options?.focus ?? "all";
  const previousFindingIds = options?.previousFindingIds ?? [];

  const projectName = path.basename(projectDir);

  // Filter out previously addressed findings
  const activeFindings = previousFindingIds.length > 0
    ? findings.filter((f) => !previousFindingIds.includes(f.id))
    : findings;

  const systemPrompt = buildCacheableSystemPrompt(loadSystemPrompt());
  const userMessage = buildUserMessage(
    activeFindings,
    snapshot,
    projectName,
    cycleNumber,
    focus,
    previousFindingIds,
  );

  const model = resolveModel("analysis", profile);

  const response = await retry(
    () =>
      sendMessage({ model, maxTokens: 4096 }, systemPrompt, [
        { role: "user", content: userMessage },
      ]),
    { maxRetries: 1, isRetryable: isRetryableApiError },
  );

  // Parse JSON from response
  const jsonText = response.text.trim();
  const parsed = JSON.parse(jsonText) as Prd;

  // Ensure story IDs follow the imp-{cycle}.{N} pattern
  const stories: Story[] = parsed.userStories.map((s, i) => ({
    ...s,
    id: s.id || `imp-${cycleNumber}.${i + 1}`,
    passes: false,
  }));

  const prd: Prd = {
    project: parsed.project || projectName,
    branchName: parsed.branchName || `improve/cycle-${cycleNumber}`,
    description: parsed.description || `Improvement cycle ${cycleNumber}`,
    userStories: stories,
  };

  // Save to disk
  const boopDir = path.join(projectDir, ".boop");
  fs.mkdirSync(boopDir, { recursive: true });
  fs.writeFileSync(path.join(boopDir, "prd.json"), JSON.stringify(prd, null, 2), "utf-8");

  // Build themes from agent sources
  const themes: Record<string, number> = {};
  for (const s of stories) {
    // Use the first word of the title or "general" as theme
    const source = activeFindings.find((f) => s.notes?.includes(f.id))?.source ?? "general";
    themes[source] = (themes[source] ?? 0) + 1;
  }

  return { prd, themes };
}
