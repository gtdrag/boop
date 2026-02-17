/**
 * BMAD story markdown parser.
 *
 * Parses the epic/story breakdown markdown produced by the planning
 * pipeline (src/planning/stories.ts) into structured TypeScript objects.
 */

// ---------------------------------------------------------------------------
// Parsed types
// ---------------------------------------------------------------------------

/** A single parsed story from the BMAD markdown. */
export interface ParsedStory {
  /** Story ID, e.g. "1.2". */
  id: string;
  /** Story title (text after "Story X.Y: "). */
  title: string;
  /** Full user story text ("As a … I want … so that …"). */
  userStory: string;
  /** Acceptance criteria lines (stripped of leading bullets/bold markers). */
  acceptanceCriteria: string[];
  /** Prerequisite story IDs, empty array if "None". */
  prerequisites: string[];
  /** Technical notes lines, empty array if section missing. */
  technicalNotes: string[];
}

/** A parsed epic containing its stories. */
export interface ParsedEpic {
  /** Epic number (1-based). */
  number: number;
  /** Epic name (text after "Epic N: "). */
  name: string;
  /** Epic goal (from **Goal:** line). */
  goal: string;
  /** Epic scope (from **Scope:** line). */
  scope: string;
  /** Ordered stories within this epic. */
  stories: ParsedStory[];
}

/** Top-level result from parsing BMAD story markdown. */
export interface ParsedBreakdown {
  /** Ordered epics. */
  epics: ParsedEpic[];
  /** Flat list of all stories across epics (convenience accessor). */
  allStories: ParsedStory[];
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Matches "## Epic N: Name" */
const EPIC_HEADING_RE = /^##\s+Epic\s+(\d+):\s+(.+)$/;

/** Matches "### Story N.M: Title" */
const STORY_HEADING_RE = /^###\s+Story\s+(\d+\.\d+):\s+(.+)$/;

/** Matches **Goal:** or **Scope:** key-value lines */
const META_LINE_RE = /^\*\*(\w+):\*\*\s*(.+)$/;

/** Matches section headers like **Acceptance Criteria:** */
const SECTION_HEADER_RE = /^\*\*([\w\s]+):\*\*\s*$/;

/** Matches bullet lines (- or * with optional bold given/when/then) */
const BULLET_RE = /^[-*]\s+(.+)$/;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip bold markdown markers from text. */
function stripBold(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/** Parse prerequisite text into an array of story IDs. */
function parsePrerequisites(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed || /^none$/i.test(trimmed)) return [];
  // Split on commas and/or spaces, keep only things that look like IDs
  return trimmed
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d+\.\d+$/.test(s));
}

/**
 * Detect which section a line belongs to based on content.
 * Returns the section name or null if not a section header.
 */
function detectSection(line: string): string | null {
  // Check for standalone section header: **Section Name:**
  const sectionMatch = line.match(SECTION_HEADER_RE);
  if (sectionMatch) return sectionMatch[1]!.trim().toLowerCase();

  // Check for inline key-value: **Key:** value
  const metaMatch = line.match(META_LINE_RE);
  if (metaMatch) return metaMatch[1]!.trim().toLowerCase();

  return null;
}

// ---------------------------------------------------------------------------
// Story parser
// ---------------------------------------------------------------------------

/**
 * Parse a block of lines that belong to a single story.
 * The first line should be the ### Story heading.
 */
