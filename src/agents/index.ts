/**
 * Agent runtime for Boop.
 *
 * Derived from OpenClaw's agent module (MIT license).
 * Uses @mariozechner/pi-agent-core for agent execution.
 */

export interface AgentConfig {
  model: string;
  maxTokens: number;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  model: "claude-opus-4-6",
  maxTokens: 4096,
};
