/**
 * Analytics and Core Web Vitals defaults for web projects.
 *
 * Generates analytics provider wiring and a web-vitals reporting hook
 * based on the developer profile. Only applies when the project has
 * a frontend framework (frontendFramework !== "none").
 */
import type { DeveloperProfile, AnalyticsProvider, FrontendFramework } from "../../profile/schema.js";
import { isWebProject } from "./shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalyticsFile {
  /** File path relative to the project root. */
  filepath: string;
  /** File content. */
  content: string;
}

export interface AnalyticsDeps {
  /** Dependencies to add to package.json. */
  dependencies: Record<string, string>;
  /** DevDependencies to add to package.json. */
  devDependencies: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Analytics provider wiring
// ---------------------------------------------------------------------------

function buildGoogleAnalytics(framework: FrontendFramework): AnalyticsFile {
  if (framework === "next") {
    return {
      filepath: "src/components/analytics.tsx",
      content: `/**
 * Google Analytics component for Next.js.
 *
 * Add <Analytics /> to your root layout.
 * Set NEXT_PUBLIC_GA_ID in your environment.
 */
import Script from "next/script";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export function Analytics() {
  if (!GA_ID) return null;

  return (
    <>
      <Script
        src={\`https://www.googletagmanager.com/gtag/js?id=\${GA_ID}\`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {\`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '\${GA_ID}');
        \`}
      </Script>
    </>
  );
}
`,
    };
  }

  return {
    filepath: "src/analytics/google-analytics.ts",
    content: `/**
 * Google Analytics initialization.
 *
 * Call initGA() once on page load. Set GA_ID in your environment.
 */

const GA_ID = typeof process !== "undefined"
  ? process.env.GA_ID ?? ""
  : "";

export function initGA(): void {
  if (!GA_ID) return;

  const script = document.createElement("script");
  script.src = \`https://www.googletagmanager.com/gtag/js?id=\${GA_ID}\`;
  script.async = true;
  document.head.appendChild(script);

  (window as any).dataLayer = (window as any).dataLayer || [];
  function gtag(...args: unknown[]) {
    (window as any).dataLayer.push(args);
  }
  gtag("js", new Date());
  gtag("config", GA_ID);
}
`,
  };
}

function buildPlausible(framework: FrontendFramework): AnalyticsFile {
  if (framework === "next") {
    return {
      filepath: "src/components/analytics.tsx",
      content: `/**
 * Plausible Analytics component for Next.js.
 *
 * Add <Analytics /> to your root layout.
 * Set NEXT_PUBLIC_PLAUSIBLE_DOMAIN in your environment.
 */
import Script from "next/script";

const DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

export function Analytics() {
  if (!DOMAIN) return null;

  return (
    <Script
      defer
      data-domain={DOMAIN}
      src="https://plausible.io/js/script.js"
      strategy="afterInteractive"
    />
  );
}
`,
    };
  }

  return {
    filepath: "src/analytics/plausible.ts",
    content: `/**
 * Plausible Analytics initialization.
 *
 * Call initPlausible() once on page load.
 * Set PLAUSIBLE_DOMAIN in your environment.
 */

const DOMAIN = typeof process !== "undefined"
  ? process.env.PLAUSIBLE_DOMAIN ?? ""
  : "";

export function initPlausible(): void {
  if (!DOMAIN) return;

  const script = document.createElement("script");
  script.src = "https://plausible.io/js/script.js";
  script.defer = true;
  script.dataset.domain = DOMAIN;
  document.head.appendChild(script);
}
`,
  };
}

function buildPostHog(framework: FrontendFramework): AnalyticsFile {
  if (framework === "next") {
    return {
      filepath: "src/components/analytics.tsx",
      content: `/**
 * PostHog Analytics provider for Next.js.
 *
 * Wrap your app with <AnalyticsProvider>.
 * Set NEXT_PUBLIC_POSTHOG_KEY and NEXT_PUBLIC_POSTHOG_HOST in your environment.
 */
"use client";

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect, type ReactNode } from "react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (POSTHOG_KEY) {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        capture_pageview: true,
      });
    }
  }, []);

  if (!POSTHOG_KEY) return <>{children}</>;

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
`,
    };
  }

  return {
    filepath: "src/analytics/posthog.ts",
    content: `/**
 * PostHog Analytics initialization.
 *
 * Call initPostHog() once on page load.
 * Set POSTHOG_KEY and POSTHOG_HOST in your environment.
 */

const POSTHOG_KEY = typeof process !== "undefined"
  ? process.env.POSTHOG_KEY ?? ""
  : "";

const POSTHOG_HOST = typeof process !== "undefined"
  ? process.env.POSTHOG_HOST ?? "https://us.i.posthog.com"
  : "https://us.i.posthog.com";

export async function initPostHog(): Promise<void> {
  if (!POSTHOG_KEY) return;

  const { default: posthog } = await import("posthog-js");
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
  });
}
`,
  };
}

function buildAnalyticsProvider(
  provider: AnalyticsProvider,
  framework: FrontendFramework,
): AnalyticsFile | null {
  switch (provider) {
    case "google-analytics":
      return buildGoogleAnalytics(framework);
    case "plausible":
      return buildPlausible(framework);
    case "posthog":
      return buildPostHog(framework);
    case "mixpanel":
      return buildMixpanel(framework);
    default:
      return null;
  }
}

function buildMixpanel(framework: FrontendFramework): AnalyticsFile {
  if (framework === "next") {
    return {
      filepath: "src/components/analytics.tsx",
      content: `/**
 * Mixpanel Analytics for Next.js.
 *
 * Call initMixpanel() in your root layout's useEffect.
 * Set NEXT_PUBLIC_MIXPANEL_TOKEN in your environment.
 */
"use client";

import mixpanel from "mixpanel-browser";
import { useEffect } from "react";

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN ?? "";

export function useAnalytics() {
  useEffect(() => {
    if (TOKEN) {
      mixpanel.init(TOKEN, { track_pageview: true });
    }
  }, []);
}
`,
    };
  }

  return {
    filepath: "src/analytics/mixpanel.ts",
    content: `/**
 * Mixpanel Analytics initialization.
 *
 * Call initMixpanel() once on page load.
 * Set MIXPANEL_TOKEN in your environment.
 */

const TOKEN = typeof process !== "undefined"
  ? process.env.MIXPANEL_TOKEN ?? ""
  : "";

export async function initMixpanel(): Promise<void> {
  if (!TOKEN) return;

  const mixpanel = await import("mixpanel-browser");
  mixpanel.default.init(TOKEN, { track_pageview: true });
}
`,
  };
}

// ---------------------------------------------------------------------------
// Core Web Vitals
// ---------------------------------------------------------------------------

function buildWebVitalsReporter(framework: FrontendFramework): AnalyticsFile {
  if (framework === "next") {
    return {
      filepath: "src/lib/web-vitals.ts",
      content: `/**
 * Core Web Vitals reporting.
 *
 * Next.js automatically collects CWV metrics. This module provides
 * a reporter function that can send them to your analytics provider.
 *
 * Usage in layout.tsx:
 *   import { reportWebVitals } from "@/lib/web-vitals";
 *   export { reportWebVitals };
 */

export interface WebVitalMetric {
  id: string;
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  delta: number;
}

export function reportWebVitals(metric: WebVitalMetric): void {
  // Send to your analytics endpoint
  console.debug("[CWV]", metric.name, metric.value, metric.rating);

  // Example: send to analytics endpoint
  // fetch("/api/vitals", {
  //   method: "POST",
  //   body: JSON.stringify(metric),
  //   headers: { "Content-Type": "application/json" },
  // });
}
`,
    };
  }

  return {
    filepath: "src/analytics/web-vitals.ts",
    content: `/**
 * Core Web Vitals monitoring.
 *
 * Call reportWebVitals() once on page load to start collecting
 * CLS, FID, FCP, LCP, and TTFB metrics.
 *
 * Requires the "web-vitals" package:
 *   npm install web-vitals
 */

export async function reportWebVitals(): Promise<void> {
  const { onCLS, onFID, onFCP, onLCP, onTTFB } = await import("web-vitals");

  function sendMetric(metric: { name: string; value: number; rating: string }) {
    console.debug("[CWV]", metric.name, metric.value, metric.rating);

    // Example: send to analytics endpoint
    // fetch("/api/vitals", {
    //   method: "POST",
    //   body: JSON.stringify(metric),
    //   headers: { "Content-Type": "application/json" },
    // });
  }

  onCLS(sendMetric);
  onFID(sendMetric);
  onFCP(sendMetric);
  onLCP(sendMetric);
  onTTFB(sendMetric);
}
`,
  };
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Returns the npm dependencies needed for the analytics setup.
 */
export function getAnalyticsDeps(profile: DeveloperProfile): AnalyticsDeps {
  const deps: Record<string, string> = {};
  const devDeps: Record<string, string> = {};

  if (!isWebProject(profile)) {
    return { dependencies: deps, devDependencies: devDeps };
  }

  // Analytics provider packages
  switch (profile.analytics) {
    case "posthog":
      deps["posthog-js"] = "^1.0.0";
      break;
    case "mixpanel":
      deps["mixpanel-browser"] = "^2.0.0";
      break;
    // Google Analytics and Plausible use script tags, no npm package needed
  }

  // web-vitals for CWV monitoring (not needed for Next.js which has built-in support)
  if (profile.frontendFramework !== "next") {
    deps["web-vitals"] = "^4.0.0";
  }

  return { dependencies: deps, devDependencies: devDeps };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate analytics and CWV default files for a web project.
 *
 * Returns an empty array if the project is not a web project
 * or analytics is set to "none".
 */
export function generateAnalyticsDefaults(profile: DeveloperProfile): AnalyticsFile[] {
  if (!isWebProject(profile)) {
    return [];
  }

  const fw = profile.frontendFramework;
  const files: AnalyticsFile[] = [];

  // Analytics provider wiring
  const analyticsFile = buildAnalyticsProvider(profile.analytics, fw);
  if (analyticsFile) {
    files.push(analyticsFile);
  }

  // Core Web Vitals reporter
  files.push(buildWebVitalsReporter(fw));

  return files;
}
