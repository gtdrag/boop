/**
 * SEO defaults for web projects.
 *
 * Generates meta tag helpers, Open Graph templates, JSON-LD structured data,
 * sitemap config, robots.txt, and semantic HTML patterns. Only applies when
 * the project has a frontend framework (i.e. frontendFramework !== "none").
 */
import type { DeveloperProfile, FrontendFramework } from "../../profile/schema.js";
import { isReactFramework, isWebProject } from "./shared.js";

// Re-export so existing consumers (tests, other modules) keep working.
export { isWebProject };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeoFile {
  /** File path relative to the project root. */
  filepath: string;
  /** File content. */
  content: string;
}

/** Frameworks that use a `public/` directory for static assets. */
const PUBLIC_DIR_FRAMEWORKS: FrontendFramework[] = [
  "next",
  "remix",
  "astro",
  "nuxt",
  "sveltekit",
  "vite-react",
  "vite-vue",
  "angular",
];

function usesPublicDir(framework: FrontendFramework): boolean {
  return PUBLIC_DIR_FRAMEWORKS.includes(framework);
}

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

function buildMetaTagsHelper(framework: FrontendFramework): SeoFile {
  // For React-based frameworks, provide a React component helper.
  // For others, provide a generic HTML partial.
  if (isReactFramework(framework)) {
    return {
      filepath: "src/components/seo-head.tsx",
      content: `/**
 * SEO head component.
 *
 * Renders common meta tags. Import and use in your layout or page.
 */

export interface SeoHeadProps {
  title: string;
  description: string;
  canonicalUrl?: string;
  noIndex?: boolean;
}

export function SeoHead({ title, description, canonicalUrl, noIndex }: SeoHeadProps) {
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
      {noIndex && <meta name="robots" content="noindex,nofollow" />}
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </>
  );
}
`,
    };
  }

  return {
    filepath: "src/seo/meta-tags.ts",
    content: `/**
 * Meta tag builder.
 *
 * Returns an HTML string of common meta tags.
 */

export interface MetaTagOptions {
  title: string;
  description: string;
  canonicalUrl?: string;
  noIndex?: boolean;
}

export function buildMetaTags(options: MetaTagOptions): string {
  const tags: string[] = [
    \`<title>\${options.title}</title>\`,
    \`<meta name="description" content="\${options.description}" />\`,
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
  ];

  if (options.canonicalUrl) {
    tags.push(\`<link rel="canonical" href="\${options.canonicalUrl}" />\`);
  }
  if (options.noIndex) {
    tags.push('<meta name="robots" content="noindex,nofollow" />');
  }

  return tags.join("\\n");
}
`,
  };
}

function buildOpenGraphTemplate(framework: FrontendFramework): SeoFile {
  if (isReactFramework(framework)) {
    return {
      filepath: "src/components/og-tags.tsx",
      content: `/**
 * Open Graph meta tags component.
 */

export interface OgTagsProps {
  title: string;
  description: string;
  url: string;
  image?: string;
  type?: "website" | "article";
  siteName?: string;
}

export function OgTags({ title, description, url, image, type = "website", siteName }: OgTagsProps) {
  return (
    <>
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={type} />
      {image && <meta property="og:image" content={image} />}
      {siteName && <meta property="og:site_name" content={siteName} />}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {image && <meta name="twitter:image" content={image} />}
    </>
  );
}
`,
    };
  }

  return {
    filepath: "src/seo/og-tags.ts",
    content: `/**
 * Open Graph tag builder.
 *
 * Returns an HTML string of OG + Twitter Card meta tags.
 */

export interface OgTagOptions {
  title: string;
  description: string;
  url: string;
  image?: string;
  type?: "website" | "article";
  siteName?: string;
}

export function buildOgTags(options: OgTagOptions): string {
  const tags: string[] = [
    \`<meta property="og:title" content="\${options.title}" />\`,
    \`<meta property="og:description" content="\${options.description}" />\`,
    \`<meta property="og:url" content="\${options.url}" />\`,
    \`<meta property="og:type" content="\${options.type ?? "website"}" />\`,
  ];

  if (options.image) {
    tags.push(\`<meta property="og:image" content="\${options.image}" />\`);
  }
  if (options.siteName) {
    tags.push(\`<meta property="og:site_name" content="\${options.siteName}" />\`);
  }

  tags.push('<meta name="twitter:card" content="summary_large_image" />');
  tags.push(\`<meta name="twitter:title" content="\${options.title}" />\`);
  tags.push(\`<meta name="twitter:description" content="\${options.description}" />\`);

  if (options.image) {
    tags.push(\`<meta name="twitter:image" content="\${options.image}" />\`);
  }

  return tags.join("\\n");
}
`,
  };
}

function buildStructuredDataTemplate(): SeoFile {
  return {
    filepath: "src/seo/structured-data.ts",
    content: `/**
 * JSON-LD structured data helpers.
 *
 * Generates schema.org structured data for common page types.
 */

export interface WebSiteSchema {
  name: string;
  url: string;
  description?: string;
}

export function buildWebSiteJsonLd(site: WebSiteSchema): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: site.url,
    ...(site.description ? { description: site.description } : {}),
  };
  return JSON.stringify(data, null, 2);
}

export interface OrganizationSchema {
  name: string;
  url: string;
  logo?: string;
}

export function buildOrganizationJsonLd(org: OrganizationSchema): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: org.name,
    url: org.url,
    ...(org.logo ? { logo: org.logo } : {}),
  };
  return JSON.stringify(data, null, 2);
}
`,
  };
}

function buildSitemapConfig(framework: FrontendFramework): SeoFile {
  // Next.js has built-in sitemap support via app/sitemap.ts
  if (framework === "next") {
    return {
      filepath: "src/app/sitemap.ts",
      content: `/**
 * Next.js sitemap generator.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
 */
import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://example.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
`,
    };
  }

  return {
    filepath: "src/seo/sitemap-config.ts",
    content: `/**
 * Sitemap configuration.
 *
 * Defines the pages and their priorities for XML sitemap generation.
 * Integrate with your build step or a sitemap library.
 */

export interface SitemapEntry {
  url: string;
  lastModified?: Date;
  changeFrequency?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
}

export const SITEMAP_ENTRIES: SitemapEntry[] = [
  {
    url: "/",
    changeFrequency: "weekly",
    priority: 1,
  },
];
`,
  };
}

function buildRobotsTxt(framework: FrontendFramework): SeoFile {
  // Next.js supports app/robots.ts but a static robots.txt is universally understood
  const dir = usesPublicDir(framework) ? "public" : ".";

  return {
    filepath: `${dir}/robots.txt`,
    content: `# Allow all crawlers
User-agent: *
Allow: /

# Sitemap
Sitemap: https://example.com/sitemap.xml
`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate all SEO default files for a web project.
 *
 * Returns an empty array if the project is not a web project
 * (frontendFramework === "none").
 */
export function generateSeoDefaults(profile: DeveloperProfile): SeoFile[] {
  if (!isWebProject(profile)) {
    return [];
  }

  const fw = profile.frontendFramework;

  return [
    buildMetaTagsHelper(fw),
    buildOpenGraphTemplate(fw),
    buildStructuredDataTemplate(),
    buildSitemapConfig(fw),
    buildRobotsTxt(fw),
  ];
}
