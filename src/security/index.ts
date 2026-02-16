/**
 * Security module for Boop.
 *
 * Derived from OpenClaw's security module (MIT license).
 * Will be implemented when security audit features are needed.
 */

export interface SecurityAuditResult {
  passed: boolean;
  issues: string[];
}
