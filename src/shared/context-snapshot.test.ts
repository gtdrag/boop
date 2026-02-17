import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  writeSnapshot,
  readSnapshot,
  readLatestSnapshot,
  readAllSnapshots,
  generateSessionId,
  formatSnapshotForPrompt,
} from "./context-snapshot.js";
import type { ContextSnapshot } from "./context-snapshot.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSnapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    sessionId: generateSessionId(),
    timestamp: new Date().toISOString(),
    phase: "BUILDING",
    epicNumber: 1,
    filesChanged: ["src/foo.ts", "src/bar.ts"],
    decisions: [],
    blockers: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateSessionId
// ---------------------------------------------------------------------------

describe("generateSessionId", () => {
  it("returns a 12-char hex string", () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[a-f0-9]{12}$/);
  });

  it("returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// writeSnapshot / readSnapshot
// ---------------------------------------------------------------------------

describe("writeSnapshot / readSnapshot", () => {
  it("writes and reads a snapshot", () => {
    const snap = makeSnapshot({ sessionId: "abc123def456" });
    const filePath = writeSnapshot(tmpDir, snap);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toContain("snapshot-abc123def456.json");

    const read = readSnapshot(tmpDir, "abc123def456");
    expect(read).not.toBeNull();
    expect(read!.sessionId).toBe("abc123def456");
    expect(read!.phase).toBe("BUILDING");
    expect(read!.filesChanged).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("readSnapshot returns null for missing snapshot", () => {
    const read = readSnapshot(tmpDir, "nonexistent");
    expect(read).toBeNull();
  });

  it("creates the snapshots directory if missing", () => {
    const snap = makeSnapshot();
    writeSnapshot(tmpDir, snap);

    expect(fs.existsSync(path.join(tmpDir, ".boop", "snapshots"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readLatestSnapshot
// ---------------------------------------------------------------------------

describe("readLatestSnapshot", () => {
  it("returns the most recent snapshot for a phase/epic", () => {
    const old = makeSnapshot({
      sessionId: "aaa000000000",
      timestamp: "2026-01-01T00:00:00.000Z",
      storyId: "1.1",
    });
    const newer = makeSnapshot({
      sessionId: "bbb000000000",
      timestamp: "2026-01-02T00:00:00.000Z",
      storyId: "1.2",
    });

    writeSnapshot(tmpDir, old);
    writeSnapshot(tmpDir, newer);

    const latest = readLatestSnapshot(tmpDir, "BUILDING", 1);
    expect(latest).not.toBeNull();
    expect(latest!.sessionId).toBe("bbb000000000");
    expect(latest!.storyId).toBe("1.2");
  });

  it("filters by phase", () => {
    const buildSnap = makeSnapshot({ phase: "BUILDING" });
    const reviewSnap = makeSnapshot({ phase: "REVIEWING" });

    writeSnapshot(tmpDir, buildSnap);
    writeSnapshot(tmpDir, reviewSnap);

    const latest = readLatestSnapshot(tmpDir, "REVIEWING", 1);
    expect(latest).not.toBeNull();
    expect(latest!.phase).toBe("REVIEWING");
  });

  it("filters by epic number", () => {
    const epic1 = makeSnapshot({ epicNumber: 1 });
    const epic2 = makeSnapshot({ epicNumber: 2 });

    writeSnapshot(tmpDir, epic1);
    writeSnapshot(tmpDir, epic2);

    const latest = readLatestSnapshot(tmpDir, "BUILDING", 2);
    expect(latest).not.toBeNull();
    expect(latest!.epicNumber).toBe(2);
  });

  it("returns null when no snapshots exist", () => {
    const latest = readLatestSnapshot(tmpDir, "BUILDING", 1);
    expect(latest).toBeNull();
  });

  it("returns null when no snapshots match", () => {
    writeSnapshot(tmpDir, makeSnapshot({ phase: "BUILDING", epicNumber: 1 }));

    const latest = readLatestSnapshot(tmpDir, "REVIEWING", 1);
    expect(latest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readAllSnapshots
// ---------------------------------------------------------------------------

describe("readAllSnapshots", () => {
  it("returns all matching snapshots sorted by timestamp", () => {
    const snap1 = makeSnapshot({
      sessionId: "aaa000000001",
      timestamp: "2026-01-03T00:00:00.000Z",
    });
    const snap2 = makeSnapshot({
      sessionId: "aaa000000002",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const snap3 = makeSnapshot({
      sessionId: "aaa000000003",
      timestamp: "2026-01-02T00:00:00.000Z",
    });

    writeSnapshot(tmpDir, snap1);
    writeSnapshot(tmpDir, snap2);
    writeSnapshot(tmpDir, snap3);

    const all = readAllSnapshots(tmpDir, "BUILDING", 1);
    expect(all).toHaveLength(3);
    // Sorted by timestamp ascending
    expect(all[0]!.sessionId).toBe("aaa000000002");
    expect(all[1]!.sessionId).toBe("aaa000000003");
    expect(all[2]!.sessionId).toBe("aaa000000001");
  });

  it("returns empty array when no matches", () => {
    const all = readAllSnapshots(tmpDir, "BUILDING", 1);
    expect(all).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatSnapshotForPrompt
// ---------------------------------------------------------------------------

describe("formatSnapshotForPrompt", () => {
  it("formats a build snapshot as XML", () => {
    const xml = formatSnapshotForPrompt(
      makeSnapshot({
        sessionId: "test123",
        storyId: "1.3",
        filesChanged: ["src/index.ts"],
        testResult: {
          passed: true,
          totalTests: 42,
          failedTests: 0,
          failingNames: [],
        },
        decisions: [{ key: "orm", value: "drizzle", reason: "lighter" }],
      }),
    );

    expect(xml).toContain("<context-snapshot>");
    expect(xml).toContain("<session>test123</session>");
    expect(xml).toContain("<story>1.3</story>");
    expect(xml).toContain("<file>src/index.ts</file>");
    expect(xml).toContain('passed="true"');
    expect(xml).toContain('total="42"');
    expect(xml).toContain('<decision key="orm">drizzle</decision>');
    expect(xml).toContain("</context-snapshot>");
  });

  it("formats a review snapshot with findings", () => {
    const xml = formatSnapshotForPrompt(
      makeSnapshot({
        phase: "REVIEWING",
        reviewIteration: 2,
        findingsCount: 5,
        fixedCount: 3,
        discardedCount: 1,
        unresolvedIds: ["cq-1"],
        fixCommits: ["abc1234"],
      }),
    );

    expect(xml).toContain("<review-iteration>2</review-iteration>");
    expect(xml).toContain('findings="5"');
    expect(xml).toContain('fixed="3"');
    expect(xml).toContain("<unresolved>cq-1</unresolved>");
    expect(xml).toContain("<fix-commits>abc1234</fix-commits>");
  });

  it("includes blockers", () => {
    const xml = formatSnapshotForPrompt(
      makeSnapshot({
        blockers: [
          { description: "Port conflict", resolved: true, resolution: "Stopped PG16" },
          { description: "Missing dep", resolved: false },
        ],
      }),
    );

    expect(xml).toContain('status="resolved"');
    expect(xml).toContain("Port conflict → Stopped PG16");
    expect(xml).toContain('status="open"');
    expect(xml).toContain("Missing dep");
  });

  it("omits empty sections", () => {
    const xml = formatSnapshotForPrompt(
      makeSnapshot({
        filesChanged: [],
        decisions: [],
        blockers: [],
      }),
    );

    expect(xml).not.toContain("<files-changed>");
    expect(xml).not.toContain("<decisions>");
    expect(xml).not.toContain("<blockers>");
  });
});
