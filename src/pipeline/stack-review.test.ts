import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DeveloperProfile } from "../profile/schema.js";
import type { StackSummary } from "../planning/architecture.js";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockExists, mockSave, mockLoad } = vi.hoisted(() => ({
  mockExists: vi.fn(),
  mockSave: vi.fn(),
  mockLoad: vi.fn(),
}));

const { mockClack } = vi.hoisted(() => ({
  mockClack: {
    intro: vi.fn(),
    outro: vi.fn(),
    note: vi.fn(),
    select: vi.fn(),
    password: vi.fn(),
    isCancel: vi.fn(() => false),
  },
}));

// We need the real getRequiredCredentials/getEnvVarName but mock the store
vi.mock("../security/credentials.js", async () => {
  const actual = await vi.importActual<typeof import("../security/credentials.js")>("../security/credentials.js");
  return {
    ...actual,
    createCredentialStore: () => ({
      exists: mockExists,
      save: mockSave,
      load: mockLoad,
    }),
  };
});

vi.mock("@clack/prompts", () => mockClack);

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const BASE_PROFILE: DeveloperProfile = {
  name: "Test Dev",
  languages: ["typescript"],
  frontendFramework: "next",
  backendFramework: "express",
  database: "postgresql",
  cloudProvider: "vercel",
  styling: "tailwind",
  stateManagement: "zustand",
  analytics: "none",
  ciCd: "github-actions",
  sourceControl: "github",
  packageManager: "pnpm",
  testRunner: "vitest",
  linter: "oxlint",
  projectStructure: "single-repo",
  errorTracker: "none",
  aiModel: "claude-opus-4-6",
  autonomousByDefault: false,
};

