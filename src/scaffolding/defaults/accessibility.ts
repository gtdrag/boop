/**
 * Accessibility defaults for web projects.
 *
 * Generates ARIA landmark templates, skip-navigation component,
 * focus management patterns, and a semantic HTML guide. Only
 * applies when the project has a frontend framework.
 */
import type { DeveloperProfile, FrontendFramework } from "../../profile/schema.js";
import { isWebProject } from "./seo.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccessibilityFile {
  /** File path relative to the project root. */
  filepath: string;
  /** File content. */
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REACT_FRAMEWORKS: FrontendFramework[] = ["next", "remix", "vite-react"];

function isReactFramework(fw: FrontendFramework): boolean {
  return REACT_FRAMEWORKS.includes(fw);
}

// ---------------------------------------------------------------------------
// Skip-navigation component
// ---------------------------------------------------------------------------

function buildSkipNav(framework: FrontendFramework): AccessibilityFile {
  if (isReactFramework(framework)) {
    return {
      filepath: "src/components/skip-nav.tsx",
      content: `/**
 * Skip-navigation link.
 *
 * Renders a visually-hidden link that becomes visible on focus.
 * Place at the very top of your layout so keyboard users can
 * skip past the navigation to the main content.
 *
 * Usage:
 *   <SkipNav />
 *   <nav>…</nav>
 *   <main id="main-content">…</main>
 */

const skipNavStyles: React.CSSProperties = {
  position: "absolute",
  left: "-9999px",
  top: "auto",
  width: "1px",
  height: "1px",
  overflow: "hidden",
};

const skipNavFocusStyles: React.CSSProperties = {
  position: "fixed",
  top: "0",
  left: "0",
  width: "auto",
  height: "auto",
  padding: "1rem",
  background: "#000",
  color: "#fff",
  zIndex: 9999,
  fontSize: "1rem",
};

export function SkipNav({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a
      href={\`#\${targetId}\`}
      style={skipNavStyles}
      onFocus={(e) => Object.assign(e.currentTarget.style, skipNavFocusStyles)}
      onBlur={(e) => Object.assign(e.currentTarget.style, skipNavStyles)}
    >
      Skip to main content
    </a>
  );
}
`,
    };
  }

  return {
    filepath: "src/a11y/skip-nav.ts",
    content: `/**
 * Skip-navigation helper.
 *
 * Returns an HTML string for a skip-nav link that is visually
 * hidden until focused. Add it as the first element in the body.
 *
 * Target element should have id="main-content".
 */

export function buildSkipNavHtml(targetId = "main-content"): string {
  return \`<a
  href="#\${targetId}"
  class="skip-nav"
  style="
    position: absolute;
    left: -9999px;
    top: auto;
    width: 1px;
    height: 1px;
    overflow: hidden;
  "
>
  Skip to main content
</a>\`;
}

/**
 * CSS to include for the skip-nav link focus state.
 */
export const SKIP_NAV_CSS = \`
.skip-nav:focus {
  position: fixed;
  top: 0;
  left: 0;
  width: auto;
  height: auto;
  padding: 1rem;
  background: #000;
  color: #fff;
  z-index: 9999;
  font-size: 1rem;
  overflow: visible;
}
\`;
`,
  };
}

// ---------------------------------------------------------------------------
// ARIA landmarks template
// ---------------------------------------------------------------------------

function buildAriaLandmarks(framework: FrontendFramework): AccessibilityFile {
  if (isReactFramework(framework)) {
    return {
      filepath: "src/components/aria-landmarks.tsx",
      content: `/**
 * ARIA landmark layout component.
 *
 * Provides a semantic page structure with proper ARIA roles
 * and landmarks. Use as a base layout wrapper.
 *
 * Landmarks:
 *   - banner (header)
 *   - navigation
 *   - main
 *   - contentinfo (footer)
 */

export interface AriaLandmarksProps {
  header?: React.ReactNode;
  nav?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function AriaLandmarks({ header, nav, children, footer }: AriaLandmarksProps) {
  return (
    <>
      {header && <header role="banner">{header}</header>}
      {nav && <nav role="navigation" aria-label="Main navigation">{nav}</nav>}
      <main id="main-content" role="main">{children}</main>
      {footer && <footer role="contentinfo">{footer}</footer>}
    </>
  );
}
`,
    };
  }

  return {
    filepath: "src/a11y/aria-landmarks.ts",
    content: `/**
 * ARIA landmark reference.
 *
 * Provides HTML templates with proper ARIA roles and landmarks.
 * Use these patterns as the base for your page layouts.
 *
 * Landmarks:
 *   - banner (header)
 *   - navigation
 *   - main
 *   - contentinfo (footer)
 */

export function buildLandmarkLayoutHtml(): string {
  return \`<header role="banner">
  <!-- Site header -->
</header>

<nav role="navigation" aria-label="Main navigation">
  <!-- Primary navigation -->
</nav>

<main id="main-content" role="main">
  <!-- Page content -->
</main>

<footer role="contentinfo">
  <!-- Site footer -->
</footer>\`;
}
`,
  };
}

