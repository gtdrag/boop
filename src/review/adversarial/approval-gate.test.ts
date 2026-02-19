import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  formatFindingsForApproval,
  createInteractiveApprovalGate,
  createMessagingApprovalGate,
  parseApprovalReply,
} from "./approval-gate.js";
import type { AdversarialFinding } from "./runner.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  multiselect: vi.fn(),
  isCancel: vi.fn((v) => v === Symbol.for("cancel")),
}));

const clack = vi.mocked(await import("@clack/prompts"));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(
  id: string,
  severity: "critical" | "high" | "medium" | "low" = "high",
  file = "src/foo.ts",
): AdversarialFinding {
  return {
    id,
    title: `Finding ${id}`,
    severity,
    source: "code-quality",
    description: `Description for ${id}`,
    file,
  };
}

function makeContext(fixable: AdversarialFinding[], deferred: AdversarialFinding[] = []) {
  return {
    iteration: 1,
    maxIterations: 3,
    fixable,
    deferred,
  };
}

// ---------------------------------------------------------------------------
// formatFindingsForApproval
// ---------------------------------------------------------------------------

describe("formatFindingsForApproval", () => {
  it("formats fixable findings with numbered list", () => {
    const fixable = [makeFinding("cq-1", "high"), makeFinding("sec-1", "critical")];

    const result = formatFindingsForApproval(fixable, []);

    expect(result).toContain("## Findings to Fix (2)");
    expect(result).toContain("1. [cq-1] **Finding cq-1** (high) — src/foo.ts");
    expect(result).toContain("2. [sec-1] **Finding sec-1** (critical) — src/foo.ts");
  });

  it("formats deferred findings as bulleted list", () => {
    const fixable = [makeFinding("cq-1")];
    const deferred = [makeFinding("cq-2", "low"), makeFinding("cq-3", "medium")];

    const result = formatFindingsForApproval(fixable, deferred);

    expect(result).toContain("## Deferred (2)");
    expect(result).toContain("- [cq-2] Finding cq-2 (low) — src/foo.ts");
    expect(result).toContain("- [cq-3] Finding cq-3 (medium) — src/foo.ts");
  });

  it("handles empty fixable array", () => {
    const result = formatFindingsForApproval([], []);

    expect(result).toContain("## Findings to Fix (0)");
    expect(result).not.toContain("## Deferred");
  });

  it("omits deferred section when no deferred findings", () => {
    const fixable = [makeFinding("cq-1")];

    const result = formatFindingsForApproval(fixable, []);

    expect(result).not.toContain("## Deferred");
  });
});

// ---------------------------------------------------------------------------
// parseApprovalReply
// ---------------------------------------------------------------------------

describe("parseApprovalReply", () => {
  it.each(["approve", "approved", "yes", "lgtm", "ok"])('parses "%s" as approve', (input) => {
    expect(parseApprovalReply(input)).toEqual({ action: "approve" });
  });

  it("parses 'skip' as skip", () => {
    expect(parseApprovalReply("skip")).toEqual({ action: "skip" });
  });

  it.each(["abort", "stop", "cancel"])('parses "%s" as abort', (input) => {
    expect(parseApprovalReply(input)).toEqual({ action: "abort" });
  });

  it("parses 'filter: id1, id2' as filter with IDs", () => {
    const result = parseApprovalReply("filter: cq-1, sec-1");
    expect(result).toEqual({ action: "filter", approvedIds: ["cq-1", "sec-1"] });
  });

  it("parses 'filter id1 id2' (without colon) as filter", () => {
    const result = parseApprovalReply("filter cq-1 sec-1");
    expect(result).toEqual({ action: "filter", approvedIds: ["cq-1", "sec-1"] });
  });

  it("defaults unrecognized input to approve", () => {
    expect(parseApprovalReply("sure thing")).toEqual({ action: "approve" });
  });
});

// ---------------------------------------------------------------------------
// createInteractiveApprovalGate
// ---------------------------------------------------------------------------

