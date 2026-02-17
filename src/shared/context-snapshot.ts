/**
 * Context snapshot — structured state capture for agent session handoffs.
 *
 * Replaces lossy prose summaries with machine-readable JSON snapshots.
 * Each session writes a snapshot on exit; the next session reads the
 * latest snapshot to reconstruct context without re-reading everything.
 *
 * Snapshots are append-only: each session writes a new file, never
 * overwrites previous snapshots.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Test suite result summary (no full output — just counts). */
export interface SnapshotTestResult {
  passed: boolean;
  totalTests: number;
  failedTests: number;
  failingNames: string[];
}

/** A single decision recorded during the session. */
export interface SnapshotDecision {
  key: string;
  value: string;
  reason?: string;
}

/** A blocker that was hit and (optionally) resolved. */
export interface SnapshotBlocker {
  description: string;
  resolved: boolean;
  resolution?: string;
}

/**
 * Structured context snapshot — the complete handoff state from one
 * agent session to the next.
 */
export interface ContextSnapshot {
  /** Unique session identifier. */
  sessionId: string;
  /** ISO-8601 timestamp when the snapshot was created. */
  timestamp: string;
  /** Pipeline phase this snapshot was taken in. */
  phase: "BUILDING" | "REVIEWING" | "DEPLOYING";
  /** Epic number being worked on. */
  epicNumber: number;
  /** Story ID (for build phase snapshots). */
  storyId?: string;
  /** Review iteration number (for review phase snapshots). */
  reviewIteration?: number;

  // --- Work performed ---

  /** Files created or modified during this session (paths relative to project root). */
  filesChanged: string[];
  /** Test results at the end of this session. */
  testResult?: SnapshotTestResult;

  // --- Knowledge ---

  /** Key decisions made during the session. */
  decisions: SnapshotDecision[];
  /** Blockers hit (and resolutions if resolved). */
  blockers: SnapshotBlocker[];

  // --- Review-specific ---

  /** Findings discovered (review phase). */
  findingsCount?: number;
  /** Findings auto-fixed. */
  fixedCount?: number;
  /** Findings discarded by verifier. */
  discardedCount?: number;
  /** IDs of unresolved findings. */
  unresolvedIds?: string[];
  /** Commit SHAs of fixes applied this iteration. */
  fixCommits?: string[];

  // --- Freeform ---

  /** Anything that doesn't fit structured fields. Keep brief. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** Default snapshot directory within the project. */
function snapshotDir(projectDir: string): string {
  return path.join(projectDir, ".boop", "snapshots");
}

/** Generate a short unique session ID. */
export function generateSessionId(): string {
  return crypto.randomBytes(6).toString("hex");
}

/**
 * Write a snapshot to disk.
 *
 * File: `.boop/snapshots/snapshot-{sessionId}.json`
 * Append-only — each call writes a new file.
 */
export function writeSnapshot(projectDir: string, snapshot: ContextSnapshot): string {
  const dir = snapshotDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `snapshot-${snapshot.sessionId}.json`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");

  return filePath;
}

/**
 * Read a specific snapshot by session ID.
 * Returns null if the snapshot doesn't exist.
 */
export function readSnapshot(projectDir: string, sessionId: string): ContextSnapshot | null {
  const filePath = path.join(snapshotDir(projectDir), `snapshot-${sessionId}.json`);

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ContextSnapshot;
  } catch {
    return null;
  }
}

/**
 * Read the most recent snapshot for a given phase and epic.
 *
 * Scans the snapshot directory, filters by phase/epic, and returns the
 * one with the latest timestamp. Returns null if no matching snapshot.
 */
export function readLatestSnapshot(
  projectDir: string,
  phase: ContextSnapshot["phase"],
  epicNumber: number,
): ContextSnapshot | null {
  const dir = snapshotDir(projectDir);

  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir).filter((f) => f.startsWith("snapshot-") && f.endsWith(".json"));

  let latest: ContextSnapshot | null = null;
  let latestTime = "";

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const snap = JSON.parse(raw) as ContextSnapshot;

      if (snap.phase === phase && snap.epicNumber === epicNumber) {
        if (snap.timestamp > latestTime) {
          latest = snap;
          latestTime = snap.timestamp;
        }
      }
    } catch {
      // Skip corrupt snapshot files
    }
  }

  return latest;
}

