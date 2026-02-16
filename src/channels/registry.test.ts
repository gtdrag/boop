import { describe, expect, it } from "vitest";
import { CHAT_CHANNEL_ORDER, isValidChannel, listChannels } from "./registry.js";

describe("channel registry", () => {
  it("lists telegram and whatsapp channels", () => {
    expect(CHAT_CHANNEL_ORDER).toEqual(["telegram", "whatsapp"]);
  });

  it("validates channel ids", () => {
    expect(isValidChannel("telegram")).toBe(true);
    expect(isValidChannel("whatsapp")).toBe(true);
    expect(isValidChannel("discord")).toBe(false);
    expect(isValidChannel("slack")).toBe(false);
  });

  it("lists channel metadata", () => {
    const channels = listChannels();
    expect(channels).toHaveLength(2);
    expect(channels[0]?.id).toBe("telegram");
    expect(channels[1]?.id).toBe("whatsapp");
  });
});
