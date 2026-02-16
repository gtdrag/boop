/**
 * Telegram channel adapter.
 *
 * Uses grammy for Telegram Bot API.
 * Derived from OpenClaw's Telegram adapter (MIT license).
 *
 * Will be implemented when channel integration stories are reached.
 */

export interface TelegramConfig {
  enabled: boolean;
  token?: string;
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  enabled: false,
};