const SAMPLE_STACK: StackSummary = {
  frontend: { framework: "next", styling: "tailwind" },
  backend: { framework: "express", apiPattern: "REST" },
  database: { primary: "postgresql", orm: "prisma" },
  infrastructure: { cloudProvider: "vercel", ciCd: "github-actions" },
  auth: { strategy: "JWT" },
  requiredServices: ["database"],
  requiredCredentials: ["VERCEL_TOKEN", "NEON_API_KEY"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runStackReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("autonomous mode", () => {
    it("passes when all required credentials exist", async () => {
      mockExists.mockReturnValue(true);

      const { runStackReview } = await import("./stack-review.js");
      const result = await runStackReview({
        profile: BASE_PROFILE,
        stackSummary: SAMPLE_STACK,
        autonomous: true,
      });

      expect(result.approved).toBe(true);
      expect(result.credentialsMissing).toEqual([]);
      expect(result.credentialsReady.length).toBeGreaterThan(0);
      expect(result.profile).toBe(BASE_PROFILE);
    });

    it("throws when credentials are missing", async () => {
      mockExists.mockImplementation((key: string) => key === "anthropic");

      const { runStackReview } = await import("./stack-review.js");

      await expect(
        runStackReview({
          profile: BASE_PROFILE,
          stackSummary: SAMPLE_STACK,
          autonomous: true,
        }),
      ).rejects.toThrow("Missing required credentials");
    });

    it("calls onProgress with stack info", async () => {
      mockExists.mockReturnValue(true);
      const progress: string[] = [];

      const { runStackReview } = await import("./stack-review.js");
      await runStackReview({
        profile: BASE_PROFILE,
        stackSummary: SAMPLE_STACK,
        autonomous: true,
        onProgress: (msg) => progress.push(msg),
      });

      expect(progress.some((m) => m.includes("autonomous"))).toBe(true);
      expect(progress.some((m) => m.includes("credentials found"))).toBe(true);
    });

    it("works with null stackSummary (falls back to profile)", async () => {
      mockExists.mockReturnValue(true);
      const progress: string[] = [];

      const { runStackReview } = await import("./stack-review.js");
      const result = await runStackReview({
        profile: BASE_PROFILE,
        stackSummary: null,
        autonomous: true,
        onProgress: (msg) => progress.push(msg),
      });

      expect(result.approved).toBe(true);
      // Should still show stack info from profile
      expect(progress.some((m) => m.includes("next"))).toBe(true);
    });

    it("only requires anthropic for minimal stack", async () => {
      const minProfile = {
        ...BASE_PROFILE,
        database: "none" as const,
        cloudProvider: "none" as const,
        sourceControl: "none" as const,
      };
      // Only anthropic exists
      mockExists.mockImplementation((key: string) => key === "anthropic");

      const { runStackReview } = await import("./stack-review.js");
      const result = await runStackReview({
        profile: minProfile,
        stackSummary: null,
        autonomous: true,
      });

      expect(result.approved).toBe(true);
      expect(result.credentialsReady).toEqual(["anthropic"]);
    });
  });

  describe("interactive mode", () => {
    it("approves when user selects approve", async () => {
      mockClack.select.mockResolvedValue("approve");
      mockExists.mockReturnValue(true);

      const { runStackReview } = await import("./stack-review.js");
      const result = await runStackReview({
        profile: BASE_PROFILE,
        stackSummary: SAMPLE_STACK,
        autonomous: false,
      });

      expect(result.approved).toBe(true);
      expect(result.profile).toEqual(BASE_PROFILE);
    });

    it("returns approved: false when user cancels", async () => {
      mockClack.select.mockResolvedValue("cancel");

      const { runStackReview } = await import("./stack-review.js");
      const result = await runStackReview({
        profile: BASE_PROFILE,
        stackSummary: SAMPLE_STACK,
        autonomous: false,
      });

      expect(result.approved).toBe(false);
    });

    it("returns approved: false when user hits ctrl-c", async () => {
      mockClack.select.mockResolvedValue(Symbol("cancel"));
      mockClack.isCancel.mockReturnValue(true);

      const { runStackReview } = await import("./stack-review.js");
      const result = await runStackReview({
        profile: BASE_PROFILE,
        stackSummary: SAMPLE_STACK,
        autonomous: false,
      });

      expect(result.approved).toBe(false);
      mockClack.isCancel.mockReturnValue(false);
    });

    it("adjusts profile when user selects adjust", async () => {
      mockClack.select
        .mockResolvedValueOnce("adjust") // main action
        .mockResolvedValueOnce("sqlite") // database choice
        .mockResolvedValueOnce("railway"); // cloud choice
      mockExists.mockReturnValue(true);

      const { runStackReview } = await import("./stack-review.js");
      const result = await runStackReview({
        profile: BASE_PROFILE,
        stackSummary: SAMPLE_STACK,
        autonomous: false,
      });

      expect(result.approved).toBe(true);
      expect(result.profile.database).toBe("sqlite");
      expect(result.profile.cloudProvider).toBe("railway");
      // Original profile unchanged
      expect(BASE_PROFILE.database).toBe("postgresql");
    });

    it("collects missing credentials via password prompt", async () => {
      mockClack.select.mockResolvedValue("approve");
      // anthropic exists, neon and vercel do not (first pass)
      // After saving, they exist (second pass for finalMissing check)
      let saved = new Set<string>();
      mockExists.mockImplementation((key: string) => key === "anthropic" || saved.has(key));
      mockSave.mockImplementation((key: string) => { saved.add(key); });
      mockClack.password
        .mockResolvedValueOnce("vercel-token-123")
        .mockResolvedValueOnce("neon-key-456");

      const { runStackReview } = await import("./stack-review.js");
      const result = await runStackReview({
        profile: BASE_PROFILE,
        stackSummary: SAMPLE_STACK,
        autonomous: false,
      });

      expect(result.approved).toBe(true);
      expect(mockSave).toHaveBeenCalled();
      expect(mockClack.password).toHaveBeenCalled();
    });
  });
});
