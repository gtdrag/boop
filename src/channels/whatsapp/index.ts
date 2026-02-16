/**
 * WhatsApp channel adapter.
 *
 * Uses @whiskeysockets/baileys for WhatsApp Web protocol.
 * Derived from OpenClaw's WhatsApp adapter (MIT license).
 *
 * Will be implemented when channel integration stories are reached.
 */

export interface WhatsAppConfig {
  enabled: boolean;
}

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppConfig = {
  enabled: false,
};
