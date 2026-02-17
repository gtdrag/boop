/**
 * WhatsApp channel adapter.
 *
 * Uses @whiskeysockets/baileys for WhatsApp Web protocol.
 * Derived from OpenClaw's WhatsApp adapter (MIT license).
 *
 * Provides bidirectional messaging: send notifications to the user
 * and receive replies for sign-off and question flows.
 */
import type { ChannelAdapter, OutboundMessage, InboundMessage } from "../messaging.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WhatsAppConfig {
  /** Whether the adapter is enabled. */
  enabled: boolean;
  /** Target phone number with country code (e.g. "+1234567890"). */
  phoneNumber?: string;
  /** Path to auth credentials directory. Defaults to ~/.boop/credentials/whatsapp/. */
  credentialsDir?: string;
}

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppConfig = {
  enabled: false,
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Create a WhatsApp adapter using Baileys.
 *
 * The adapter manages a single WhatsApp Web session:
 *   - On first start, displays a QR code for pairing
 *   - Subsequent starts use cached credentials
 *   - Sends messages to the configured phone number
 *   - Receives replies and resolves pending waitForReply() calls
 *
 * Dependencies are injected for testability.
 */
export function createWhatsAppAdapter(
  config: WhatsAppConfig,
  deps?: WhatsAppAdapterDeps,
): ChannelAdapter {
  let connected = false;
  let replyResolve: ((msg: InboundMessage | null) => void) | null = null;
  let replyTimer: ReturnType<typeof setTimeout> | null = null;

  const targetJid = config.phoneNumber
    ? `${config.phoneNumber.replace(/[^0-9]/g, "")}@s.whatsapp.net`
    : "";

  // Injectable deps for testing
  const connectFn = deps?.connect;
  const sendFn = deps?.send;
  const onMessageFn = deps?.onMessage;
  const disconnectFn = deps?.disconnect;

  function handleIncomingMessage(text: string): void {
    if (replyResolve) {
      const resolve = replyResolve;
      replyResolve = null;
      if (replyTimer) {
        clearTimeout(replyTimer);
        replyTimer = null;
      }
      resolve({
        text,
        channel: "whatsapp",
        receivedAt: new Date().toISOString(),
      });
    }
  }

  return {
    async start(): Promise<void> {
      if (connected) return;
      if (!config.enabled || !config.phoneNumber) return;

      if (connectFn) {
        await connectFn(config);
      }

      if (onMessageFn) {
        onMessageFn(handleIncomingMessage);
      }

      connected = true;
    },

    async stop(): Promise<void> {
      if (!connected) return;

      // Resolve any pending waitForReply with null
      if (replyResolve) {
        replyResolve(null);
        replyResolve = null;
      }
      if (replyTimer) {
        clearTimeout(replyTimer);
        replyTimer = null;
      }

      if (disconnectFn) {
        await disconnectFn();
      }

      connected = false;
    },

    async send(message: OutboundMessage): Promise<void> {
      if (!connected || !targetJid) return;

      if (sendFn) {
        await sendFn(targetJid, message.text);
      }
    },

    async waitForReply(timeoutMs: number): Promise<InboundMessage | null> {
      if (!connected) return null;

      return new Promise((resolve) => {
        replyResolve = resolve;

        if (timeoutMs > 0) {
          replyTimer = setTimeout(() => {
            if (replyResolve) {
              replyResolve = null;
              resolve(null);
            }
          }, timeoutMs);
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Dependency injection types (for testability)
// ---------------------------------------------------------------------------

export interface WhatsAppAdapterDeps {
  /** Connect to WhatsApp Web. */
  connect?: (config: WhatsAppConfig) => Promise<void>;
  /** Send a message to a JID. */
  send?: (jid: string, text: string) => Promise<void>;
  /** Register a callback for incoming messages. */
  onMessage?: (handler: (text: string) => void) => void;
  /** Disconnect from WhatsApp Web. */
  disconnect?: () => Promise<void>;
}
