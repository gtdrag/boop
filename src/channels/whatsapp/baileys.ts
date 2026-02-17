/**
 * Real Baileys implementation for WhatsApp adapter deps.
 *
 * Creates actual WhatsApp Web connections using @whiskeysockets/baileys.
 * On first connection, displays a QR code in the terminal for pairing.
 * Subsequent connections use cached credentials from the credentials directory.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { WhatsAppConfig, WhatsAppAdapterDeps } from "./index.js";

const DEFAULT_CREDENTIALS_DIR = path.join(os.homedir(), ".boop", "credentials", "whatsapp");

/**
 * Create real Baileys dependency implementations.
 *
 * Uses dynamic import so Baileys is only loaded when WhatsApp is actually used.
 * The adapter framework handles connection lifecycle — these functions just
 * provide the underlying Baileys operations.
 */
export function createBaileysAdapterDeps(): WhatsAppAdapterDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sock: any = null;
  let messageHandler: ((text: string) => void) | null = null;

  return {
    async connect(config: WhatsAppConfig): Promise<void> {
      const credDir = config.credentialsDir ?? DEFAULT_CREDENTIALS_DIR;
      fs.mkdirSync(credDir, { recursive: true });

      // Dynamic import — Baileys is only loaded when actually connecting
      const baileys = await import("@whiskeysockets/baileys");
      const { useMultiFileAuthState } = baileys;

      const { state, saveCreds } = await useMultiFileAuthState(credDir);

      sock = baileys.makeWASocket({
        auth: state,
        printQRInTerminal: true,
      });

      // Save credentials on update
      sock.ev.on("creds.update", saveCreds);

      // Listen for incoming messages
      sock.ev.on(
        "messages.upsert",
        (update: {
          messages: Array<{
            message?: { conversation?: string; extendedTextMessage?: { text?: string } };
            key: { fromMe?: boolean };
          }>;
        }) => {
          for (const msg of update.messages) {
            if (msg.key.fromMe) continue;

            const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;

            if (text && messageHandler) {
              messageHandler(text);
            }
          }
        },
      );

      // Wait for connection to be ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("WhatsApp connection timed out")),
          60_000,
        );

        sock.ev.on(
          "connection.update",
          (update: {
            connection?: string;
            lastDisconnect?: { error?: { output?: { statusCode?: number } } };
          }) => {
            if (update.connection === "open") {
              clearTimeout(timeout);
              resolve();
            } else if (update.connection === "close") {
              const statusCode = update.lastDisconnect?.error?.output?.statusCode;
              // 401 = logged out, need to re-scan QR
              if (statusCode === 401) {
                // Clear credentials and let the user re-pair
                fs.rmSync(credDir, { recursive: true, force: true });
                fs.mkdirSync(credDir, { recursive: true });
              }
              clearTimeout(timeout);
              reject(new Error(`WhatsApp connection closed (status: ${statusCode ?? "unknown"})`));
            }
          },
        );
      });
    },

    async send(jid: string, text: string): Promise<void> {
      if (!sock) return;
      await sock.sendMessage(jid, { text });
    },

    onMessage(handler: (text: string) => void): void {
      messageHandler = handler;
    },

    async disconnect(): Promise<void> {
      if (sock) {
        await sock.logout().catch(() => {});
        sock.end(undefined);
        sock = null;
      }
      messageHandler = null;
    },
  };
}
