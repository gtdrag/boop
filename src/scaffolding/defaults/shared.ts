/**
 * Shared scaffolding utilities.
 *
 * Common types, constants, and helpers used across multiple
 * scaffolding default generators (seo, analytics, accessibility,
 * security-headers).
 */
import type { DeveloperProfile, FrontendFramework } from "../../profile/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A generated file with a path and content string. */
export interface GeneratedFile {
  /** File path relative to the project root. */
  filepath: string;
  /** File content. */
  content: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Frameworks that produce React (JSX/TSX) output. */
export const REACT_FRAMEWORKS: FrontendFramework[] = ["next", "remix", "vite-react"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the framework uses React (JSX/TSX). */
export function isReactFramework(framework: string): boolean {
  return REACT_FRAMEWORKS.includes(framework);
}

/** Returns true when the profile describes a web project. */
export function isWebProject(profile: DeveloperProfile): boolean {
  return profile.frontendFramework !== "none";
}
