/**
 * Bidirectional messaging dispatcher.
 *
 * Channel-agnostic layer for sending notifications and receiving user input
 * via WhatsApp or Telegram. The pipeline uses this to:
 *   - Send status updates (planning complete, build started, etc.)
 *   - Send epic summaries for sign-off
 *   - Ask questions and wait for user replies
 *   - Route user replies back to the pipeline
 *
 * Credential requests are never sent as plaintext — users are instructed
 * to provide credentials via a secure local method.
 */
import type { ChatChannelId } from "./registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the messaging system. */
export interface MessagingConfig {
  /** Which channel to use. "none" disables messaging. */
  channel: ChatChannelId | "none";
  /** WhatsApp phone number (with country code, e.g. "+1234567890"). */
  phoneNumber?: string;
  /** Telegram chat ID (numeric string). */
  telegramChatId?: string;
  /** Telegram bot token. */
  telegramBotToken?: string;
  /** Timeout in seconds for waiting for user replies. 0 = no timeout. */
  replyTimeout?: number;
}

/** A message to send to the user. */
export interface OutboundMessage {
  /** Human-readable text (supports markdown subset). */
  text: string;
  /** Optional message type for categorization. */
  type?: "status" | "summary" | "question" | "error";
}

/** A reply received from the user. */
export interface InboundMessage {
  /** Raw text of the user's reply. */
  text: string;
  /** Channel the reply came from. */
  channel: ChatChannelId;
  /** ISO-8601 timestamp. */
  receivedAt: string;
}

/** Interface that channel adapters must implement. */
export interface ChannelAdapter {
  /** Send a text message to the configured user. */
  send(message: OutboundMessage): Promise<void>;
  /** Wait for the next inbound message from the user. Returns null on timeout. */
  waitForReply(timeoutMs: number): Promise<InboundMessage | null>;
  /** Start the adapter (connect, authenticate, etc.). */
  start(): Promise<void>;
  /** Stop the adapter (disconnect, clean up). */
  stop(): Promise<void>;
}

/** Result of asking a question via messaging. */
export type AskResult =
  | { replied: true; message: InboundMessage }
  | { replied: false; reason: "timeout" | "no-channel" | "disabled" };

/** Pipeline event types that trigger notifications. */
export type PipelineEvent =
  | "planning-complete"
  | "build-started"
  | "build-complete"
  | "review-complete"
  | "sign-off-ready"
  | "epic-complete"
  | "error";

// ---------------------------------------------------------------------------
// Credential Safety
// ---------------------------------------------------------------------------

const CREDENTIAL_PATTERNS = [
  /password/i,
  /secret/i,
  /api.?key/i,
  /token/i,
  /credential/i,
  /private.?key/i,
  /\bauth\b/i,
];

/**
 * Check if a message appears to contain or request credentials.
 * If detected, replaces the sensitive content with a safe instruction.
 */
