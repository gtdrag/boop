/**
 * Hook system for Boop.
 *
 * Derived from OpenClaw's hook system (MIT license).
 * Allows lifecycle hooks during pipeline execution.
 */

export type HookEvent =
  | "before:plan"
  | "after:plan"
  | "before:build"
  | "after:build"
  | "before:review"
  | "after:review";

export interface HookHandler {
  event: HookEvent;
  handler: () => Promise<void>;
}
