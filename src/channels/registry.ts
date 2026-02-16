/**
 * Channel registry — manages available notification adapters.
 *
 * Derived from OpenClaw's channel registry (MIT license).
 * Stripped to WhatsApp + Telegram only.
 */

export const CHAT_CHANNEL_ORDER = ["telegram", "whatsapp"] as const;

export type ChatChannelId = (typeof CHAT_CHANNEL_ORDER)[number];

export const DEFAULT_CHAT_CHANNEL: ChatChannelId = "whatsapp";

export interface ChannelMeta {
  id: ChatChannelId;
  label: string;
  description: string;
}

const CHANNEL_META: Record<ChatChannelId, ChannelMeta> = {
  telegram: {
    id: "telegram",
    label: "Telegram",
    description: "Telegram Bot via grammy",
  },
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp",
    description: "WhatsApp via @whiskeysockets/baileys",
  },
};

export function listChannels(): ChannelMeta[] {
  return CHAT_CHANNEL_ORDER.map((id) => CHANNEL_META[id]);
}

export function getChannelMeta(id: ChatChannelId): ChannelMeta {
  return CHANNEL_META[id];
}

export function isValidChannel(id: string): id is ChatChannelId {
  return (CHAT_CHANNEL_ORDER as readonly string[]).includes(id);
}
