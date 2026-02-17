import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramAdapter } from "./index.js";
import type { TelegramConfig, TelegramAdapterDeps } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    enabled: true,
    token: "bot:test-token",
    chatId: "987654",
    ...overrides,
  };
}

function makeDeps() {
  const state = { messageHandler: null as ((text: string) => void) | null };
  const mockConnect = vi
    .fn<(config: TelegramConfig) => Promise<void>>()
    .mockResolvedValue(undefined);
  const mockSend = vi
    .fn<(chatId: string, text: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const mockDisconnect = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  const deps: TelegramAdapterDeps = {
    connect: mockConnect,
    send: mockSend,
    disconnect: mockDisconnect,
    onMessage: (handler) => {
      state.messageHandler = handler;
    },
  };

  return { ...deps, mockConnect, mockSend, mockDisconnect, state };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTelegramAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("start", () => {
    it("connects when enabled with token and chatId", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);

      await adapter.start();

      expect(deps.mockConnect).toHaveBeenCalledOnce();
      expect(deps.mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          token: "bot:test-token",
          chatId: "987654",
        }),
      );
    });

    it("does not connect when disabled", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig({ enabled: false }), deps);

      await adapter.start();

      expect(deps.mockConnect).not.toHaveBeenCalled();
    });

    it("does not connect without token", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig({ token: undefined }), deps);

      await adapter.start();

      expect(deps.mockConnect).not.toHaveBeenCalled();
    });

    it("does not connect without chatId", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig({ chatId: undefined }), deps);

      await adapter.start();

      expect(deps.mockConnect).not.toHaveBeenCalled();
    });

    it("does not double-connect", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);

      await adapter.start();
      await adapter.start();

      expect(deps.mockConnect).toHaveBeenCalledOnce();
    });

    it("registers message handler", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);

      await adapter.start();

      expect(deps.state.messageHandler).not.toBeNull();
    });
  });

  describe("stop", () => {
    it("disconnects when connected", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);

      await adapter.start();
      await adapter.stop();

      expect(deps.mockDisconnect).toHaveBeenCalledOnce();
    });

    it("does not disconnect when not connected", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);

      await adapter.stop();

      expect(deps.mockDisconnect).not.toHaveBeenCalled();
    });

    it("resolves pending waitForReply with null on stop", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);
      await adapter.start();

      const replyPromise = adapter.waitForReply(0);
      await adapter.stop();

      const reply = await replyPromise;
      expect(reply).toBeNull();
    });
  });

  describe("send", () => {
    it("sends message to configured chat ID", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);
      await adapter.start();

      await adapter.send({ text: "Hello!", type: "status" });

      expect(deps.mockSend).toHaveBeenCalledOnce();
      expect(deps.mockSend).toHaveBeenCalledWith("987654", "Hello!");
    });

    it("does not send when not connected", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);

      await adapter.send({ text: "Hello!" });

      expect(deps.mockSend).not.toHaveBeenCalled();
    });
  });

  describe("waitForReply", () => {
    it("returns null when not connected", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);

      const reply = await adapter.waitForReply(1000);
      expect(reply).toBeNull();
    });

    it("resolves with inbound message when handler fires", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);
      await adapter.start();

      const replyPromise = adapter.waitForReply(0);

      // Simulate incoming message
      deps.state.messageHandler!("approve");

      const reply = await replyPromise;
      expect(reply).not.toBeNull();
      expect(reply!.text).toBe("approve");
      expect(reply!.channel).toBe("telegram");
      expect(reply!.receivedAt).toBeTruthy();
    });

    it("returns null on timeout", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);
      await adapter.start();

      vi.useFakeTimers();
      const replyPromise = adapter.waitForReply(5000);

      vi.advanceTimersByTime(5000);

      const reply = await replyPromise;
      expect(reply).toBeNull();

      vi.useRealTimers();
    });

    it("clears timeout when message arrives before timeout", async () => {
      const deps = makeDeps();
      const adapter = createTelegramAdapter(makeConfig(), deps);
      await adapter.start();

      vi.useFakeTimers();
      const replyPromise = adapter.waitForReply(10000);

      // Message arrives before timeout
      deps.state.messageHandler!("yes");

      const reply = await replyPromise;
      expect(reply).not.toBeNull();
      expect(reply!.text).toBe("yes");

      vi.useRealTimers();
    });
  });

  describe("no deps", () => {
    it("works without deps (no-op adapter)", async () => {
      const adapter = createTelegramAdapter(makeConfig());
      await adapter.start();
      await adapter.send({ text: "hello" });
      await adapter.stop();
      // Should not throw
    });
  });
});
