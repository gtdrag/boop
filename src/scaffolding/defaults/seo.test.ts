import { describe, expect, it } from "vitest";
import type { DeveloperProfile } from "../../profile/schema.js";
import { DEFAULT_PROFILE } from "../../profile/defaults.js";
import { generateSeoDefaults, isWebProject } from "./seo.js";

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
// isWebProject
// ---------------------------------------------------------------------------

describe("isWebProject", () => {
  it("returns true when frontendFramework is set", () => {
    expect(isWebProject(makeProfile({ frontendFramework: "next" }))).toBe(true);
    expect(isWebProject(makeProfile({ frontendFramework: "remix" }))).toBe(true);
    expect(isWebProject(makeProfile({ frontendFramework: "astro" }))).toBe(true);
    expect(isWebProject(makeProfile({ frontendFramework: "vite-react" }))).toBe(true);
  });

  it("returns false when frontendFramework is none", () => {
    expect(isWebProject(makeProfile({ frontendFramework: "none" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Non-web projects
// ---------------------------------------------------------------------------

describe("non-web projects", () => {
  it("returns empty array when frontendFramework is none", () => {
    const profile = makeProfile({ frontendFramework: "none" });
    const files = generateSeoDefaults(profile);
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Meta tags
// ---------------------------------------------------------------------------

describe("meta tags template", () => {
  it("generates a React component for Next.js", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateSeoDefaults(profile);
    const meta = findFile(files, "seo-head");

    expect(meta).toBeDefined();
    expect(meta!.filepath).toBe("src/components/seo-head.tsx");
    expect(meta!.content).toContain("SeoHead");
    expect(meta!.content).toContain("<title>");
    expect(meta!.content).toContain("description");
  });

  it("generates a React component for Remix", () => {
    const profile = makeProfile({ frontendFramework: "remix" });
    const files = generateSeoDefaults(profile);
    const meta = findFile(files, "seo-head");

    expect(meta).toBeDefined();
    expect(meta!.filepath).toContain(".tsx");
  });

  it("generates a React component for vite-react", () => {
    const profile = makeProfile({ frontendFramework: "vite-react" });
    const files = generateSeoDefaults(profile);
    const meta = findFile(files, "seo-head");

    expect(meta).toBeDefined();
    expect(meta!.filepath).toContain(".tsx");
  });

  it("generates a generic TS helper for non-React frameworks", () => {
    const profile = makeProfile({ frontendFramework: "astro" });
    const files = generateSeoDefaults(profile);
    const meta = findFile(files, "meta-tags");

    expect(meta).toBeDefined();
    expect(meta!.filepath).toBe("src/seo/meta-tags.ts");
    expect(meta!.content).toContain("buildMetaTags");
  });

  it("generates a generic TS helper for Vue-based frameworks", () => {
    const profile = makeProfile({ frontendFramework: "nuxt" });
    const files = generateSeoDefaults(profile);
    const meta = findFile(files, "meta-tags");

    expect(meta).toBeDefined();
    expect(meta!.filepath).toBe("src/seo/meta-tags.ts");
  });
});

// ---------------------------------------------------------------------------
// Open Graph
// ---------------------------------------------------------------------------

describe("Open Graph template", () => {
  it("generates OG React component for Next.js", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateSeoDefaults(profile);
    const og = findFile(files, "og-tags");

    expect(og).toBeDefined();
    expect(og!.filepath).toBe("src/components/og-tags.tsx");
    expect(og!.content).toContain("og:title");
    expect(og!.content).toContain("twitter:card");
  });

  it("generates OG helper for non-React frameworks", () => {
    const profile = makeProfile({ frontendFramework: "sveltekit" });
    const files = generateSeoDefaults(profile);
    const og = findFile(files, "og-tags");

    expect(og).toBeDefined();
    expect(og!.filepath).toBe("src/seo/og-tags.ts");
    expect(og!.content).toContain("buildOgTags");
    expect(og!.content).toContain("og:title");
    expect(og!.content).toContain("twitter:card");
  });
});

// ---------------------------------------------------------------------------
// Structured data (JSON-LD)
// ---------------------------------------------------------------------------

describe("structured data template", () => {
  it("generates JSON-LD helpers for all web projects", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateSeoDefaults(profile);
    const jsonld = findFile(files, "structured-data");

    expect(jsonld).toBeDefined();
    expect(jsonld!.filepath).toBe("src/seo/structured-data.ts");
    expect(jsonld!.content).toContain("schema.org");
    expect(jsonld!.content).toContain("WebSite");
    expect(jsonld!.content).toContain("Organization");
  });

  it("includes both WebSite and Organization builders", () => {
    const profile = makeProfile({ frontendFramework: "astro" });
    const files = generateSeoDefaults(profile);
    const jsonld = findFile(files, "structured-data");

    expect(jsonld!.content).toContain("buildWebSiteJsonLd");
    expect(jsonld!.content).toContain("buildOrganizationJsonLd");
  });
});

// ---------------------------------------------------------------------------
// Sitemap config
// ---------------------------------------------------------------------------

describe("sitemap config", () => {
  it("generates Next.js app/sitemap.ts for Next.js projects", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateSeoDefaults(profile);
    const sitemap = findFile(files, "sitemap");

    expect(sitemap).toBeDefined();
    expect(sitemap!.filepath).toBe("src/app/sitemap.ts");
    expect(sitemap!.content).toContain("MetadataRoute");
    expect(sitemap!.content).toContain("changeFrequency");
  });

  it("generates generic sitemap config for non-Next frameworks", () => {
    const profile = makeProfile({ frontendFramework: "vite-react" });
    const files = generateSeoDefaults(profile);
    const sitemap = findFile(files, "sitemap");

    expect(sitemap).toBeDefined();
    expect(sitemap!.filepath).toBe("src/seo/sitemap-config.ts");
    expect(sitemap!.content).toContain("SitemapEntry");
    expect(sitemap!.content).toContain("SITEMAP_ENTRIES");
  });
});

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

describe("robots.txt", () => {
  it("generates robots.txt in public/ for frameworks that use it", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateSeoDefaults(profile);
    const robots = findFile(files, "robots.txt");

    expect(robots).toBeDefined();
    expect(robots!.filepath).toBe("public/robots.txt");
    expect(robots!.content).toContain("User-agent: *");
    expect(robots!.content).toContain("Sitemap:");
  });

  it("generates robots.txt in public/ for Astro", () => {
    const profile = makeProfile({ frontendFramework: "astro" });
    const files = generateSeoDefaults(profile);
    const robots = findFile(files, "robots.txt");

    expect(robots).toBeDefined();
    expect(robots!.filepath).toBe("public/robots.txt");
  });

  it("generates robots.txt in public/ for SvelteKit", () => {
    const profile = makeProfile({ frontendFramework: "sveltekit" });
    const files = generateSeoDefaults(profile);
    const robots = findFile(files, "robots.txt");

    expect(robots).toBeDefined();
    expect(robots!.filepath).toBe("public/robots.txt");
  });
});

// ---------------------------------------------------------------------------
// File count
// ---------------------------------------------------------------------------

describe("file count", () => {
  it("generates exactly 5 files for a web project", () => {
    const profile = makeProfile({ frontendFramework: "next" });
    const files = generateSeoDefaults(profile);
    // meta tags, OG tags, structured data, sitemap, robots.txt
    expect(files).toHaveLength(5);
  });

  it("generates 5 files for every supported frontend framework", () => {
    const frameworks = ["next", "remix", "astro", "nuxt", "sveltekit", "vite-react", "vite-vue", "angular"];
    for (const fw of frameworks) {
      const profile = makeProfile({ frontendFramework: fw });
      const files = generateSeoDefaults(profile);
      expect(files).toHaveLength(5);
    }
  });
});
