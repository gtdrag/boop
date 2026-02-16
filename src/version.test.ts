import { describe, expect, it } from "vitest";
import { VERSION } from "./version.js";

describe("version", () => {
  it("resolves a version string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it("matches package.json version", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
