/**
 * Process management for Boop.
 *
 * Derived from OpenClaw's process module (MIT license).
 * Handles subprocess lifecycle and signal forwarding.
 */

export interface ProcessInfo {
  pid: number;
  command: string;
  startedAt: number;
}
