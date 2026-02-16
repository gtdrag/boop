/**
 * Gateway server — core message routing.
 *
 * Derived from OpenClaw's gateway module (MIT license).
 * This will be fleshed out as channel adapters are integrated.
 */

export interface GatewayConfig {
  port: number;
  host: string;
}

export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  port: 18789,
  host: "127.0.0.1",
};

export async function startGateway(_config: GatewayConfig = DEFAULT_GATEWAY_CONFIG): Promise<void> {
  // Gateway startup will be implemented when channel adapters are integrated
}