export function sanitizeForMessaging(text: string): string {
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) {
      return (
        "Boop needs some configuration that may involve sensitive data. " +
        "Please provide credentials locally via:\n" +
        "  boop --profile\n" +
        "or set them in ~/.boop/profile.yaml\n\n" +
        "Never send passwords, tokens, or API keys over messaging channels."
      );
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Default messages for pipeline events
// ---------------------------------------------------------------------------

const EVENT_MESSAGES: Record<PipelineEvent, (ctx: { epic?: number; detail?: string }) => string> = {
  "planning-complete": (ctx) =>
    `Planning complete for Epic ${ctx.epic ?? "?"}. Moving to build phase.`,
  "build-started": (ctx) => `Build started for Epic ${ctx.epic ?? "?"}.`,
  "build-complete": (ctx) => `Build complete for Epic ${ctx.epic ?? "?"}. Starting review phase.`,
  "review-complete": (ctx) =>
    `Review complete for Epic ${ctx.epic ?? "?"}. ${ctx.detail ?? "Ready for sign-off."}`,
  "sign-off-ready": (ctx) =>
    `Epic ${ctx.epic ?? "?"} is ready for sign-off.\n\n${ctx.detail ?? "Reply 'approve' or provide feedback to reject."}`,
  "epic-complete": (ctx) => `Epic ${ctx.epic ?? "?"} approved and complete!`,
  error: (ctx) => `Error in pipeline: ${ctx.detail ?? "Unknown error"}`,
};

// ---------------------------------------------------------------------------
// Messaging Dispatcher
// ---------------------------------------------------------------------------

export class MessagingDispatcher {
  private readonly config: MessagingConfig;
  private adapter: ChannelAdapter | null = null;
  private started = false;

  constructor(
    config: MessagingConfig,
    adapter?: ChannelAdapter,
  ) {
    this.config = config;
    this.adapter = adapter ?? null;
  }

  /** Whether messaging is enabled. */
  get enabled(): boolean {
    return this.config.channel !== "none" && this.adapter !== null;
  }

  /** Set the channel adapter (for late binding / dependency injection). */
  setAdapter(adapter: ChannelAdapter): void {
    this.adapter = adapter;
  }

  /** Start the messaging adapter. */
  async start(): Promise<void> {
    if (!this.enabled || !this.adapter || this.started) return;
    await this.adapter.start();
    this.started = true;
  }

  /** Stop the messaging adapter. */
  async stop(): Promise<void> {
    if (!this.adapter || !this.started) return;
    await this.adapter.stop();
    this.started = false;
  }

  /**
   * Send a pipeline event notification.
   * No-op if messaging is disabled.
   */
  async notify(
    event: PipelineEvent,
    context?: { epic?: number; detail?: string },
  ): Promise<void> {
    if (!this.enabled || !this.adapter) return;

    const text = EVENT_MESSAGES[event](context ?? {});
    await this.adapter.send({ text, type: "status" });
  }

  /**
   * Send a message to the user.
   * No-op if messaging is disabled.
   */
  async send(message: OutboundMessage): Promise<void> {
    if (!this.enabled || !this.adapter) return;

    const safeText = sanitizeForMessaging(message.text);
    await this.adapter.send({ ...message, text: safeText });
  }

  /**
   * Send the epic summary for sign-off via messaging.
   * Truncates to fit messaging limits.
   */
  async sendSummary(epicNumber: number, markdown: string): Promise<void> {
    if (!this.enabled || !this.adapter) return;

    // Truncate summary for messaging (WhatsApp/Telegram have limits)
    const MAX_MESSAGE_LENGTH = 4000;
    let text = `Epic ${epicNumber} Review Summary\n\n${markdown}`;
    if (text.length > MAX_MESSAGE_LENGTH) {
      text = text.slice(0, MAX_MESSAGE_LENGTH - 100) + "\n\n... (truncated, see full summary in .boop/reviews/)";
    }

    await this.adapter.send({ text, type: "summary" });
  }

  /**
   * Ask the user a question and wait for their reply.
   *
   * Returns the user's response, or a reason if no reply was received.
   * Credential-related questions are rejected with a safe message.
   */
  async ask(question: string): Promise<AskResult> {
    if (!this.enabled || !this.adapter) {
      return { replied: false, reason: this.config.channel === "none" ? "disabled" : "no-channel" };
    }

    const safeQuestion = sanitizeForMessaging(question);
    await this.adapter.send({ text: safeQuestion, type: "question" });

    const timeoutMs = (this.config.replyTimeout ?? 0) * 1000;
    const reply = await this.adapter.waitForReply(timeoutMs);

    if (!reply) {
      return { replied: false, reason: "timeout" };
    }

    return { replied: true, message: reply };
  }

  /**
   * Create a SignOffPromptFn that works via messaging.
   *
   * Sends the epic summary, then waits for the user to reply
   * with "approve" or feedback text.
   */
  createSignOffPrompt(): ((summary: { epicNumber: number; markdown: string }) => Promise<{ action: "approve" } | { action: "reject"; feedback: string }>) | undefined {
    if (!this.enabled) return undefined;

    return async (summary) => {
      await this.sendSummary(summary.epicNumber, summary.markdown);
      await this.send({
        text: "Reply 'approve' to sign off, or provide feedback to request changes.",
        type: "question",
      });

      const result = await this.ask("");

      if (!result.replied) {
        // Timeout — treat as needing local review
        await this.send({
          text: "No reply received. Pipeline paused. Use 'npx boop --review' to continue locally.",
          type: "status",
        });
        // Return approve to not block — user can use local review
        return { action: "approve" as const };
      }

      const reply = result.message.text.trim().toLowerCase();
      if (reply === "approve" || reply === "approved" || reply === "yes" || reply === "lgtm") {
        return { action: "approve" as const };
      }

      return { action: "reject" as const, feedback: result.message.text.trim() };
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a MessagingDispatcher from config.
 * Does NOT start the adapter — caller must call .start().
 */
export function createMessagingDispatcher(config: MessagingConfig): MessagingDispatcher {
  return new MessagingDispatcher(config);
}

/**
 * Extract MessagingConfig from a developer profile.
 */
export function messagingConfigFromProfile(profile: {
  notificationChannel?: string;
  phoneNumber?: string;
  telegramChatId?: string;
  telegramBotToken?: string;
  notificationTimeout?: number;
}): MessagingConfig {
  const channel = profile.notificationChannel ?? "none";
  return {
    channel: channel as ChatChannelId | "none",
    phoneNumber: profile.phoneNumber,
    telegramChatId: profile.telegramChatId,
    telegramBotToken: profile.telegramBotToken,
    replyTimeout: profile.notificationTimeout ?? 300,
  };
}
