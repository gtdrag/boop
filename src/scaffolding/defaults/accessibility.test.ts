import { describe, expect, it } from "vitest";
import type { DeveloperProfile } from "../../profile/schema.js";
import { DEFAULT_PROFILE } from "../../profile/defaults.js";
import { generateAccessibilityDefaults } from "./accessibility.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<DeveloperProfile> = {}): DeveloperProfile {
  return { ...DEFAULT_PROFILE, name: "Test Dev", ...overrides };
}

function findFile(files: { filepath: string }[], partial: string) {
  return files.find((f) => f.filepath.includes(partial));
}

// ---------------------------------------------------------------------------
// Non-web projects
// ---------------------------------------------------------------------------

describe("non-web projects", () => {
  it("returns empty array when frontendFramework is none", () => {
    const profile = makeProfile({ frontendFramework: "none" });
    const files = generateAccessibilityDefaults(profile);
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Skip navigation
// ---------------------------------------------------------------------------

describe("skip navigation", () => {
  it("generates a React component for Next.js", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateAccessibilityDefaults(profile);
    const skipNav = findFile(files, "skip-nav");

    expect(skipNav).toBeDefined();
    expect(skipNav!.filepath).toBe("src/components/skip-nav.tsx");
    expect(skipNav!.content).toContain("SkipNav");
    expect(skipNav!.content).toContain("main-content");
    expect(skipNav!.content).toContain("Skip to main content");
  });

  it("generates a React component for Remix", () => {
    const profile = makeProfile({ frontendFramework: "remix" });
    const files = generateAccessibilityDefaults(profile);
    const skipNav = findFile(files, "skip-nav");

    expect(skipNav).toBeDefined();
    expect(skipNav!.filepath).toContain(".tsx");
  });

  it("generates a React component for vite-react", () => {
    const profile = makeProfile({ frontendFramework: "vite-react" });
    const files = generateAccessibilityDefaults(profile);
    const skipNav = findFile(files, "skip-nav");

    expect(skipNav).toBeDefined();
    expect(skipNav!.filepath).toContain(".tsx");
  });

  it("generates a generic TS helper for non-React frameworks", () => {
    const profile = makeProfile({ frontendFramework: "astro" });
    const files = generateAccessibilityDefaults(profile);
    const skipNav = findFile(files, "skip-nav");

    expect(skipNav).toBeDefined();
    expect(skipNav!.filepath).toBe("src/a11y/skip-nav.ts");
    expect(skipNav!.content).toContain("buildSkipNavHtml");
    expect(skipNav!.content).toContain("SKIP_NAV_CSS");
    expect(skipNav!.content).toContain("main-content");
  });

  it("generates a generic TS helper for SvelteKit", () => {
    const profile = makeProfile({ frontendFramework: "sveltekit" });
    const files = generateAccessibilityDefaults(profile);
    const skipNav = findFile(files, "skip-nav");

    expect(skipNav).toBeDefined();
    expect(skipNav!.filepath).toBe("src/a11y/skip-nav.ts");
  });
});

// ---------------------------------------------------------------------------
// ARIA landmarks
// ---------------------------------------------------------------------------

describe("ARIA landmarks", () => {
  it("generates a React component for Next.js", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateAccessibilityDefaults(profile);
    const landmarks = findFile(files, "aria-landmarks");

    expect(landmarks).toBeDefined();
    expect(landmarks!.filepath).toBe("src/components/aria-landmarks.tsx");
    expect(landmarks!.content).toContain("AriaLandmarks");
    expect(landmarks!.content).toContain("banner");
    expect(landmarks!.content).toContain("navigation");
    expect(landmarks!.content).toContain("main-content");
    expect(landmarks!.content).toContain("contentinfo");
  });

  it("generates a generic TS helper for non-React frameworks", () => {
    const profile = makeProfile({ frontendFramework: "nuxt" });
    const files = generateAccessibilityDefaults(profile);
    const landmarks = findFile(files, "aria-landmarks");

    expect(landmarks).toBeDefined();
    expect(landmarks!.filepath).toBe("src/a11y/aria-landmarks.ts");
    expect(landmarks!.content).toContain("buildLandmarkLayoutHtml");
    expect(landmarks!.content).toContain("banner");
    expect(landmarks!.content).toContain("navigation");
    expect(landmarks!.content).toContain("contentinfo");
  });
});

// ---------------------------------------------------------------------------
// Focus trap
// ---------------------------------------------------------------------------

describe("focus trap", () => {
  it("generates a React hook for Next.js", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateAccessibilityDefaults(profile);
    const trap = findFile(files, "focus-trap");

    expect(trap).toBeDefined();
    expect(trap!.filepath).toBe("src/hooks/use-focus-trap.ts");
    expect(trap!.content).toContain("useFocusTrap");
    expect(trap!.content).toContain("Tab");
    expect(trap!.content).toContain("useRef");
  });

  it("generates a React hook for vite-react", () => {
    const profile = makeProfile({ frontendFramework: "vite-react" });
    const files = generateAccessibilityDefaults(profile);
    const trap = findFile(files, "focus-trap");

    expect(trap).toBeDefined();
    expect(trap!.filepath).toBe("src/hooks/use-focus-trap.ts");
  });

  it("generates a generic utility for non-React frameworks", () => {
    const profile = makeProfile({ frontendFramework: "astro" });
    const files = generateAccessibilityDefaults(profile);
    const trap = findFile(files, "focus-trap");

    expect(trap).toBeDefined();
    expect(trap!.filepath).toBe("src/a11y/focus-trap.ts");
    expect(trap!.content).toContain("createFocusTrap");
    expect(trap!.content).toContain("activate");
    expect(trap!.content).toContain("deactivate");
    expect(trap!.content).toContain("Tab");
  });
});

// ---------------------------------------------------------------------------
// Color contrast checker
// ---------------------------------------------------------------------------

describe("color contrast checker", () => {
  it("generates the color contrast utility for all web projects", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateAccessibilityDefaults(profile);
    const contrast = findFile(files, "color-contrast");

    expect(contrast).toBeDefined();
    expect(contrast!.filepath).toBe("src/a11y/color-contrast.ts");
    expect(contrast!.content).toContain("contrastRatio");
    expect(contrast!.content).toContain("meetsWcag");
    expect(contrast!.content).toContain("hexToRgb");
    expect(contrast!.content).toContain("relativeLuminance");
  });

  it("is framework-independent (same file for all frameworks)", () => {
    const nextFiles = generateAccessibilityDefaults(makeProfile({ frontendFramework: "next" }));
    const astroFiles = generateAccessibilityDefaults(makeProfile({ frontendFramework: "astro" }));

    const nextContrast = findFile(nextFiles, "color-contrast");
    const astroContrast = findFile(astroFiles, "color-contrast");

    expect(nextContrast!.filepath).toBe(astroContrast!.filepath);
    expect(nextContrast!.content).toBe(astroContrast!.content);
  });
});

// ---------------------------------------------------------------------------
// File count
// ---------------------------------------------------------------------------

describe("file count", () => {
  it("generates exactly 4 files for a web project", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateAccessibilityDefaults(profile);
    // skip-nav, aria-landmarks, focus-trap, color-contrast
    expect(files).toHaveLength(4);
  });

  it("generates 4 files for every supported frontend framework", () => {
    const frameworks = ["next", "remix", "astro", "nuxt", "sveltekit", "vite-react", "vite-vue", "angular"];
    for (const fw of frameworks) {
      const profile = makeProfile({ frontendFramework: fw });
      const files = generateAccessibilityDefaults(profile);
      expect(files).toHaveLength(4);
    }
  });

  it("generates 0 files for non-web projects", () => {
    const profile = makeProfile({ frontendFramework: "none" });
    const files = generateAccessibilityDefaults(profile);
    expect(files).toHaveLength(0);
  });
});
