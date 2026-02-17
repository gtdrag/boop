/**
 * Telegram channel adapter.
 *
 * Uses grammy for Telegram Bot API.
 * Derived from OpenClaw's Telegram adapter (MIT license).
 *
 * Provides bidirectional messaging: send notifications to the user
 * and receive replies for sign-off and question flows.
 */
import type { ChannelAdapter, OutboundMessage, InboundMessage } from "../messaging.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TelegramConfig {
  /** Whether the adapter is enabled. */
  enabled: boolean;
  /** Telegram bot token from @BotFather. */
  token?: string;
  /** Chat ID for the target user/group. */
  chatId?: string;
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  enabled: false,
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Create a Telegram adapter using grammy.
 *
 * The adapter manages a single Telegram bot session:
 *   - Uses the bot token to authenticate with Telegram API
 *   - Sends messages to the configured chat ID
 *   - Receives replies and resolves pending waitForReply() calls
 *
 * Dependencies are injected for testability.
 */
export function createTelegramAdapter(
  config: TelegramConfig,
  deps?: TelegramAdapterDeps,
): ChannelAdapter {
  let connected = false;
  let replyResolve: ((msg: InboundMessage | null) => void) | null = null;
  let replyTimer: ReturnType<typeof setTimeout> | null = null;

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
        channel: "telegram",
        receivedAt: new Date().toISOString(),
      });
    }
  }

  return {
    async start(): Promise<void> {
      if (connected) return;
      if (!config.enabled || !config.token || !config.chatId) return;

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
      if (!connected || !config.chatId) return;

      if (sendFn) {
        await sendFn(config.chatId, message.text);
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

export interface TelegramAdapterDeps {
  /** Connect to Telegram API. */
  connect?: (config: TelegramConfig) => Promise<void>;
  /** Send a message to a chat ID. */
  send?: (chatId: string, text: string) => Promise<void>;
  /** Register a callback for incoming messages. */
  onMessage?: (handler: (text: string) => void) => void;
  /** Disconnect from Telegram API. */
  disconnect?: () => Promise<void>;
}