describe("createInteractiveApprovalGate", () => {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  it("returns approve when user selects 'Approve all'", async () => {
    clack.select.mockResolvedValue("approve");

    const gate = createInteractiveApprovalGate();
    const result = await gate(makeContext([makeFinding("cq-1")]));

    expect(result).toEqual({ action: "approve" });
    consoleSpy.mockClear();
  });

  it("returns skip when user selects 'Skip iteration'", async () => {
    clack.select.mockResolvedValue("skip");

    const gate = createInteractiveApprovalGate();
    const result = await gate(makeContext([makeFinding("cq-1")]));

    expect(result).toEqual({ action: "skip" });
    consoleSpy.mockClear();
  });

  it("returns abort when user selects 'Abort loop'", async () => {
    clack.select.mockResolvedValue("abort");

    const gate = createInteractiveApprovalGate();
    const result = await gate(makeContext([makeFinding("cq-1")]));

    expect(result).toEqual({ action: "abort" });
    consoleSpy.mockClear();
  });

  it("returns filter with selected IDs when user picks findings", async () => {
    clack.select.mockResolvedValue("filter");
    clack.multiselect.mockResolvedValue(["cq-1"]);

    const gate = createInteractiveApprovalGate();
    const result = await gate(
      makeContext([makeFinding("cq-1"), makeFinding("sec-1")]),
    );

    expect(result).toEqual({ action: "filter", approvedIds: ["cq-1"] });
    consoleSpy.mockClear();
  });

  it("returns abort when user cancels select prompt", async () => {
    clack.select.mockResolvedValue(Symbol.for("cancel"));

    const gate = createInteractiveApprovalGate();
    const result = await gate(makeContext([makeFinding("cq-1")]));

    expect(result).toEqual({ action: "abort" });
    consoleSpy.mockClear();
  });

  it("returns abort when user cancels multiselect prompt", async () => {
    clack.select.mockResolvedValue("filter");
    clack.multiselect.mockResolvedValue(Symbol.for("cancel"));

    const gate = createInteractiveApprovalGate();
    const result = await gate(makeContext([makeFinding("cq-1")]));

    expect(result).toEqual({ action: "abort" });
    consoleSpy.mockClear();
  });

  it("returns skip when user selects zero findings in multiselect", async () => {
    clack.select.mockResolvedValue("filter");
    clack.multiselect.mockResolvedValue([]);

    const gate = createInteractiveApprovalGate();
    const result = await gate(makeContext([makeFinding("cq-1")]));

    expect(result).toEqual({ action: "skip" });
    consoleSpy.mockClear();
  });
});

// ---------------------------------------------------------------------------
// createMessagingApprovalGate
// ---------------------------------------------------------------------------

describe("createMessagingApprovalGate", () => {
  function makeDispatcher(replyText?: string) {
    return {
      send: vi.fn().mockResolvedValue(undefined),
      ask: vi.fn().mockResolvedValue(
        replyText != null
          ? { replied: true, message: { text: replyText, channel: "whatsapp", receivedAt: new Date().toISOString() } }
          : { replied: false, reason: "timeout" },
      ),
      // Satisfy type — unused in tests
      enabled: true,
      notify: vi.fn(),
      sendSummary: vi.fn(),
      createSignOffPrompt: vi.fn(),
      initAdapter: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      setAdapter: vi.fn(),
    } as unknown as import("../../channels/messaging.js").MessagingDispatcher;
  }

  it("sends findings summary and returns approve on 'approve' reply", async () => {
    const dispatcher = makeDispatcher("approve");
    const gate = createMessagingApprovalGate(dispatcher);
    const result = await gate(makeContext([makeFinding("cq-1")]));

    expect(dispatcher.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "summary" }),
    );
    expect(dispatcher.ask).toHaveBeenCalled();
    expect(result).toEqual({ action: "approve" });
  });

  it("returns skip on 'skip' reply", async () => {
    const dispatcher = makeDispatcher("skip");
    const gate = createMessagingApprovalGate(dispatcher);
    const result = await gate(makeContext([makeFinding("cq-1")]));

    expect(result).toEqual({ action: "skip" });
  });

  it("returns abort on 'abort' reply", async () => {
    const dispatcher = makeDispatcher("abort");
    const gate = createMessagingApprovalGate(dispatcher);
    const result = await gate(makeContext([makeFinding("cq-1")]));

    expect(result).toEqual({ action: "abort" });
  });

  it("returns filter with parsed IDs on 'filter: cq-1, sec-1' reply", async () => {
    const dispatcher = makeDispatcher("filter: cq-1, sec-1");
    const gate = createMessagingApprovalGate(dispatcher);
    const result = await gate(makeContext([makeFinding("cq-1"), makeFinding("sec-1")]));

    expect(result).toEqual({ action: "filter", approvedIds: ["cq-1", "sec-1"] });
  });

  it("auto-approves on timeout (no reply)", async () => {
    const dispatcher = makeDispatcher(undefined);
    const gate = createMessagingApprovalGate(dispatcher);
    const result = await gate(makeContext([makeFinding("cq-1")]));

    expect(result).toEqual({ action: "approve" });
  });
});
