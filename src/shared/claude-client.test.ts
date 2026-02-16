import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { isRetryableApiError } from "./claude-client.js";

function makeApiError(status: number, message: string): Anthropic.APIError {
  // APIError expects Headers-like object with a .get() method
  const headers = new Headers();
  return new Anthropic.APIError(status, undefined, message, headers);
}

describe("claude-client", () => {
  describe("isRetryableApiError", () => {
    it("returns true for rate limit errors (429)", () => {
      const error = makeApiError(429, "Rate limited");
      expect(isRetryableApiError(error)).toBe(true);
    });

    it("returns true for server errors (500)", () => {
      const error = makeApiError(500, "Internal error");
      expect(isRetryableApiError(error)).toBe(true);
    });

    it("returns true for server errors (503)", () => {
      const error = makeApiError(503, "Overloaded");
      expect(isRetryableApiError(error)).toBe(true);
    });

    it("returns false for auth errors (401)", () => {
      const error = makeApiError(401, "Invalid key");
      expect(isRetryableApiError(error)).toBe(false);
    });

    it("returns false for bad request errors (400)", () => {
      const error = makeApiError(400, "Bad request");
      expect(isRetryableApiError(error)).toBe(false);
    });

    it("returns true for fetch-related errors", () => {
      const error = new Error("fetch failed: connection refused");
      expect(isRetryableApiError(error)).toBe(true);
    });

    it("returns false for generic errors", () => {
      const error = new Error("something broke");
      expect(isRetryableApiError(error)).toBe(false);
    });
  });
});
