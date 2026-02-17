import { describe, expect, it, afterEach } from "vitest";
import { getProviderConfig, sanitizeDockerTag } from "./providers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Store original env so we can restore after each test. */
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// Vercel
// ---------------------------------------------------------------------------

describe("vercel", () => {
  it("returns cli strategy with correct command", () => {
    const config = getProviderConfig("vercel", "my-app");

    expect(config.strategy).toBe("cli");
    expect(config.displayName).toBe("Vercel");
    expect(config.command).toBeDefined();
    expect(config.command!.command).toBe("npx");
    expect(config.command!.args).toEqual(["vercel", "--yes", "--prod"]);
  });

  it("has a URL pattern matching vercel.app domains", () => {
    const config = getProviderConfig("vercel", "my-app");
    const match = "https://my-app-abc123.vercel.app".match(config.command!.urlPattern);

    expect(match).not.toBeNull();
  });

  it("passes VERCEL_TOKEN env when set", () => {
    process.env.VERCEL_TOKEN = "test-token";
    const config = getProviderConfig("vercel", "my-app");

    expect(config.command!.env).toBeDefined();
    expect(config.command!.env!.VERCEL_TOKEN).toBe("test-token");
  });

  it("omits env when no tokens are set", () => {
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_ORG_ID;
    delete process.env.VERCEL_PROJECT_ID;
    const config = getProviderConfig("vercel", "my-app");

    expect(config.command!.env).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Railway
// ---------------------------------------------------------------------------

describe("railway", () => {
  it("returns cli strategy with correct command", () => {
    const config = getProviderConfig("railway", "my-app");

    expect(config.strategy).toBe("cli");
    expect(config.displayName).toBe("Railway");
    expect(config.command!.command).toBe("railway");
    expect(config.command!.args).toEqual(["up", "--detach"]);
  });

  it("has a URL pattern matching railway.app domains", () => {
    const config = getProviderConfig("railway", "my-app");
    const match = "https://my-app.up.railway.app".match(config.command!.urlPattern);

    expect(match).not.toBeNull();
  });

  it("passes RAILWAY_TOKEN env when set", () => {
    process.env.RAILWAY_TOKEN = "test-token";
    const config = getProviderConfig("railway", "my-app");

    expect(config.command!.env).toBeDefined();
    expect(config.command!.env!.RAILWAY_TOKEN).toBe("test-token");
  });
});

// ---------------------------------------------------------------------------
// Fly
// ---------------------------------------------------------------------------

describe("fly", () => {
  it("returns cli strategy with correct command", () => {
    const config = getProviderConfig("fly", "my-app");

    expect(config.strategy).toBe("cli");
    expect(config.displayName).toBe("Fly.io");
    expect(config.command!.command).toBe("fly");
    expect(config.command!.args).toEqual(["deploy"]);
  });

  it("has a URL pattern matching fly.dev domains", () => {
    const config = getProviderConfig("fly", "my-app");
    const match = "https://my-app.fly.dev".match(config.command!.urlPattern);

    expect(match).not.toBeNull();
  });

  it("passes FLY_API_TOKEN env when set", () => {
    process.env.FLY_API_TOKEN = "test-token";
    const config = getProviderConfig("fly", "my-app");

    expect(config.command!.env).toBeDefined();
    expect(config.command!.env!.FLY_API_TOKEN).toBe("test-token");
  });
});

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

describe("docker", () => {
  it("returns cli strategy with build command", () => {
    const config = getProviderConfig("docker", "my-app");

    expect(config.strategy).toBe("cli");
    expect(config.displayName).toBe("Docker");
    expect(config.command!.command).toBe("docker");
    expect(config.command!.args).toEqual(["build", "-t", "my-app", "."]);
  });

  it("uses project name in docker tag", () => {
    const config = getProviderConfig("docker", "cool-project");

    expect(config.command!.args).toContain("cool-project");
  });

  it("URL pattern never matches (local build)", () => {
    const config = getProviderConfig("docker", "my-app");
    const match = "https://my-app.example.com".match(config.command!.urlPattern);

    expect(match).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Agent-based providers (AWS, GCP, Azure)
// ---------------------------------------------------------------------------

describe("agent-based providers", () => {
  it.each(["aws", "gcp", "azure"])("%s returns agent strategy", (provider) => {
    const config = getProviderConfig(provider, "my-app");

    expect(config.strategy).toBe("agent");
    expect(config.command).toBeUndefined();
  });

  it("aws has displayName AWS", () => {
    expect(getProviderConfig("aws", "my-app").displayName).toBe("AWS");
  });

  it("gcp has displayName GCP", () => {
    expect(getProviderConfig("gcp", "my-app").displayName).toBe("GCP");
  });

  it("azure has displayName Azure", () => {
    expect(getProviderConfig("azure", "my-app").displayName).toBe("Azure");
  });
});

// ---------------------------------------------------------------------------
// Skip (none)
// ---------------------------------------------------------------------------

describe("none", () => {
  it("returns skip strategy", () => {
    const config = getProviderConfig("none", "my-app");

    expect(config.strategy).toBe("skip");
    expect(config.displayName).toBe("none");
    expect(config.command).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unknown providers
// ---------------------------------------------------------------------------

describe("unknown providers", () => {
  it("defaults to agent strategy", () => {
    const config = getProviderConfig("heroku", "my-app");

    expect(config.strategy).toBe("agent");
    expect(config.displayName).toBe("heroku");
  });

  it("is case-insensitive", () => {
    const config = getProviderConfig("Vercel", "my-app");

    expect(config.strategy).toBe("cli");
    expect(config.displayName).toBe("Vercel");
  });

  it("sanitizes special characters in unknown provider names", () => {
    const config = getProviderConfig('my<script>provider"', "my-app");

    expect(config.strategy).toBe("agent");
    expect(config.displayName).not.toContain("<");
    expect(config.displayName).not.toContain('"');
    expect(config.displayName).toBe("myscriptprovider");
  });

  it("truncates very long unknown provider names to 50 chars", () => {
    const longName = "a".repeat(200);
    const config = getProviderConfig(longName, "my-app");

    expect(config.displayName.length).toBeLessThanOrEqual(50);
  });

  it("falls back to 'unknown' for all-special-chars provider", () => {
    const config = getProviderConfig("!@#$%^&*()", "my-app");

    expect(config.displayName).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// sanitizeDockerTag
// ---------------------------------------------------------------------------

describe("sanitizeDockerTag", () => {
  it("lowercases the input", () => {
    expect(sanitizeDockerTag("MyApp")).toBe("myapp");
  });

  it("replaces invalid characters with hyphens and strips trailing separators", () => {
    expect(sanitizeDockerTag("my app!@#")).toBe("my-app");
  });

  it("strips leading special characters", () => {
    expect(sanitizeDockerTag("--my-app")).toBe("my-app");
  });

  it("returns 'app' for empty string", () => {
    expect(sanitizeDockerTag("")).toBe("app");
  });

  it("returns 'app' for all-special-chars input", () => {
    expect(sanitizeDockerTag("!!!")).toBe("app");
  });

  it("preserves valid characters", () => {
    expect(sanitizeDockerTag("my-app_v1.2")).toBe("my-app_v1.2");
  });

  it("sanitizes docker tag used in config", () => {
    const config = getProviderConfig("docker", "My App!!");
    expect(config.command!.args).toContain("my-app");
  });
});

// ---------------------------------------------------------------------------
// URL regex tightening
// ---------------------------------------------------------------------------

describe("URL regex boundaries", () => {
  it("vercel pattern stops at word boundary — does not capture attacker suffix", () => {
    const config = getProviderConfig("vercel", "my-app");
    const match = "https://evil.vercel.app.attacker.com".match(config.command!.urlPattern);
    // The regex matches the vercel.app portion but stops at \b — doesn't capture .attacker.com
    expect(match).not.toBeNull();
    expect(match![0]).toBe("https://evil.vercel.app");
  });

  it("railway pattern stops at word boundary", () => {
    const config = getProviderConfig("railway", "my-app");
    const match = "https://evil.up.railway.app.attacker.com".match(config.command!.urlPattern);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("https://evil.up.railway.app");
  });

  it("fly pattern stops at word boundary", () => {
    const config = getProviderConfig("fly", "my-app");
    const match = "https://evil.fly.dev.attacker.com".match(config.command!.urlPattern);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("https://evil.fly.dev");
  });

  it("vercel pattern does not match random domains", () => {
    const config = getProviderConfig("vercel", "my-app");
    expect("https://my-random-site.com".match(config.command!.urlPattern)).toBeNull();
  });

  it("vercel pattern matches URL with path", () => {
    const config = getProviderConfig("vercel", "my-app");
    const match = "https://my-app.vercel.app/api/health".match(config.command!.urlPattern);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("https://my-app.vercel.app/api/health");
  });

  it("railway pattern matches URL with path", () => {
    const config = getProviderConfig("railway", "my-app");
    const match = "https://my-app.up.railway.app/status".match(config.command!.urlPattern);
    expect(match).not.toBeNull();
  });

  it("fly pattern matches URL at word boundary", () => {
    const config = getProviderConfig("fly", "my-app");
    const match = "Deployed at https://my-app.fly.dev done".match(config.command!.urlPattern);
    expect(match).not.toBeNull();
    expect(match![0]).toBe("https://my-app.fly.dev");
  });
});
