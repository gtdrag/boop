import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DeveloperProfile } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSendMessage, mockIsRetryable, mockResolveModel, mockBuildCacheable } = vi.hoisted(
  () => ({
    mockSendMessage: vi.fn(),
    mockIsRetryable: vi.fn().mockReturnValue(false),
    mockResolveModel: vi.fn().mockReturnValue("claude-sonnet-4-5-20250929"),
    mockBuildCacheable: vi.fn().mockImplementation((base: string, dynamic?: string[]) => {
      const content = dynamic ? `${base}\n${dynamic.join("\n")}` : base;
      return [{ type: "text", text: content }];
    }),
  }),
);

const { mockAugmentPrompt, mockFormatDecisions, mockFormatHeuristics } = vi.hoisted(() => ({
  mockAugmentPrompt: vi.fn().mockReturnValue("augmented prompt"),
  mockFormatDecisions: vi.fn().mockReturnValue("decisions block"),
  mockFormatHeuristics: vi.fn().mockReturnValue("heuristics block"),
}));

vi.mock("../shared/index.js", () => ({
  sendMessage: mockSendMessage,
  isRetryableApiError: mockIsRetryable,
  retry: (fn: () => Promise<unknown>, _opts: unknown) => fn(),
  resolveModel: mockResolveModel,
  buildCacheableSystemPrompt: mockBuildCacheable,
}));

vi.mock("../evolution/outcome-injector.js", () => ({
  augmentPrompt: mockAugmentPrompt,
}));

vi.mock("../evolution/arch-decisions.js", () => ({
  formatDecisionsForPrompt: mockFormatDecisions,
}));

vi.mock("../evolution/consolidator.js", () => ({
  formatHeuristicsForPrompt: mockFormatHeuristics,
}));

const TEST_PROFILE: DeveloperProfile = {
  name: "Test Dev",
  languages: ["typescript"],
  frontendFramework: "next",
  backendFramework: "express",
  database: "postgresql",
  cloudProvider: "vercel",
  styling: "tailwind",
  stateManagement: "zustand",
  analytics: "posthog",
  ciCd: "github-actions",
  sourceControl: "github",
  packageManager: "pnpm",
  testRunner: "vitest",
  linter: "oxlint",
  projectStructure: "monorepo",
  aiModel: "claude-opus-4-6",
  autonomousByDefault: false,
};

describe("callPlanningClaude", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue({
      text: "response text",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  });

  it("calls sendMessage with correct model and maxTokens", async () => {
    const { callPlanningClaude } = await import("./claude-helper.js");

    await callPlanningClaude({
      phase: "viability",
      basePrompt: "system prompt",
      userMessage: "user input",
      profile: TEST_PROFILE,
    });

    expect(mockResolveModel).toHaveBeenCalledWith("planning", TEST_PROFILE);
    expect(mockSendMessage).toHaveBeenCalledOnce();
    const [opts, _system, messages] = mockSendMessage.mock.calls[0]!;
    expect(opts.model).toBe("claude-sonnet-4-5-20250929");
    expect(opts.maxTokens).toBe(4096);
    expect(messages).toEqual([{ role: "user", content: "user input" }]);
  });

  it("uses custom maxTokens when provided", async () => {
    const { callPlanningClaude } = await import("./claude-helper.js");

    await callPlanningClaude({
      phase: "prd",
      basePrompt: "prompt",
      userMessage: "msg",
      profile: TEST_PROFILE,
      maxTokens: 8192,
    });

    const [opts] = mockSendMessage.mock.calls[0]!;
    expect(opts.maxTokens).toBe(8192);
  });

  it("injects review rules via augmentPrompt", async () => {
    const { callPlanningClaude } = await import("./claude-helper.js");
    const rules = [{ description: "rule1" }] as never[];

    await callPlanningClaude({
      phase: "architecture",
      basePrompt: "base",
      userMessage: "msg",
      profile: TEST_PROFILE,
      reviewRules: rules,
    });

    expect(mockAugmentPrompt).toHaveBeenCalledWith("", rules, "architecture", TEST_PROFILE);
    expect(mockBuildCacheable).toHaveBeenCalledWith("base", expect.arrayContaining(["augmented prompt"]));
  });

  it("injects arch decisions via formatDecisionsForPrompt", async () => {
    const { callPlanningClaude } = await import("./claude-helper.js");
    const decisions = [{ title: "decision1" }] as never[];

    await callPlanningClaude({
      phase: "architecture",
      basePrompt: "base",
      userMessage: "msg",
      profile: TEST_PROFILE,
      archDecisions: decisions,
    });

    expect(mockFormatDecisions).toHaveBeenCalledWith(decisions);
    expect(mockBuildCacheable).toHaveBeenCalledWith("base", expect.arrayContaining(["decisions block"]));
  });

  it("injects heuristics via formatHeuristicsForPrompt", async () => {
    const { callPlanningClaude } = await import("./claude-helper.js");
    const heuristics = [{ text: "heuristic1" }] as never[];

    await callPlanningClaude({
      phase: "stories",
      basePrompt: "base",
      userMessage: "msg",
      profile: TEST_PROFILE,
      heuristics,
    });

    expect(mockFormatHeuristics).toHaveBeenCalledWith(heuristics);
    expect(mockBuildCacheable).toHaveBeenCalledWith("base", expect.arrayContaining(["heuristics block"]));
  });

  it("passes no dynamic sections when no rules/decisions/heuristics", async () => {
    const { callPlanningClaude } = await import("./claude-helper.js");

    await callPlanningClaude({
      phase: "viability",
      basePrompt: "base",
      userMessage: "msg",
      profile: TEST_PROFILE,
    });

    expect(mockBuildCacheable).toHaveBeenCalledWith("base", undefined);
  });

  it("skips empty arrays (no dynamic sections)", async () => {
    const { callPlanningClaude } = await import("./claude-helper.js");

    await callPlanningClaude({
      phase: "viability",
      basePrompt: "base",
      userMessage: "msg",
      profile: TEST_PROFILE,
      reviewRules: [],
      archDecisions: [],
      heuristics: [],
    });

    expect(mockAugmentPrompt).not.toHaveBeenCalled();
    expect(mockFormatDecisions).not.toHaveBeenCalled();
    expect(mockFormatHeuristics).not.toHaveBeenCalled();
    expect(mockBuildCacheable).toHaveBeenCalledWith("base", undefined);
  });

  it("returns the Claude response", async () => {
    const { callPlanningClaude } = await import("./claude-helper.js");

    const result = await callPlanningClaude({
      phase: "viability",
      basePrompt: "prompt",
      userMessage: "msg",
      profile: TEST_PROFILE,
    });

    expect(result.text).toBe("response text");
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 20 });
  });

  it("merges clientOptions overrides", async () => {
    const { callPlanningClaude } = await import("./claude-helper.js");

    await callPlanningClaude({
      phase: "viability",
      basePrompt: "prompt",
      userMessage: "msg",
      profile: TEST_PROFILE,
      clientOptions: { temperature: 0.5 },
    });

    const [opts] = mockSendMessage.mock.calls[0]!;
    expect(opts.temperature).toBe(0.5);
  });
});
