/**
 * Tests for gauntlet note collector.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectNotes, generateTierReport } from "./note-collector.js";
import type { GauntletTierResult } from "./types.js";

describe("note-collector", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauntlet-notes-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- collectNotes ---
  it("returns a struggle note if .boop/ does not exist", () => {
    const notes = collectNotes("t1", path.join(tmpDir, "nonexistent"));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.category).toBe("struggle");
    expect(notes[0]!.phase).toBe("setup");
  });

  it("returns a struggle note if planning dir is missing", () => {
    const projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(path.join(projectDir, ".boop"), { recursive: true });

    const notes = collectNotes("t1", projectDir);
    const planningNote = notes.find((n) => n.phase === "planning");
    expect(planningNote).toBeDefined();
    expect(planningNote!.category).toBe("struggle");
  });

  it("detects successful planning artifacts", () => {
    const projectDir = path.join(tmpDir, "project");
    const planningDir = path.join(projectDir, ".boop", "planning");
    fs.mkdirSync(planningDir, { recursive: true });

    fs.writeFileSync(path.join(planningDir, "viability.md"), "Recommendation: PROCEED", "utf-8");
    fs.writeFileSync(path.join(planningDir, "prd.md"), "# PRD", "utf-8");
    fs.writeFileSync(path.join(planningDir, "architecture.md"), "# Architecture", "utf-8");
    fs.writeFileSync(path.join(planningDir, "epics.md"), "# Epics", "utf-8");

    const notes = collectNotes("t1", projectDir);
    const successes = notes.filter((n) => n.category === "success");
    expect(successes.length).toBeGreaterThanOrEqual(4);
  });

  it("flags viability concerns when RECONSIDER is mentioned", () => {
    const projectDir = path.join(tmpDir, "project");
    const planningDir = path.join(projectDir, ".boop", "planning");
    fs.mkdirSync(planningDir, { recursive: true });

    fs.writeFileSync(
      path.join(planningDir, "viability.md"),
      "We should reconsider the approach",
      "utf-8",
    );

    const notes = collectNotes("t1", projectDir);
    const viabilityNote = notes.find((n) => n.phase === "viability");
    expect(viabilityNote!.category).toBe("observation");
  });

  it("detects build progress and errors", () => {
    const projectDir = path.join(tmpDir, "project");
    const boopDir = path.join(projectDir, ".boop");
    const planningDir = path.join(boopDir, "planning");
    fs.mkdirSync(planningDir, { recursive: true });

    fs.writeFileSync(
      path.join(boopDir, "progress.txt"),
      "Story 1.1: completed\nStory 1.2: error - build failed\nStory 1.3: completed\n",
      "utf-8",
    );

    const notes = collectNotes("t1", projectDir);
    const buildSuccess = notes.find((n) => n.phase === "building" && n.category === "success");
    const buildError = notes.find((n) => n.phase === "building" && n.category === "struggle");
    expect(buildSuccess).toBeDefined();
    expect(buildError).toBeDefined();
  });

  it("detects review artifacts", () => {
    const projectDir = path.join(tmpDir, "project");
    const reviewsDir = path.join(projectDir, ".boop", "reviews");
    const planningDir = path.join(projectDir, ".boop", "planning");
    fs.mkdirSync(reviewsDir, { recursive: true });
    fs.mkdirSync(planningDir, { recursive: true });

    fs.writeFileSync(path.join(reviewsDir, "review-1.md"), "# Review", "utf-8");

    const notes = collectNotes("t1", projectDir);
    const reviewNote = notes.find((n) => n.phase === "reviewing" && n.category === "success");
    expect(reviewNote).toBeDefined();
  });

  it("notes when no progress file exists", () => {
    const projectDir = path.join(tmpDir, "project");
    const planningDir = path.join(projectDir, ".boop", "planning");
    fs.mkdirSync(planningDir, { recursive: true });

    const notes = collectNotes("t1", projectDir);
    const buildNote = notes.find((n) => n.phase === "building" && n.category === "observation");
    expect(buildNote).toBeDefined();
  });

  // --- generateTierReport ---
  it("generates a markdown report for a tier result", () => {
    const tierResult: GauntletTierResult = {
      tierId: "t1-todo-app",
      level: 1,
      success: true,
      phaseReached: "REVIEWING",
      durationMs: 12345,
      errors: [],
      notes: [
        { phase: "viability", category: "success", text: "Passed cleanly" },
        { phase: "building", category: "struggle", text: "Slow build" },
      ],
      tags: { post: "gauntlet/t1-todo-app-post" },
    };

    const report = generateTierReport(tierResult);
    expect(report).toContain("t1-todo-app");
    expect(report).toContain("PASSED");
    expect(report).toContain("REVIEWING");
    expect(report).toContain("Passed cleanly");
    expect(report).toContain("Slow build");
  });

  it("includes errors in the report", () => {
    const tierResult: GauntletTierResult = {
      tierId: "t2-notes-app",
      level: 2,
      success: false,
      phaseReached: "PLANNING",
      durationMs: 5000,
      errors: ["API timeout", "Rate limited"],
      notes: [],
      tags: { post: "gauntlet/t2-notes-app-post" },
    };

    const report = generateTierReport(tierResult);
    expect(report).toContain("FAILED");
    expect(report).toContain("API timeout");
    expect(report).toContain("Rate limited");
  });

  it("includes evolved tag when present", () => {
    const tierResult: GauntletTierResult = {
      tierId: "t1-todo-app",
      level: 1,
      success: true,
      phaseReached: "COMPLETE",
      durationMs: 1000,
      errors: [],
      notes: [],
      tags: { post: "gauntlet/t1-post", evolved: "gauntlet/t1-evolved" },
    };

    const report = generateTierReport(tierResult);
    expect(report).toContain("gauntlet/t1-evolved");
  });
});
