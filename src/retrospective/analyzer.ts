/**
 * Retrospective analyzer — aggregates build history into structured metrics.
 *
 * Walks the full build history after the final epic's sign-off:
 *   - progress.txt for story entries and codebase patterns
 *   - .boop/reviews/epic-{N}/ for review agent reports
 *   - git log for iteration counts
 *   - Pipeline state for timeline data
 *
 * Produces a {@link RetrospectiveData} that the reporter turns into
 * human-readable output and cross-project memory YAML.
 */
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoryMetrics {
  /** Story ID (e.g. "3.2"). */
  storyId: string;
  /** Story title. */
  storyTitle: string;
  /** Number of bullet points in the progress entry (proxy for effort). */
  summaryLines: number;
  /** Number of files changed. */
  filesChanged: number;
  /** Learnings discovered during implementation. */
  learnings: string[];
}

export interface EpicMetrics {
  /** Epic number. */
  epicNumber: number;
  /** Stories in this epic. */
  stories: StoryMetrics[];
  /** Review findings by category (agent name → finding count). */
  reviewFindings: Record<string, number>;
  /** Blocking issues found during review. */
  blockingIssues: string[];
  /** Whether the review had critical/high severity findings. */
  hadBlockingSeverity: boolean;
}

export interface FindingPattern {
  /** Finding category (e.g. "security-scan", "gap-analysis"). */
  category: string;
  /** Number of occurrences across all epics. */
  count: number;
}

export interface RetrospectiveData {
  /** Project name. */
  projectName: string;
  /** Total number of epics completed. */
  totalEpics: number;
  /** Total number of stories completed. */
  totalStories: number;
  /** Per-epic breakdown. */
  epics: EpicMetrics[];
  /** Most common review finding categories across all epics. */
  topFindingPatterns: FindingPattern[];
  /** All codebase patterns discovered during the build. */
  codebasePatterns: string[];
  /** All learnings aggregated across stories. */
  allLearnings: string[];
  /** Story with the most files changed (highest complexity). */
  mostComplexStory: StoryMetrics | null;
  /** Average files changed per story. */
  avgFilesPerStory: number;
}

// ---------------------------------------------------------------------------
// Progress parsing
// ---------------------------------------------------------------------------

/** Parse a progress.txt entry block into StoryMetrics. */
export function parseProgressEntry(block: string): StoryMetrics | null {
  // Header: ## DATE - Story ID: Title
  const headerMatch = block.match(
    /^## .+ - Story ([\d.]+):\s*(.+)$/m,
  );
  if (!headerMatch) return null;

  const storyId = headerMatch[1]!;
  const storyTitle = headerMatch[2]!.trim();

  // Count summary bullet lines (- lines not under **Learnings**)
  const lines = block.split("\n");
  let inLearnings = false;
  let summaryLines = 0;
  const filesChanged: string[] = [];
  const learnings: string[] = [];

  for (const line of lines) {
    if (line.startsWith("- **Learnings")) {
      inLearnings = true;
      continue;
    }
    if (line.startsWith("---")) continue;
    if (line.startsWith("## ")) continue;

    if (inLearnings && line.startsWith("  - ")) {
      learnings.push(line.replace(/^\s+-\s*/, ""));
    } else if (!inLearnings && line.startsWith("- Files changed:")) {
      const fileList = line.replace("- Files changed: ", "").split(",").map((f) => f.trim());
      filesChanged.push(...fileList);
    } else if (!inLearnings && line.startsWith("- ")) {
      summaryLines++;
    }
  }

  return {
    storyId,
    storyTitle,
    summaryLines,
    filesChanged: filesChanged.length,
    learnings,
  };
}

/** Split progress.txt content into individual entry blocks. */
export function splitProgressEntries(content: string): string[] {
  // Split on `## DATE - Story` headers (keep the header with the block)
  const blocks: string[] = [];
  const regex = /^## \d{4}-\d{2}-\d{2} .+ - Story /m;

  let remaining = content;

  // Skip the codebase patterns section at the top
  const patternsEnd = remaining.indexOf("\n## 2");
  if (patternsEnd > 0 && remaining.startsWith("## Codebase Patterns")) {
    remaining = remaining.slice(patternsEnd);
  }

  while (remaining.length > 0) {
    const match = regex.exec(remaining);
    if (!match) break;

    const start = match.index;
    // Find the next entry
    const afterStart = remaining.slice(start + 1);
    const nextMatch = regex.exec(afterStart);

    if (nextMatch) {
      blocks.push(remaining.slice(start, start + 1 + nextMatch.index).trim());
      remaining = remaining.slice(start + 1 + nextMatch.index);
    } else {
      blocks.push(remaining.slice(start).trim());
      break;
    }
  }

  return blocks;
}

