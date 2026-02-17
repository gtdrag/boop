import { describe, expect, it } from "vitest";
import type { DeveloperProfile } from "../../profile/schema.js";
import { DEFAULT_PROFILE } from "../../profile/defaults.js";
import { generateAnalyticsDefaults, getAnalyticsDeps } from "./analytics.js";

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
    const files = generateAnalyticsDefaults(profile);
    expect(files).toEqual([]);
  });

  it("returns empty deps when frontendFramework is none", () => {
    const profile = makeProfile({ frontendFramework: "none" });
    const deps = getAnalyticsDeps(profile);
    expect(deps.dependencies).toEqual({});
    expect(deps.devDependencies).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Analytics provider: none
// ---------------------------------------------------------------------------

describe("analytics provider: none", () => {
  it("still generates CWV reporter even with analytics none", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "none" });
    const files = generateAnalyticsDefaults(profile);

    // No analytics file, only CWV
    expect(files).toHaveLength(1);
    const cwv = findFile(files, "web-vitals");
    expect(cwv).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Google Analytics
// ---------------------------------------------------------------------------

describe("Google Analytics", () => {
  it("generates Next.js component with Script tags", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "google-analytics" });
    const files = generateAnalyticsDefaults(profile);
    const ga = findFile(files, "analytics");

    expect(ga).toBeDefined();
    expect(ga!.filepath).toBe("src/components/analytics.tsx");
    expect(ga!.content).toContain("googletagmanager");
    expect(ga!.content).toContain("NEXT_PUBLIC_GA_ID");
    expect(ga!.content).toContain("next/script");
  });

  it("generates generic script for non-Next frameworks", () => {
    const profile = makeProfile({ frontendFramework: "vite-react", analytics: "google-analytics" });
    const files = generateAnalyticsDefaults(profile);
    const ga = findFile(files, "google-analytics");

    expect(ga).toBeDefined();
    expect(ga!.filepath).toBe("src/analytics/google-analytics.ts");
    expect(ga!.content).toContain("initGA");
    expect(ga!.content).toContain("googletagmanager");
  });

  it("does not add npm dependencies (uses script tags)", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "google-analytics" });
    const deps = getAnalyticsDeps(profile);
    expect(deps.dependencies).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Plausible
// ---------------------------------------------------------------------------

describe("Plausible", () => {
  it("generates Next.js component with plausible script", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "plausible" });
    const files = generateAnalyticsDefaults(profile);
    const pl = findFile(files, "analytics");

    expect(pl).toBeDefined();
    expect(pl!.filepath).toBe("src/components/analytics.tsx");
    expect(pl!.content).toContain("plausible.io");
    expect(pl!.content).toContain("NEXT_PUBLIC_PLAUSIBLE_DOMAIN");
  });

  it("generates generic script for non-Next frameworks", () => {
    const profile = makeProfile({ frontendFramework: "astro", analytics: "plausible" });
    const files = generateAnalyticsDefaults(profile);
    const pl = findFile(files, "plausible");

    expect(pl).toBeDefined();
    expect(pl!.filepath).toBe("src/analytics/plausible.ts");
    expect(pl!.content).toContain("initPlausible");
    expect(pl!.content).toContain("plausible.io");
  });

  it("does not add npm dependencies (uses script tags)", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "plausible" });
    const deps = getAnalyticsDeps(profile);
    expect(deps.dependencies).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// PostHog
// ---------------------------------------------------------------------------

