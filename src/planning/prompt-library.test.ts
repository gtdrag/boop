/**
 * Tests for the BMAD prompt library — verifies all prompt files exist,
 * are loadable, and contain meaningful content.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const PROMPTS_DIR = path.resolve(import.meta.dirname, "..", "..", "prompts");

/** Read a prompt file and return its content. */
function loadPrompt(relativePath: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, relativePath), "utf-8");
}

describe("prompt library", () => {
  describe("phase system prompts", () => {
    const phases = ["viability", "prd", "architecture", "stories"];

    for (const phase of phases) {
      it(`loads ${phase}/system.md`, () => {
        const content = loadPrompt(`${phase}/system.md`);
        expect(content.length).toBeGreaterThan(100);
        expect(content).toContain("# ");
      });
    }
  });

  describe("persona definitions", () => {
    const personas = [
      { file: "personas/pm.md", heading: "Product Manager" },
      { file: "personas/architect.md", heading: "Architect" },
      { file: "personas/developer.md", heading: "Developer" },
    ];

    for (const { file, heading } of personas) {
      it(`loads ${file}`, () => {
        const content = loadPrompt(file);
        expect(content.length).toBeGreaterThan(100);
        expect(content).toContain(heading);
      });
    }

    it("PM persona covers requirements, prioritization, and risk", () => {
      const content = loadPrompt("personas/pm.md");
      expect(content).toContain("Requirements");
      expect(content).toContain("Prioritization");
      expect(content).toContain("Risk");
    });

    it("architect persona covers decision-making and escalation", () => {
      const content = loadPrompt("personas/architect.md");
      expect(content).toContain("Decision");
      expect(content).toContain("Escalat");
    });

    it("developer persona covers coding, testing, and debugging", () => {
      const content = loadPrompt("personas/developer.md");
      expect(content).toContain("Coding");
      expect(content).toContain("Testing");
      expect(content).toContain("Debugging");
    });
  });

  describe("validation checklists", () => {
    const checklists = ["viability", "prd", "architecture", "stories"];

    for (const name of checklists) {
      it(`loads checklists/${name}.md`, () => {
        const content = loadPrompt(`checklists/${name}.md`);
        expect(content.length).toBeGreaterThan(100);
        expect(content).toContain("- [ ]");
      });
    }

    it("viability checklist covers feasibility, market fit, and complexity", () => {
      const content = loadPrompt("checklists/viability.md");
      expect(content).toContain("Feasibility");
      expect(content).toContain("Market Fit");
      expect(content).toContain("Technical Complexity");
    });

    it("prd checklist covers requirements, scope, and success criteria", () => {
      const content = loadPrompt("checklists/prd.md");
      expect(content).toContain("Functional Requirements");
      expect(content).toContain("MVP Scope");
      expect(content).toContain("Success Criteria");
    });

    it("architecture checklist covers tech stack, decisions, and profile alignment", () => {
      const content = loadPrompt("checklists/architecture.md");
      expect(content).toContain("Tech Stack");
      expect(content).toContain("Architecture Decisions");
      expect(content).toContain("Profile Alignment");
    });

    it("stories checklist covers story format, sizing, and ordering", () => {
      const content = loadPrompt("checklists/stories.md");
      expect(content).toContain("Story Format");
      expect(content).toContain("Story Sizing");
      expect(content).toContain("Ordering");
    });
  });

  describe("directory structure completeness", () => {
    const expectedDirs = ["viability", "prd", "architecture", "stories", "personas", "checklists"];

    for (const dir of expectedDirs) {
      it(`prompts/${dir}/ directory exists`, () => {
        const dirPath = path.join(PROMPTS_DIR, dir);
        expect(fs.existsSync(dirPath)).toBe(true);
        expect(fs.statSync(dirPath).isDirectory()).toBe(true);
      });
    }

    it("all prompt files are markdown", () => {
      for (const dir of expectedDirs) {
        const dirPath = path.join(PROMPTS_DIR, dir);
        const files = fs.readdirSync(dirPath).filter((f) => !f.startsWith("."));
        for (const file of files) {
          expect(file).toMatch(/\.md$/);
        }
      }
    });
  });
});
