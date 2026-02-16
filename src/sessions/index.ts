/**
 * Session management for Boop.
 *
 * Derived from OpenClaw's session module (MIT license).
 * Handles session state for channel conversations.
 */

export interface Session {
  id: string;
  channelId: string;
  createdAt: number;
  lastActiveAt: number;
}
