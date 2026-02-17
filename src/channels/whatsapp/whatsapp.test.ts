import { afterEach, describe, expect, it, vi } from "vitest";
import { createWhatsAppAdapter } from "./index.js";
import type { WhatsAppConfig, WhatsAppAdapterDeps } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<WhatsAppConfig> = {}): WhatsAppConfig {
  return {
    enabled: true,
    phoneNumber: "+1234567890",
    ...overrides,
  };
}

function makeDeps() {
  const state = { messageHandler: null as ((text: string) => void) | null };
  const mockConnect = vi
    .fn<(config: WhatsAppConfig) => Promise<void>>()
    .mockResolvedValue(undefined);
  const mockSend = vi
    .fn<(jid: string, text: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const mockDisconnect = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  const deps: WhatsAppAdapterDeps = {
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

describe("createWhatsAppAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("start", () => {
    it("connects when enabled with phone number", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);

      await adapter.start();

      expect(deps.mockConnect).toHaveBeenCalledOnce();
      expect(deps.mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          phoneNumber: "+1234567890",
        }),
      );
    });

    it("does not connect when disabled", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig({ enabled: false }), deps);

      await adapter.start();

      expect(deps.mockConnect).not.toHaveBeenCalled();
    });

    it("does not connect without phone number", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig({ phoneNumber: undefined }), deps);

      await adapter.start();

      expect(deps.mockConnect).not.toHaveBeenCalled();
    });

    it("does not double-connect", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);

      await adapter.start();
      await adapter.start();

      expect(deps.mockConnect).toHaveBeenCalledOnce();
    });

    it("registers message handler", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);

      await adapter.start();

      expect(deps.state.messageHandler).not.toBeNull();
    });
  });

  describe("stop", () => {
    it("disconnects when connected", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);

      await adapter.start();
      await adapter.stop();

      expect(deps.mockDisconnect).toHaveBeenCalledOnce();
    });

    it("does not disconnect when not connected", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);

      await adapter.stop();

      expect(deps.mockDisconnect).not.toHaveBeenCalled();
    });

    it("resolves pending waitForReply with null on stop", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);
      await adapter.start();

      // Start waiting — will not resolve until message or stop
      const replyPromise = adapter.waitForReply(0);
      await adapter.stop();

      const reply = await replyPromise;
      expect(reply).toBeNull();
    });
  });

  describe("send", () => {
    it("sends message to correct JID", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);
      await adapter.start();

      await adapter.send({ text: "Hello!", type: "status" });

      expect(deps.mockSend).toHaveBeenCalledOnce();
      expect(deps.mockSend).toHaveBeenCalledWith("1234567890@s.whatsapp.net", "Hello!");
    });

    it("strips non-numeric chars from phone for JID", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig({ phoneNumber: "+1 (234) 567-8900" }), deps);
      await adapter.start();

      await adapter.send({ text: "Hi" });

      expect(deps.mockSend).toHaveBeenCalledWith("12345678900@s.whatsapp.net", "Hi");
    });

    it("does not send when not connected", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);

      await adapter.send({ text: "Hello!" });

      expect(deps.mockSend).not.toHaveBeenCalled();
    });
  });

  describe("waitForReply", () => {
    it("returns null when not connected", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);

      const reply = await adapter.waitForReply(1000);
      expect(reply).toBeNull();
    });

    it("resolves with inbound message when handler fires", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);
      await adapter.start();

      const replyPromise = adapter.waitForReply(0);

      // Simulate incoming message
      deps.state.messageHandler!("approve");

      const reply = await replyPromise;
      expect(reply).not.toBeNull();
      expect(reply!.text).toBe("approve");
      expect(reply!.channel).toBe("whatsapp");
      expect(reply!.receivedAt).toBeTruthy();
    });

    it("returns null on timeout", async () => {
      const deps = makeDeps();
      const adapter = createWhatsAppAdapter(makeConfig(), deps);
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
      const adapter = createWhatsAppAdapter(makeConfig(), deps);
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
      const adapter = createWhatsAppAdapter(makeConfig());
      await adapter.start();
      await adapter.send({ text: "hello" });
      await adapter.stop();
      // Should not throw
    });
  });
});