/**
 * Read all snapshots for a given phase and epic, sorted by timestamp ascending.
 */
export function readAllSnapshots(
  projectDir: string,
  phase: ContextSnapshot["phase"],
  epicNumber: number,
): ContextSnapshot[] {
  const dir = snapshotDir(projectDir);

  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.startsWith("snapshot-") && f.endsWith(".json"));

  const snapshots: ContextSnapshot[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const snap = JSON.parse(raw) as ContextSnapshot;
      if (snap.phase === phase && snap.epicNumber === epicNumber) {
        snapshots.push(snap);
      }
    } catch {
      // Skip corrupt files
    }
  }

  return snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ---------------------------------------------------------------------------
// Formatting for prompt injection
// ---------------------------------------------------------------------------

/**
 * Format a snapshot as an XML block suitable for injection into a
 * system prompt. Structured so an agent can parse it, not just read it.
 *
 * Target: ~2000 tokens max (concise paths, counts not content).
 */
export function formatSnapshotForPrompt(snapshot: ContextSnapshot): string {
  const lines: string[] = [];

  lines.push("<context-snapshot>");
  lines.push(`  <session>${snapshot.sessionId}</session>`);
  lines.push(`  <timestamp>${snapshot.timestamp}</timestamp>`);
  lines.push(`  <phase>${snapshot.phase}</phase>`);
  lines.push(`  <epic>${snapshot.epicNumber}</epic>`);

  if (snapshot.storyId) {
    lines.push(`  <story>${snapshot.storyId}</story>`);
  }
  if (snapshot.reviewIteration !== undefined) {
    lines.push(`  <review-iteration>${snapshot.reviewIteration}</review-iteration>`);
  }

  // Files changed (paths only)
  if (snapshot.filesChanged.length > 0) {
    lines.push("  <files-changed>");
    for (const f of snapshot.filesChanged) {
      lines.push(`    <file>${f}</file>`);
    }
    lines.push("  </files-changed>");
  }

  // Test results
  if (snapshot.testResult) {
    const t = snapshot.testResult;
    lines.push(
      `  <test-result passed="${t.passed}" total="${t.totalTests}" failed="${t.failedTests}">`,
    );
    for (const name of t.failingNames) {
      lines.push(`    <failing>${name}</failing>`);
    }
    lines.push("  </test-result>");
  }

  // Decisions
  if (snapshot.decisions.length > 0) {
    lines.push("  <decisions>");
    for (const d of snapshot.decisions) {
      lines.push(`    <decision key="${d.key}">${d.value}</decision>`);
    }
    lines.push("  </decisions>");
  }

  // Blockers
  if (snapshot.blockers.length > 0) {
    lines.push("  <blockers>");
    for (const b of snapshot.blockers) {
      const status = b.resolved ? "resolved" : "open";
      lines.push(
        `    <blocker status="${status}">${b.description}${b.resolution ? ` → ${b.resolution}` : ""}</blocker>`,
      );
    }
    lines.push("  </blockers>");
  }

  // Review-specific
  if (snapshot.findingsCount !== undefined) {
    lines.push(
      `  <review-stats findings="${snapshot.findingsCount}" fixed="${snapshot.fixedCount ?? 0}" discarded="${snapshot.discardedCount ?? 0}">`,
    );
    if (snapshot.unresolvedIds && snapshot.unresolvedIds.length > 0) {
      lines.push(`    <unresolved>${snapshot.unresolvedIds.join(", ")}</unresolved>`);
    }
    if (snapshot.fixCommits && snapshot.fixCommits.length > 0) {
      lines.push(`    <fix-commits>${snapshot.fixCommits.join(", ")}</fix-commits>`);
    }
    lines.push("  </review-stats>");
  }

  // Notes
  if (snapshot.notes) {
    lines.push(`  <notes>${snapshot.notes}</notes>`);
  }

  lines.push("</context-snapshot>");

  return lines.join("\n");
}
