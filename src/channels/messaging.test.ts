import { describe, expect, it, vi } from "vitest";
import {
  MessagingDispatcher,
  createMessagingDispatcher,
  messagingConfigFromProfile,
  sanitizeForMessaging,
} from "./messaging.js";
import type {
  ChannelAdapter,
  InboundMessage,
  MessagingConfig,
  OutboundMessage,
} from "./messaging.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockAdapter(): ChannelAdapter & {
  sentMessages: OutboundMessage[];
  mockWaitForReply: ReturnType<typeof vi.fn>;
  mockStart: ReturnType<typeof vi.fn>;
  mockStop: ReturnType<typeof vi.fn>;
} {
  const sentMessages: OutboundMessage[] = [];
  const mockWaitForReply = vi
    .fn<(timeoutMs: number) => Promise<InboundMessage | null>>()
    .mockResolvedValue(null);
  const mockStart = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const mockStop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  return {
    sentMessages,
    mockWaitForReply,
    mockStart,
    mockStop,
    async start() {
      await mockStart();
    },
    async stop() {
      await mockStop();
    },
    async send(msg: OutboundMessage) {
      sentMessages.push(msg);
    },
    async waitForReply(timeoutMs: number) {
      return mockWaitForReply(timeoutMs);
    },
  };
}

function makeConfig(overrides: Partial<MessagingConfig> = {}): MessagingConfig {
  return {
    channel: "telegram",
    telegramChatId: "123456",
    telegramBotToken: "bot:token",
    replyTimeout: 60,
    ...overrides,
  };
}

