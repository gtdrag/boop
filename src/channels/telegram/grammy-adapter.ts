/**
 * Real grammy implementation for Telegram adapter deps.
 *
 * Creates actual Telegram bot connections using the grammy library.
 * Requires a bot token from @BotFather and a chat ID from @userinfobot.
 */
import type { TelegramConfig, TelegramAdapterDeps } from "./index.js";

/**
 * Create real grammy dependency implementations.
 *
 * Uses dynamic import so grammy is only loaded when Telegram is actually used.
 * The adapter framework handles connection lifecycle — these functions just
 * provide the underlying grammy operations.
 */
export function createGrammyAdapterDeps(): TelegramAdapterDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bot: any = null;
  let messageHandler: ((text: string) => void) | null = null;
  let targetChatId: string | null = null;

  return {
    async connect(config: TelegramConfig): Promise<void> {
      if (!config.token || !config.chatId) {
        throw new Error("Telegram bot token and chat ID are required");
      }

      targetChatId = config.chatId;

      // Dynamic import — grammy is only loaded when actually connecting
      const { Bot } = await import("grammy");
      bot = new Bot(config.token);

      // Register message handler for incoming text messages
      bot.on("message:text", (ctx: { message: { text: string; chat: { id: number } } }) => {
        // Only handle messages from the target chat
        if (String(ctx.message.chat.id) !== targetChatId) return;

        if (messageHandler) {
          messageHandler(ctx.message.text);
        }
      });

      // Start polling (non-blocking)
      bot.start({
        onStart: () => {},
      });
    },

    async send(chatId: string, text: string): Promise<void> {
      if (!bot) return;
      await bot.api.sendMessage(Number(chatId), text);
    },

    onMessage(handler: (text: string) => void): void {
      messageHandler = handler;
    },

    async disconnect(): Promise<void> {
      if (bot) {
        await bot.stop();
        bot = null;
      }
      messageHandler = null;
      targetChatId = null;
    },
  };
}