/** Extract the codebase patterns section from progress.txt. */
export function extractPatterns(content: string): string[] {
  const headerIdx = content.indexOf("## Codebase Patterns");
  if (headerIdx === -1) return [];

  const afterHeader = content.indexOf("\n", headerIdx);
  if (afterHeader === -1) return [];

  const rest = content.slice(afterHeader + 1);
  const patterns: string[] = [];

  for (const line of rest.split("\n")) {
    if (line.startsWith("- ")) {
      patterns.push(line.replace(/^- /, ""));
    } else if (!line.startsWith("  ") && line.trim().length > 0) {
      break;
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Review data parsing
// ---------------------------------------------------------------------------

/**
 * Count findings in a review report markdown file.
 * Looks for lines with severity markers: [critical], [high], [medium], [low], [info].
 */
export function countFindingsInReport(reportContent: string): number {
  const severityPattern = /\[(critical|high|medium|low|info)\]/gi;
  const matches = reportContent.match(severityPattern);
  return matches?.length ?? 0;
}

/** Check if a review report has blocking-severity findings. */
export function hasBlockingFindings(reportContent: string): boolean {
  return /\[(critical|high)\]/i.test(reportContent);
}

/** Read all review reports for an epic from .boop/reviews/epic-{N}/. */
export function readEpicReviews(
  projectDir: string,
  epicNumber: number,
): Record<string, string> {
  const reviewDir = path.join(projectDir, ".boop", "reviews", `epic-${epicNumber}`);
  const reports: Record<string, string> = {};

  try {
    const files = fs.readdirSync(reviewDir);
    for (const file of files) {
      if (file.endsWith(".md")) {
        const filePath = path.join(reviewDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          reports[file.replace(".md", "")] = fs.readFileSync(filePath, "utf-8");
        }
      }
    }
  } catch {
    // Review dir may not exist for every epic
  }

  // Also check qa-smoke-test subdirectory
  try {
    const qaDir = path.join(reviewDir, "qa-smoke-test");
    const qaFiles = fs.readdirSync(qaDir);
    for (const file of qaFiles) {
      if (file.endsWith(".md")) {
        reports["qa-smoke-test"] = fs.readFileSync(path.join(qaDir, file), "utf-8");
      }
    }
  } catch {
    // QA dir may not exist
  }

  return reports;
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export interface AnalyzeOptions {
  /** Absolute path to the project root. */
  projectDir: string;
  /** Path to progress.txt (defaults to .boop/progress.txt). */
  progressPath?: string;
  /** Project name. */
  projectName?: string;
  /** Total number of epics to scan for review data. */
  totalEpics?: number;
}

/**
 * Run the full retrospective analysis.
 *
 * Reads progress.txt + review reports and produces structured metrics.
 */
export function analyze(options: AnalyzeOptions): RetrospectiveData {
  const {
    projectDir,
    progressPath = path.join(projectDir, ".boop", "progress.txt"),
    projectName = "Boop Project",
    totalEpics = 0,
  } = options;

  // Read and parse progress entries
  let progressContent = "";
  try {
    progressContent = fs.readFileSync(progressPath, "utf-8");
  } catch {
    // No progress file — empty analysis
  }

  const entryBlocks = splitProgressEntries(progressContent);
  const storyMetrics = entryBlocks
    .map(parseProgressEntry)
    .filter((e): e is StoryMetrics => e !== null);

  // Extract codebase patterns
  const codebasePatterns = extractPatterns(progressContent);

  // Aggregate all learnings
  const allLearnings = storyMetrics.flatMap((s) => s.learnings);

  // Detect epic count from story IDs if not provided
  const epicNumbers = new Set(
    storyMetrics.map((s) => {
      const epicNum = Number.parseInt(s.storyId.split(".")[0]!, 10);
      return Number.isNaN(epicNum) ? 0 : epicNum;
    }),
  );
  const maxEpic = Math.max(totalEpics, ...epicNumbers, 0);

  // Build per-epic metrics
  const epics: EpicMetrics[] = [];
  for (let e = 1; e <= maxEpic; e++) {
    const epicStories = storyMetrics.filter(
      (s) => Number.parseInt(s.storyId.split(".")[0]!, 10) === e,
    );

    // Read review reports
    const reviewReports = readEpicReviews(projectDir, e);
    const reviewFindings: Record<string, number> = {};
    let hadBlockingSeverity = false;
    const blockingIssues: string[] = [];

    for (const [agentName, report] of Object.entries(reviewReports)) {
      const count = countFindingsInReport(report);
      if (count > 0) {
        reviewFindings[agentName] = count;
      }
      if (hasBlockingFindings(report)) {
        hadBlockingSeverity = true;
        blockingIssues.push(`${agentName} had critical/high findings`);
      }
    }

    epics.push({
      epicNumber: e,
      stories: epicStories,
      reviewFindings,
      blockingIssues,
      hadBlockingSeverity,
    });
  }

  // Top finding patterns across all epics
  const findingCounts: Record<string, number> = {};
  for (const epic of epics) {
    for (const [cat, count] of Object.entries(epic.reviewFindings)) {
      findingCounts[cat] = (findingCounts[cat] ?? 0) + count;
    }
  }
  const topFindingPatterns = Object.entries(findingCounts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // Most complex story (by files changed)
  const mostComplexStory =
    storyMetrics.length > 0
      ? storyMetrics.reduce((max, s) =>
          s.filesChanged > max.filesChanged ? s : max,
        )
      : null;

  // Average files per story
  const totalFiles = storyMetrics.reduce((sum, s) => sum + s.filesChanged, 0);
  const avgFilesPerStory =
    storyMetrics.length > 0 ? totalFiles / storyMetrics.length : 0;

  return {
    projectName,
    totalEpics: maxEpic,
    totalStories: storyMetrics.length,
    epics,
    topFindingPatterns,
    codebasePatterns,
    allLearnings,
    mostComplexStory,
    avgFilesPerStory,
  };
}