function makeReply(text: string): InboundMessage {
  return {
    text,
    channel: "telegram",
    receivedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// sanitizeForMessaging
// ---------------------------------------------------------------------------

describe("sanitizeForMessaging", () => {
  it("passes through normal text", () => {
    const text = "Build complete for Epic 1.";
    expect(sanitizeForMessaging(text)).toBe(text);
  });

  it("replaces text containing 'password'", () => {
    const result = sanitizeForMessaging("Please enter your password");
    expect(result).toContain("Never send passwords");
    expect(result).toContain("boop --profile");
  });

  it("replaces text containing 'api key'", () => {
    const result = sanitizeForMessaging("What is your API key?");
    expect(result).toContain("Never send passwords");
  });

  it("replaces text containing 'auth token'", () => {
    const result = sanitizeForMessaging("Enter your auth token");
    expect(result).toContain("Never send passwords");
  });

  it("replaces text containing 'api token'", () => {
    const result = sanitizeForMessaging("Set your API token");
    expect(result).toContain("Never send passwords");
  });

  it("replaces text containing 'client secret'", () => {
    const result = sanitizeForMessaging("What is the client secret?");
    expect(result).toContain("Never send passwords");
  });

  it("replaces text containing 'secret key'", () => {
    const result = sanitizeForMessaging("Enter your secret key");
    expect(result).toContain("Never send passwords");
  });

  it("replaces text containing 'credential'", () => {
    const result = sanitizeForMessaging("Provide your credentials");
    expect(result).toContain("Never send passwords");
  });

  it("replaces text containing 'private key'", () => {
    const result = sanitizeForMessaging("Upload your private key");
    expect(result).toContain("Never send passwords");
  });

  it("is case-insensitive", () => {
    const result = sanitizeForMessaging("Enter your PASSWORD");
    expect(result).toContain("Never send passwords");
  });

  it("does NOT flag standalone 'token' without credential context", () => {
    const text = "Processing token count for Epic 3.";
    expect(sanitizeForMessaging(text)).toBe(text);
  });

  it("does NOT flag standalone 'secret' without credential context", () => {
    const text = "This is the secret sauce of the architecture.";
    expect(sanitizeForMessaging(text)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// MessagingDispatcher
// ---------------------------------------------------------------------------

describe("MessagingDispatcher", () => {
  describe("enabled", () => {
    it("returns false when channel is 'none'", () => {
      const dispatcher = new MessagingDispatcher(makeConfig({ channel: "none" }));
      expect(dispatcher.enabled).toBe(false);
    });

    it("returns false when no adapter is set", () => {
      const dispatcher = new MessagingDispatcher(makeConfig());
      expect(dispatcher.enabled).toBe(false);
    });

    it("returns true when channel is set and adapter is provided", () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      expect(dispatcher.enabled).toBe(true);
    });
  });

  describe("setAdapter", () => {
    it("enables messaging after setting adapter", () => {
      const dispatcher = new MessagingDispatcher(makeConfig());
      expect(dispatcher.enabled).toBe(false);

      dispatcher.setAdapter(makeMockAdapter());
      expect(dispatcher.enabled).toBe(true);
    });
  });

  describe("start / stop", () => {
    it("starts the adapter", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();
      expect(adapter.mockStart).toHaveBeenCalledOnce();
    });

    it("stops the adapter", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();
      await dispatcher.stop();
      expect(adapter.mockStop).toHaveBeenCalledOnce();
    });

    it("no-ops when disabled", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig({ channel: "none" }), adapter);
      await dispatcher.start();
      expect(adapter.mockStart).not.toHaveBeenCalled();
    });

    it("does not double-start", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();
      await dispatcher.start();
      expect(adapter.mockStart).toHaveBeenCalledOnce();
    });

    it("does not stop if not started", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.stop();
      expect(adapter.mockStop).not.toHaveBeenCalled();
    });
  });

  describe("notify", () => {
    it("sends pipeline event notification", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      await dispatcher.notify("planning-complete", { epic: 3 });

      expect(adapter.sentMessages).toHaveLength(1);
      expect(adapter.sentMessages[0]!.text).toContain("Planning complete for Epic 3");
      expect(adapter.sentMessages[0]!.type).toBe("status");
    });

    it("sends build-started notification", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      await dispatcher.notify("build-started", { epic: 2 });
      expect(adapter.sentMessages[0]!.text).toContain("Build started for Epic 2");
    });

    it("sends error notification with detail", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      await dispatcher.notify("error", { detail: "API rate limited" });
      expect(adapter.sentMessages[0]!.text).toContain("API rate limited");
    });

    it("no-ops when disabled", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig({ channel: "none" }), adapter);
      await dispatcher.notify("build-complete", { epic: 1 });
      expect(adapter.sentMessages).toHaveLength(0);
    });

    it("sends deployment-started notification", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      await dispatcher.notify("deployment-started", { epic: 1 });
      expect(adapter.sentMessages[0]!.text).toContain("Deploying Epic 1");
    });

    it("sends deployment-complete notification with detail", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      await dispatcher.notify("deployment-complete", { epic: 1, detail: "https://app.vercel.app" });
      expect(adapter.sentMessages[0]!.text).toContain("Deployment complete");
      expect(adapter.sentMessages[0]!.text).toContain("https://app.vercel.app");
    });

    it("sends deployment-failed notification with error detail", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      await dispatcher.notify("deployment-failed", { epic: 1, detail: "CLI not found" });
      expect(adapter.sentMessages[0]!.text).toContain("Deployment failed");
      expect(adapter.sentMessages[0]!.text).toContain("CLI not found");
    });
  });

  describe("send", () => {
    it("sends a message via the adapter", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      await dispatcher.send({ text: "Hello", type: "status" });

      expect(adapter.sentMessages).toHaveLength(1);
      expect(adapter.sentMessages[0]!.text).toBe("Hello");
    });

    it("sanitizes credential-related messages", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      await dispatcher.send({ text: "Enter your API key for deployment" });

      expect(adapter.sentMessages[0]!.text).toContain("Never send passwords");
      expect(adapter.sentMessages[0]!.text).not.toContain("API key for deployment");
    });
  });

  describe("sendSummary", () => {
    it("sends epic summary with header", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      await dispatcher.sendSummary(2, "All tests passed.");

      expect(adapter.sentMessages).toHaveLength(1);
      expect(adapter.sentMessages[0]!.text).toContain("Epic 2 Review Summary");
      expect(adapter.sentMessages[0]!.text).toContain("All tests passed.");
      expect(adapter.sentMessages[0]!.type).toBe("summary");
    });

    it("truncates long summaries", async () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      const longSummary = "x".repeat(5000);
      await dispatcher.sendSummary(1, longSummary);

      expect(adapter.sentMessages[0]!.text.length).toBeLessThan(4100);
      expect(adapter.sentMessages[0]!.text).toContain("truncated");
    });
  });

  describe("ask", () => {
    it("returns 'disabled' when channel is none", async () => {
      const dispatcher = new MessagingDispatcher(makeConfig({ channel: "none" }));
      const result = await dispatcher.ask("What color?");
      expect(result).toEqual({ replied: false, reason: "disabled" });
    });

    it("returns 'no-channel' when adapter is missing", async () => {
      const dispatcher = new MessagingDispatcher(makeConfig());
      const result = await dispatcher.ask("What color?");
      expect(result).toEqual({ replied: false, reason: "no-channel" });
    });

    it("sends the question and returns user reply", async () => {
      const adapter = makeMockAdapter();
      adapter.mockWaitForReply.mockResolvedValue(makeReply("blue"));

      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      const result = await dispatcher.ask("What color?");

      expect(adapter.sentMessages).toHaveLength(1);
      expect(adapter.sentMessages[0]!.text).toBe("What color?");
      expect(adapter.sentMessages[0]!.type).toBe("question");
      expect(result).toEqual({
        replied: true,
        message: expect.objectContaining({ text: "blue" }),
      });
    });

    it("returns timeout when no reply", async () => {
      const adapter = makeMockAdapter();
      adapter.mockWaitForReply.mockResolvedValue(null);

      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      const result = await dispatcher.ask("What color?");
      expect(result).toEqual({ replied: false, reason: "timeout" });
    });

    it("sanitizes credential-related questions", async () => {
      const adapter = makeMockAdapter();
      adapter.mockWaitForReply.mockResolvedValue(null);

      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      await dispatcher.ask("What is your database password?");

      expect(adapter.sentMessages[0]!.text).toContain("Never send passwords");
    });

    it("does not send blank message when question is empty", async () => {
      const adapter = makeMockAdapter();
      adapter.mockWaitForReply.mockResolvedValue(makeReply("yes"));

      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      const result = await dispatcher.ask("");

      expect(adapter.sentMessages).toHaveLength(0);
      expect(result).toEqual({
        replied: true,
        message: expect.objectContaining({ text: "yes" }),
      });
    });

    it("uses configured replyTimeout", async () => {
      const adapter = makeMockAdapter();
      adapter.mockWaitForReply.mockResolvedValue(null);

      const config = makeConfig({ replyTimeout: 120 });
      const dispatcher = new MessagingDispatcher(config, adapter);
      await dispatcher.start();

      await dispatcher.ask("Question?");

      // replyTimeout is in seconds, waitForReply expects ms
      expect(adapter.mockWaitForReply).toHaveBeenCalledWith(120000);
    });
  });

  describe("createSignOffPrompt", () => {
    it("returns undefined when disabled", () => {
      const dispatcher = new MessagingDispatcher(makeConfig({ channel: "none" }));
      expect(dispatcher.createSignOffPrompt()).toBeUndefined();
    });

    it("returns a function when enabled", () => {
      const adapter = makeMockAdapter();
      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      expect(dispatcher.createSignOffPrompt()).toBeTypeOf("function");
    });

    it("approves when user replies 'approve'", async () => {
      const adapter = makeMockAdapter();
      // First waitForReply is from ask("") inside createSignOffPrompt
      adapter.mockWaitForReply.mockResolvedValue(makeReply("approve"));

      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      const signOff = dispatcher.createSignOffPrompt()!;
      const result = await signOff({ epicNumber: 1, markdown: "Summary" });

      expect(result.action).toBe("approve");
    });

    it("approves when user replies 'lgtm'", async () => {
      const adapter = makeMockAdapter();
      adapter.mockWaitForReply.mockResolvedValue(makeReply("LGTM"));

      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      const signOff = dispatcher.createSignOffPrompt()!;
      const result = await signOff({ epicNumber: 1, markdown: "Summary" });

      expect(result.action).toBe("approve");
    });

    it("rejects with feedback when user provides text", async () => {
      const adapter = makeMockAdapter();
      adapter.mockWaitForReply.mockResolvedValue(makeReply("Fix the button spacing"));

      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      const signOff = dispatcher.createSignOffPrompt()!;
      const result = await signOff({ epicNumber: 1, markdown: "Summary" });

      expect(result).toEqual({
        action: "reject",
        feedback: "Fix the button spacing",
      });
    });

    it("auto-approves on timeout with local review instruction", async () => {
      const adapter = makeMockAdapter();
      adapter.mockWaitForReply.mockResolvedValue(null); // timeout

      const dispatcher = new MessagingDispatcher(makeConfig(), adapter);
      await dispatcher.start();

      const signOff = dispatcher.createSignOffPrompt()!;
      const result = await signOff({ epicNumber: 1, markdown: "Summary" });

      // Should auto-approve and send instruction to use local review
      expect(result.action).toBe("approve");
      // Should have sent the timeout message (says "continuing", not "paused")
      expect(adapter.sentMessages.some((m) => m.text.includes("No reply received"))).toBe(true);
      expect(adapter.sentMessages.some((m) => m.text.includes("Pipeline continuing"))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// createMessagingDispatcher
// ---------------------------------------------------------------------------

describe("createMessagingDispatcher", () => {
  it("creates a dispatcher from config", () => {
    const dispatcher = createMessagingDispatcher(makeConfig());
    // No adapter set, so disabled
    expect(dispatcher.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// messagingConfigFromProfile
// ---------------------------------------------------------------------------

describe("messagingConfigFromProfile", () => {
  it("extracts config from profile with telegram", () => {
    const config = messagingConfigFromProfile({
      notificationChannel: "telegram",
      telegramChatId: "123",
      telegramBotToken: "bot:tok",
      notificationTimeout: 180,
    });

    expect(config.channel).toBe("telegram");
    expect(config.telegramChatId).toBe("123");
    expect(config.telegramBotToken).toBe("bot:tok");
    expect(config.replyTimeout).toBe(180);
  });

  it("extracts config from profile with whatsapp", () => {
    const config = messagingConfigFromProfile({
      notificationChannel: "whatsapp",
      phoneNumber: "+1234567890",
    });

    expect(config.channel).toBe("whatsapp");
    expect(config.phoneNumber).toBe("+1234567890");
  });

  it("defaults to 'none' when no channel set", () => {
    const config = messagingConfigFromProfile({});
    expect(config.channel).toBe("none");
  });

  it("defaults timeout to 300 seconds", () => {
    const config = messagingConfigFromProfile({});
    expect(config.replyTimeout).toBe(300);
  });
});
