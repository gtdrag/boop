/**
 * Retrospective reporter — generates human-readable reports and memory YAML.
 *
 * Takes the structured {@link RetrospectiveData} from the analyzer and produces:
 *   1. retrospective.md — full project retrospective with statistics and analysis
 *   2. ~/.boop/memory/ YAML files — cross-project learnings keyed by pattern type
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { stringify } from "yaml";
import type { RetrospectiveData, EpicMetrics, FindingPattern } from "./analyzer.js";

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

/** Build the statistics summary table. */
function buildStatisticsSection(data: RetrospectiveData): string {
  const lines: string[] = [
    "## Build Statistics",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Epics | ${data.totalEpics} |`,
    `| Total Stories | ${data.totalStories} |`,
    `| Avg Files/Story | ${data.avgFilesPerStory.toFixed(1)} |`,
    `| Codebase Patterns | ${data.codebasePatterns.length} |`,
    `| Total Learnings | ${data.allLearnings.length} |`,
  ];

  if (data.mostComplexStory) {
    lines.push(
      `| Most Complex Story | ${data.mostComplexStory.storyId}: ${data.mostComplexStory.storyTitle} (${data.mostComplexStory.filesChanged} files) |`,
    );
  }

  return lines.join("\n");
}

/** Build the per-epic breakdown. */
function buildEpicBreakdown(epics: EpicMetrics[]): string {
  if (epics.length === 0) return "";

  const lines: string[] = ["## Per-Epic Breakdown", ""];

  for (const epic of epics) {
    lines.push(`### Epic ${epic.epicNumber}`);
    lines.push("");
    lines.push(`- Stories completed: ${epic.stories.length}`);

    const totalFiles = epic.stories.reduce((sum, s) => sum + s.filesChanged, 0);
    lines.push(`- Total files changed: ${totalFiles}`);

    if (Object.keys(epic.reviewFindings).length > 0) {
      lines.push("- Review findings:");
      for (const [agent, count] of Object.entries(epic.reviewFindings)) {
        lines.push(`  - ${agent}: ${count}`);
      }
    }

    if (epic.hadBlockingSeverity) {
      lines.push("- **Had blocking (critical/high) findings**");
    }

    if (epic.blockingIssues.length > 0) {
      lines.push("- Blocking issues:");
      for (const issue of epic.blockingIssues) {
        lines.push(`  - ${issue}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

/** Build the finding patterns analysis. */
function buildFindingPatterns(patterns: FindingPattern[]): string {
  if (patterns.length === 0) {
    return "## Review Finding Patterns\n\nNo review findings recorded.";
  }

  const lines: string[] = [
    "## Review Finding Patterns",
    "",
    "Most common categories across all epics:",
    "",
    "| Category | Total Findings |",
    "|----------|---------------|",
  ];

  for (const pattern of patterns) {
    lines.push(`| ${pattern.category} | ${pattern.count} |`);
  }

  return lines.join("\n");
}

/** Build the codebase patterns section. */
function buildCodebasePatterns(patterns: string[]): string {
  if (patterns.length === 0) {
    return "## Codebase Patterns Discovered\n\nNo codebase patterns recorded.";
  }

  const lines: string[] = [
    "## Codebase Patterns Discovered",
    "",
    `${patterns.length} patterns were discovered during the build:`,
    "",
  ];

  for (const pattern of patterns) {
    lines.push(`- ${pattern}`);
  }

  return lines.join("\n");
}

/** Build the improvement suggestions section. */
function buildImprovementSuggestions(data: RetrospectiveData): string {
  const suggestions: string[] = [];

  // High avg files per story → stories may be too large
  if (data.avgFilesPerStory > 10) {
    suggestions.push(
      "Consider breaking stories into smaller chunks — average files per story is high (" +
        data.avgFilesPerStory.toFixed(1) +
        ").",
    );
  }

  // Many review findings → code quality may need attention
  const totalFindings = data.topFindingPatterns.reduce((sum, p) => sum + p.count, 0);
  if (totalFindings > 20) {
    suggestions.push(
      `Total review findings (${totalFindings}) is high. Consider adding automated linting or stricter CI checks.`,
    );
  }

  // Security findings → add security gates earlier
  const securityFindings = data.topFindingPatterns.find((p) => p.category === "security-scan");
  if (securityFindings && securityFindings.count > 5) {
    suggestions.push(
      "Security findings are recurring. Consider running security scans during the build phase, not just review.",
    );
  }

  // Blocking epics → pipeline iteration needs improvement
  const blockingEpics = data.epics.filter((e) => e.hadBlockingSeverity);
  if (blockingEpics.length > 0) {
    suggestions.push(
      `${blockingEpics.length} epic(s) had blocking severity findings. ` +
        "Consider adding pre-review quality gates to catch issues earlier.",
    );
  }

  // Many learnings → pipeline is producing knowledge
  if (data.allLearnings.length > 20) {
    suggestions.push(
      `${data.allLearnings.length} learnings were captured. ` +
        "Review these for process improvements that can be automated.",
    );
  }

  if (suggestions.length === 0) {
    suggestions.push("No major improvement areas detected. Pipeline is running efficiently.");
  }

  const lines: string[] = ["## Pipeline Improvement Suggestions", ""];

  for (const suggestion of suggestions) {
    lines.push(`- ${suggestion}`);
  }

  return lines.join("\n");
}

/**
 * Generate the full retrospective markdown report.
 */
export function generateReport(data: RetrospectiveData): string {
  const sections: string[] = [
    `# Project Retrospective: ${data.projectName}`,
    "",
    `Generated: ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
    "",
    buildStatisticsSection(data),
    "",
    buildEpicBreakdown(data.epics),
    buildFindingPatterns(data.topFindingPatterns),
    "",
    buildCodebasePatterns(data.codebasePatterns),
    "",
    buildImprovementSuggestions(data),
    "",
  ];

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Memory YAML generation
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  /** Pattern type (e.g. "coding-pattern", "tool-gotcha", "review-finding"). */
  type: string;
  /** Short description. */
  description: string;
  /** Source project. */
  project: string;
  /** When this was recorded (ISO date). */
  date: string;
}

/**
 * Convert retrospective data to structured memory entries.
 */
export function buildMemoryEntries(data: RetrospectiveData): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const date = new Date().toISOString().slice(0, 10);

  // Learnings → coding patterns
  for (const learning of data.allLearnings) {
    entries.push({
      type: "coding-pattern",
      description: learning,
      project: data.projectName,
      date,
    });
  }

  // Review finding patterns → review findings
  for (const pattern of data.topFindingPatterns) {
    entries.push({
      type: "review-finding",
      description: `${pattern.category}: ${pattern.count} findings across ${data.totalEpics} epics`,
      project: data.projectName,
      date,
    });
  }

  // Pipeline suggestions → process improvements
  const avgFiles = data.avgFilesPerStory;
  if (avgFiles > 0) {
    entries.push({
      type: "process-metric",
      description: `Average ${avgFiles.toFixed(1)} files changed per story across ${data.totalStories} stories`,
      project: data.projectName,
      date,
    });
  }

  return entries;
}

/**
 * Save memory YAML to ~/.boop/memory/.
 */
export function saveMemory(entries: MemoryEntry[], memoryDir?: string): string {
  const dir = memoryDir ?? path.join(os.homedir(), ".boop", "memory");
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, "retrospective.yaml");
  const content = stringify(entries);
  fs.writeFileSync(filePath, content, "utf-8");

  return filePath;
}

// ---------------------------------------------------------------------------
// Save report to project
// ---------------------------------------------------------------------------

/**
 * Save the retrospective report to .boop/retrospective.md.
 */
export function saveReport(projectDir: string, report: string): string {
  const boopDir = path.join(projectDir, ".boop");
  fs.mkdirSync(boopDir, { recursive: true });

  const filePath = path.join(boopDir, "retrospective.md");
  fs.writeFileSync(filePath, report, "utf-8");

  return filePath;
}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

/**
 * Generate a concise summary for terminal output.
 */
export function formatSummary(data: RetrospectiveData): string {
  const lines: string[] = [
    `Project Retrospective: ${data.projectName}`,
    "",
    `  Epics completed:    ${data.totalEpics}`,
    `  Stories completed:   ${data.totalStories}`,
    `  Avg files/story:     ${data.avgFilesPerStory.toFixed(1)}`,
    `  Patterns discovered: ${data.codebasePatterns.length}`,
    `  Learnings captured:  ${data.allLearnings.length}`,
  ];

  if (data.mostComplexStory) {
    lines.push(
      `  Most complex story:  ${data.mostComplexStory.storyId} (${data.mostComplexStory.filesChanged} files)`,
    );
  }

  const totalFindings = data.topFindingPatterns.reduce((sum, p) => sum + p.count, 0);
  if (totalFindings > 0) {
    lines.push(`  Review findings:     ${totalFindings}`);
  }

  return lines.join("\n");
}
