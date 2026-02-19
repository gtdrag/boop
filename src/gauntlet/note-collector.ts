/**
 * Gauntlet note collector.
 *
 * Reads .boop/ artifacts from a tier's project directory and
 * classifies observations into struggle, success, and observation notes.
 */
import fs from "node:fs";
import path from "node:path";
import type { GauntletNote, GauntletTierResult, NoteCategory } from "./types.js";

/**
 * Collect self-assessment notes from a tier's project directory.
 *
 * Reads planning outputs, review results, build progress, and
 * retrospective artifacts to classify what went well and what struggled.
 *
 * @param tierId - The tier identifier.
 * @param tierProjectDir - Path to the tier's project directory.
 * @returns Array of classified notes.
 */
export function collectNotes(tierId: string, tierProjectDir: string): GauntletNote[] {
  const notes: GauntletNote[] = [];
  const boopDir = path.join(tierProjectDir, ".boop");

  if (!fs.existsSync(boopDir)) {
    notes.push({
      phase: "setup",
      category: "struggle",
      text: `No .boop/ directory found for tier ${tierId} — pipeline may not have started`,
    });
    return notes;
  }

  collectPlanningNotes(boopDir, notes);
  collectBuildNotes(boopDir, notes);
  collectReviewNotes(boopDir, notes);
  collectRetrospectiveNotes(boopDir, notes);

  return notes;
}

/** Scan planning artifacts. */
function collectPlanningNotes(boopDir: string, notes: GauntletNote[]): void {
  const planningDir = path.join(boopDir, "planning");

  if (!fs.existsSync(planningDir)) {
    notes.push({
      phase: "planning",
      category: "struggle",
      text: "No planning directory found — planning phase may have failed",
    });
    return;
  }

  const viabilityPath = path.join(planningDir, "viability.md");
  if (fs.existsSync(viabilityPath)) {
    const content = fs.readFileSync(viabilityPath, "utf-8");
    if (content.toLowerCase().includes("reconsider") || content.toLowerCase().includes("pivot")) {
      notes.push({
        phase: "viability",
        category: "observation",
        text: "Viability assessment flagged concerns — may indicate the idea needs refinement",
      });
    } else {
      notes.push({
        phase: "viability",
        category: "success",
        text: "Viability assessment passed cleanly",
      });
    }
  }

  const prdPath = path.join(planningDir, "prd.md");
  if (fs.existsSync(prdPath)) {
    notes.push({
      phase: "prd",
      category: "success",
      text: "PRD generated successfully",
    });
  } else {
    notes.push({
      phase: "prd",
      category: "struggle",
      text: "PRD not found — PRD generation may have failed",
    });
  }

  const archPath = path.join(planningDir, "architecture.md");
  if (fs.existsSync(archPath)) {
    notes.push({
      phase: "architecture",
      category: "success",
      text: "Architecture document generated successfully",
    });
  } else {
    notes.push({
      phase: "architecture",
      category: "struggle",
      text: "Architecture document not found — architecture generation may have failed",
    });
  }

  const storiesPath = path.join(planningDir, "epics.md");
  if (fs.existsSync(storiesPath)) {
    notes.push({
      phase: "stories",
      category: "success",
      text: "Epics and stories generated successfully",
    });
  } else {
    notes.push({
      phase: "stories",
      category: "struggle",
      text: "Epics/stories not found — story generation may have failed",
    });
  }
}

/** Scan build artifacts. */
function collectBuildNotes(boopDir: string, notes: GauntletNote[]): void {
  const progressPath = path.join(boopDir, "progress.txt");

  if (!fs.existsSync(progressPath)) {
    notes.push({
      phase: "building",
      category: "observation",
      text: "No progress file found — build phase may not have started",
    });
    return;
  }

  const content = fs.readFileSync(progressPath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  if (lines.length > 0) {
    notes.push({
      phase: "building",
      category: "success",
      text: `Build phase recorded ${lines.length} progress entries`,
    });
  }

  // Check for error patterns
  const errorLines = lines.filter(
    (line) => line.toLowerCase().includes("error") || line.toLowerCase().includes("failed"),
  );
  if (errorLines.length > 0) {
    notes.push({
      phase: "building",
      category: "struggle",
      text: `Build phase had ${errorLines.length} error entries`,
    });
  }
}

/** Scan review artifacts. */
function collectReviewNotes(boopDir: string, notes: GauntletNote[]): void {
  const reviewsDir = path.join(boopDir, "reviews");

  if (!fs.existsSync(reviewsDir)) {
    notes.push({
      phase: "reviewing",
      category: "observation",
      text: "No reviews directory found — review phase may not have run",
    });
    return;
  }

  try {
    const files = fs.readdirSync(reviewsDir).filter((f) => f.endsWith(".md") || f.endsWith(".json"));
    if (files.length > 0) {
      notes.push({
        phase: "reviewing",
        category: "success",
        text: `Review phase produced ${files.length} review artifacts`,
      });
    }
  } catch {
    // Directory exists but can't be read
  }
}

/** Scan retrospective artifacts. */
function collectRetrospectiveNotes(boopDir: string, notes: GauntletNote[]): void {
  // Look for retrospective report
  const retroDir = path.join(boopDir, "retrospective");
  if (fs.existsSync(retroDir)) {
    notes.push({
      phase: "retrospective",
      category: "success",
      text: "Retrospective completed and saved",
    });
  }
}

/**
 * Generate a human-readable markdown report for a single tier result.
 *
 * @param tierResult - The tier outcome.
 * @returns Markdown string.
 */
export function generateTierReport(tierResult: GauntletTierResult): string {
  const lines: string[] = [];

  lines.push(`## Tier ${tierResult.level}: ${tierResult.tierId}`);
  lines.push("");
  lines.push(`- **Status:** ${tierResult.success ? "PASSED" : "FAILED"}`);
  lines.push(`- **Phase reached:** ${tierResult.phaseReached}`);
  lines.push(`- **Duration:** ${(tierResult.durationMs / 1000).toFixed(1)}s`);

  if (tierResult.errors.length > 0) {
    lines.push("");
    lines.push("### Errors");
    for (const err of tierResult.errors) {
      lines.push(`- ${err}`);
    }
  }

  if (tierResult.notes.length > 0) {
    lines.push("");
    lines.push("### Notes");

    const byCategory: Record<NoteCategory, GauntletNote[]> = {
      success: [],
      struggle: [],
      observation: [],
    };
    for (const note of tierResult.notes) {
      byCategory[note.category].push(note);
    }

    if (byCategory.success.length > 0) {
      lines.push("");
      lines.push("**Successes:**");
      for (const note of byCategory.success) {
        lines.push(`- [${note.phase}] ${note.text}`);
      }
    }

    if (byCategory.struggle.length > 0) {
      lines.push("");
      lines.push("**Struggles:**");
      for (const note of byCategory.struggle) {
        lines.push(`- [${note.phase}] ${note.text}`);
      }
    }

    if (byCategory.observation.length > 0) {
      lines.push("");
      lines.push("**Observations:**");
      for (const note of byCategory.observation) {
        lines.push(`- [${note.phase}] ${note.text}`);
      }
    }
  }

  lines.push("");
  lines.push(`**Git tags:** post=\`${tierResult.tags.post}\`${tierResult.tags.evolved ? `, evolved=\`${tierResult.tags.evolved}\`` : ""}`);

  return lines.join("\n");
}