function parseStoryBlock(lines: string[]): ParsedStory {
  const headingMatch = lines[0]!.match(STORY_HEADING_RE);
  if (!headingMatch) {
    throw new Error(`Expected story heading, got: ${lines[0]}`);
  }

  const id = headingMatch[1]!;
  const title = headingMatch[2]!.trim();

  let userStory = "";
  const acceptanceCriteria: string[] = [];
  const prerequisites: string[] = [];
  const technicalNotes: string[] = [];

  // State machine for which section we're currently reading
  type Section = "preamble" | "criteria" | "prerequisites" | "notes";
  let section: Section = "preamble";
  const userStoryLines: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect section transitions
    const sectionName = detectSection(trimmed);
    if (sectionName) {
      if (sectionName === "acceptance criteria") {
        section = "criteria";
        continue;
      }
      if (sectionName === "prerequisites") {
        section = "prerequisites";
        // Inline value: **Prerequisites:** 1.1, 1.2
        const metaMatch = trimmed.match(META_LINE_RE);
        if (metaMatch) {
          prerequisites.push(...parsePrerequisites(metaMatch[2]!));
        }
        continue;
      }
      if (sectionName === "technical notes") {
        section = "notes";
        continue;
      }
      // Other meta lines in preamble (like **Goal:** — shouldn't appear in story)
      continue;
    }

    switch (section) {
      case "preamble": {
        // Collect user story text (As a… I want… so that…)
        userStoryLines.push(stripBold(trimmed));
        break;
      }
      case "criteria": {
        const bulletMatch = trimmed.match(BULLET_RE);
        if (bulletMatch) {
          acceptanceCriteria.push(stripBold(bulletMatch[1]!.trim()));
        }
        break;
      }
      case "prerequisites": {
        // Bullet list of prerequisites (unusual but possible)
        const bulletMatch = trimmed.match(BULLET_RE);
        if (bulletMatch) {
          prerequisites.push(...parsePrerequisites(bulletMatch[1]!));
        }
        break;
      }
      case "notes": {
        const bulletMatch = trimmed.match(BULLET_RE);
        if (bulletMatch) {
          technicalNotes.push(bulletMatch[1]!.trim());
        }
        break;
      }
    }
  }

  userStory = userStoryLines.join(" ").trim();

  return {
    id,
    title,
    userStory,
    acceptanceCriteria,
    prerequisites,
    technicalNotes,
  };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse BMAD story markdown into structured data.
 *
 * Accepts the raw markdown string produced by the planning pipeline's
 * story generation phase. Handles variations in formatting (bold markers,
 * different bullet styles, multi-line user stories, optional sections).
 *
 * @param markdown - The raw epic/story breakdown markdown text.
 * @returns Parsed breakdown with epics and a flat story list.
 * @throws If the markdown contains no parseable epics or stories.
 */
export function parseStoryMarkdown(markdown: string): ParsedBreakdown {
  const lines = markdown.split("\n");
  const epics: ParsedEpic[] = [];

  let currentEpic: ParsedEpic | null = null;
  let currentStoryLines: string[] | null = null;

  function flushStory() {
    if (currentStoryLines && currentEpic) {
      const story = parseStoryBlock(currentStoryLines);
      currentEpic.stories.push(story);
    }
    currentStoryLines = null;
  }

  function flushEpic() {
    flushStory();
    if (currentEpic) {
      epics.push(currentEpic);
    }
    currentEpic = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for epic heading
    const epicMatch = trimmed.match(EPIC_HEADING_RE);
    if (epicMatch) {
      flushEpic();
      currentEpic = {
        number: Number.parseInt(epicMatch[1]!, 10),
        name: epicMatch[2]!.trim(),
        goal: "",
        scope: "",
        stories: [],
      };
      continue;
    }

    // Check for story heading
    const storyMatch = trimmed.match(STORY_HEADING_RE);
    if (storyMatch) {
      flushStory();
      currentStoryLines = [trimmed];
      continue;
    }

    // If we're inside an epic but not yet in a story, check for goal/scope
    if (currentEpic && !currentStoryLines) {
      const metaMatch = trimmed.match(META_LINE_RE);
      if (metaMatch) {
        const key = metaMatch[1]!.toLowerCase();
        if (key === "goal") currentEpic.goal = metaMatch[2]!.trim();
        if (key === "scope") currentEpic.scope = metaMatch[2]!.trim();
      }
      continue;
    }

    // If we're inside a story, accumulate lines
    if (currentStoryLines) {
      // Stop accumulating at horizontal rules (story separator)
      if (/^---+$/.test(trimmed)) continue;
      currentStoryLines.push(line);
    }
  }

  // Flush remaining
  flushEpic();

  if (epics.length === 0) {
    throw new Error("No epics found in BMAD story markdown");
  }

  const allStories = epics.flatMap((e) => e.stories);
  if (allStories.length === 0) {
    throw new Error("No stories found in BMAD story markdown");
  }

  return { epics, allStories };
}
