/**
 * Browser automation module for Boop.
 *
 * Uses playwright-core for browser automation.
 * Derived from OpenClaw's browser module (MIT license).
 */

export interface BrowserConfig {
  headless: boolean;
}

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  headless: true,
};