// ---------------------------------------------------------------------------
// Focus trap utility
// ---------------------------------------------------------------------------

function buildFocusTrap(framework: FrontendFramework): AccessibilityFile {
  if (isReactFramework(framework)) {
    return {
      filepath: "src/hooks/use-focus-trap.ts",
      content: `/**
 * Focus trap hook for modals and dialogs.
 *
 * Traps keyboard focus within a container element so that
 * Tab / Shift+Tab cycles only through focusable children.
 *
 * Usage:
 *   const ref = useFocusTrap<HTMLDivElement>(isOpen);
 *   <div ref={ref}>…</div>
 */
import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\\"-1\\"])",
].join(", ");

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active || !ref.current) return;

    const container = ref.current;
    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    first?.focus();

    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  return ref;
}
`,
    };
  }

  return {
    filepath: "src/a11y/focus-trap.ts",
    content: `/**
 * Focus trap utility for modals and dialogs.
 *
 * Traps keyboard focus within a container so that Tab / Shift+Tab
 * cycles only through focusable children.
 *
 * Usage:
 *   const trap = createFocusTrap(dialogElement);
 *   trap.activate();
 *   // later…
 *   trap.deactivate();
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\\"-1\\"])",
].join(", ");

export interface FocusTrap {
  activate(): void;
  deactivate(): void;
}

export function createFocusTrap(container: HTMLElement): FocusTrap {
  let handler: ((e: KeyboardEvent) => void) | null = null;

  return {
    activate() {
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      handler = (e: KeyboardEvent) => {
        if (e.key !== "Tab") return;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      };

      container.addEventListener("keydown", handler);
      first?.focus();
    },

    deactivate() {
      if (handler) {
        container.removeEventListener("keydown", handler);
        handler = null;
      }
    },
  };
}
`,
  };
}

// ---------------------------------------------------------------------------
// Color contrast checker config
// ---------------------------------------------------------------------------

function buildColorContrastConfig(): AccessibilityFile {
  return {
    filepath: "src/a11y/color-contrast.ts",
    content: `/**
 * Color contrast ratio calculator.
 *
 * Implements WCAG 2.1 contrast ratio calculation for checking
 * text/background color combinations.
 *
 * WCAG requirements:
 *   - AA normal text: ratio >= 4.5
 *   - AA large text:  ratio >= 3
 *   - AAA normal text: ratio >= 7
 *   - AAA large text:  ratio >= 4.5
 */

/** Parse a hex color (#RGB or #RRGGBB) to [r, g, b] (0-255). */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3
    ? h.split("").map((c) => c + c).join("")
    : h;

  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Compute relative luminance per WCAG 2.1. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Compute the contrast ratio between two hex colors. */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(...hexToRgb(hex1));
  const l2 = relativeLuminance(...hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export type WcagLevel = "AA" | "AAA";
export type TextSize = "normal" | "large";

/** Check if a color pair meets the given WCAG level. */
export function meetsWcag(
  foreground: string,
  background: string,
  level: WcagLevel = "AA",
  textSize: TextSize = "normal",
): boolean {
  const ratio = contrastRatio(foreground, background);

  if (level === "AAA") {
    return textSize === "large" ? ratio >= 4.5 : ratio >= 7;
  }
  // AA
  return textSize === "large" ? ratio >= 3 : ratio >= 4.5;
}
`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate all accessibility default files for a web project.
 *
 * Returns an empty array if the project is not a web project
 * (frontendFramework === "none").
 */
export function generateAccessibilityDefaults(
  profile: DeveloperProfile,
): AccessibilityFile[] {
  if (!isWebProject(profile)) {
    return [];
  }

  const fw = profile.frontendFramework;

  return [
    buildSkipNav(fw),
    buildAriaLandmarks(fw),
    buildFocusTrap(fw),
    buildColorContrastConfig(),
  ];
}