describe("PostHog", () => {
  it("generates Next.js PostHogProvider component", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "posthog" });
    const files = generateAnalyticsDefaults(profile);
    const ph = findFile(files, "analytics");

    expect(ph).toBeDefined();
    expect(ph!.filepath).toBe("src/components/analytics.tsx");
    expect(ph!.content).toContain("PostHogProvider");
    expect(ph!.content).toContain("NEXT_PUBLIC_POSTHOG_KEY");
    expect(ph!.content).toContain("posthog-js");
  });

  it("generates generic script for non-Next frameworks", () => {
    const profile = makeProfile({ frontendFramework: "vite-vue", analytics: "posthog" });
    const files = generateAnalyticsDefaults(profile);
    const ph = findFile(files, "posthog");

    expect(ph).toBeDefined();
    expect(ph!.filepath).toBe("src/analytics/posthog.ts");
    expect(ph!.content).toContain("initPostHog");
    expect(ph!.content).toContain("posthog-js");
  });

  it("adds posthog-js dependency", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "posthog" });
    const deps = getAnalyticsDeps(profile);
    expect(deps.dependencies["posthog-js"]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Mixpanel
// ---------------------------------------------------------------------------

describe("Mixpanel", () => {
  it("generates Next.js hook for Mixpanel", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "mixpanel" });
    const files = generateAnalyticsDefaults(profile);
    const mx = findFile(files, "analytics");

    expect(mx).toBeDefined();
    expect(mx!.filepath).toBe("src/components/analytics.tsx");
    expect(mx!.content).toContain("mixpanel");
    expect(mx!.content).toContain("NEXT_PUBLIC_MIXPANEL_TOKEN");
  });

  it("generates generic script for non-Next frameworks", () => {
    const profile = makeProfile({ frontendFramework: "astro", analytics: "mixpanel" });
    const files = generateAnalyticsDefaults(profile);
    const mx = findFile(files, "mixpanel");

    expect(mx).toBeDefined();
    expect(mx!.filepath).toBe("src/analytics/mixpanel.ts");
    expect(mx!.content).toContain("initMixpanel");
  });

  it("adds mixpanel-browser dependency", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "mixpanel" });
    const deps = getAnalyticsDeps(profile);
    expect(deps.dependencies["mixpanel-browser"]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Core Web Vitals
// ---------------------------------------------------------------------------

describe("Core Web Vitals", () => {
  it("generates Next.js web-vitals reporter", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateAnalyticsDefaults(profile);
    const cwv = findFile(files, "web-vitals");

    expect(cwv).toBeDefined();
    expect(cwv!.filepath).toBe("src/lib/web-vitals.ts");
    expect(cwv!.content).toContain("reportWebVitals");
    expect(cwv!.content).toContain("WebVitalMetric");
  });

  it("generates generic CWV reporter for non-Next frameworks", () => {
    const profile = makeProfile({ frontendFramework: "vite-react" });
    const files = generateAnalyticsDefaults(profile);
    const cwv = findFile(files, "web-vitals");

    expect(cwv).toBeDefined();
    expect(cwv!.filepath).toBe("src/analytics/web-vitals.ts");
    expect(cwv!.content).toContain("reportWebVitals");
    expect(cwv!.content).toContain("onCLS");
    expect(cwv!.content).toContain("onLCP");
    expect(cwv!.content).toContain("onTTFB");
  });

  it("does not add web-vitals dep for Next.js (built-in)", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const deps = getAnalyticsDeps(profile);
    expect(deps.dependencies["web-vitals"]).toBeUndefined();
  });

  it("adds web-vitals dep for non-Next frameworks", () => {
    const profile = makeProfile({ frontendFramework: "vite-react" });
    const deps = getAnalyticsDeps(profile);
    expect(deps.dependencies["web-vitals"]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// File count
// ---------------------------------------------------------------------------

describe("file count", () => {
  it("generates 2 files for web project with analytics (provider + CWV)", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "posthog" });
    const files = generateAnalyticsDefaults(profile);
    expect(files).toHaveLength(2);
  });

  it("generates 1 file for web project with analytics none (CWV only)", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "none" });
    const files = generateAnalyticsDefaults(profile);
    expect(files).toHaveLength(1);
  });

  it("generates 0 files for non-web project", () => {
    const profile = makeProfile({ frontendFramework: "none" });
    const files = generateAnalyticsDefaults(profile);
    expect(files).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

describe("getAnalyticsDeps", () => {
  it("returns empty for non-web projects", () => {
    const profile = makeProfile({ frontendFramework: "none", analytics: "posthog" });
    const deps = getAnalyticsDeps(profile);
    expect(deps.dependencies).toEqual({});
  });

  it("returns empty for analytics none", () => {
    const profile = makeProfile({ frontendFramework: "next", analytics: "none" });
    const deps = getAnalyticsDeps(profile);
    // Next.js has built-in CWV, no extra deps
    expect(deps.dependencies).toEqual({});
  });

  it("returns web-vitals for non-Next with analytics none", () => {
    const profile = makeProfile({ frontendFramework: "vite-react", analytics: "none" });
    const deps = getAnalyticsDeps(profile);
    expect(deps.dependencies["web-vitals"]).toBeTruthy();
  });
});
