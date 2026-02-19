/**
 * Human-in-the-loop approval gate for the adversarial review loop.
 *
 * Sits between severity partitioning and the fixer — the human sees what
 * the agents found and decides which findings to fix, skip, or abort.
 *
 * Three implementations:
 *   1. None (undefined) — autonomous mode, no gate
 *   2. CLI interactive — @clack/prompts multiselect
 *   3. Messaging — WhatsApp/Telegram via MessagingDispatcher.ask()
 */
import type { AdversarialFinding } from "./runner.js";
import type { MessagingDispatcher } from "../../channels/messaging.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalAction =
  | { action: "approve" }
  | { action: "filter"; approvedIds: string[] }
  | { action: "skip" }
  | { action: "abort" };

export type ApprovalGateFn = (context: {
  iteration: number;
  maxIterations: number;
  fixable: AdversarialFinding[];
  deferred: AdversarialFinding[];
}) => Promise<ApprovalAction>;

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Format findings into a readable summary for human review.
 *
 * Returns a markdown string listing fixable findings (numbered, with IDs)
 * and deferred findings (bulleted).
 */
export function formatFindingsForApproval(
  fixable: AdversarialFinding[],
  deferred: AdversarialFinding[],
): string {
  const lines: string[] = [];

  lines.push(`## Findings to Fix (${fixable.length})`);

  for (let i = 0; i < fixable.length; i++) {
    const f = fixable[i]!;
    const location = f.file ? ` — ${f.file}` : "";
    const range =
      f.lineRange ? `:${f.lineRange.start}-${f.lineRange.end}` : "";
    lines.push(
      `${i + 1}. [${f.id}] **${f.title}** (${f.severity})${location}${range}`,
    );
  }

  if (deferred.length > 0) {
    lines.push("");
    lines.push(`## Deferred (${deferred.length})`);
    for (const f of deferred) {
      const location = f.file ? ` — ${f.file}` : "";
      lines.push(`- [${f.id}] ${f.title} (${f.severity})${location}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI interactive gate
// ---------------------------------------------------------------------------

/**
 * Creates an approval gate that prompts the user interactively via
 * `@clack/prompts` in the terminal.
 *
 * Flow:
 *   1. Print formatted findings
 *   2. clack.select: "Approve all" / "Select findings" / "Skip" / "Abort"
 *   3. If "Select findings": clack.multiselect with finding options
 *   4. Return appropriate ApprovalAction
 */
export function createInteractiveApprovalGate(): ApprovalGateFn {
  return async (context) => {
    const { select, multiselect, isCancel } = await import("@clack/prompts");

    const summary = formatFindingsForApproval(context.fixable, context.deferred);
    console.log();
    console.log(summary);
    console.log();

    const choice = await select({
      message: `Iteration ${context.iteration}/${context.maxIterations}: ${context.fixable.length} findings to fix. What would you like to do?`,
      options: [
        { value: "approve", label: "Approve all", hint: "Fix all findings" },
        { value: "filter", label: "Select findings", hint: "Choose which to fix" },
        { value: "skip", label: "Skip iteration", hint: "Skip fixes, continue reviewing" },
        { value: "abort", label: "Abort loop", hint: "Stop the review loop" },
      ],
    });

    if (isCancel(choice)) {
      return { action: "abort" };
    }

    if (choice === "approve") {
      return { action: "approve" };
    }

    if (choice === "skip") {
      return { action: "skip" };
    }

    if (choice === "abort") {
      return { action: "abort" };
    }

    // "filter" — let user pick which findings to fix
    const selected = await multiselect({
      message: "Select findings to fix:",
      options: context.fixable.map((f) => ({
        value: f.id,
        label: `[${f.id}] ${f.title}`,
        hint: `${f.severity}${f.file ? ` — ${f.file}` : ""}`,
      })),
      required: false,
    });

    if (isCancel(selected)) {
      return { action: "abort" };
    }

    const approvedIds = selected as string[];
    if (approvedIds.length === 0) {
      return { action: "skip" };
    }

    return { action: "filter", approvedIds };
  };
}

// ---------------------------------------------------------------------------
// Messaging gate (WhatsApp/Telegram)
// ---------------------------------------------------------------------------

/**
 * Parse a text reply from a messaging channel into an ApprovalAction.
 *
 * Accepted formats:
 *   - "approve" / "approved" / "yes" / "lgtm" → approve
 *   - "skip" → skip
 *   - "abort" / "stop" / "cancel" → abort
 *   - "filter: cq-1, sec-1" / "filter cq-1 sec-1" → filter
 */
export function parseApprovalReply(text: string): ApprovalAction {
  const normalized = text.trim().toLowerCase();

  if (["approve", "approved", "yes", "lgtm", "ok"].includes(normalized)) {
    return { action: "approve" };
  }

  if (normalized === "skip") {
    return { action: "skip" };
  }

  if (["abort", "stop", "cancel"].includes(normalized)) {
    return { action: "abort" };
  }

  // Filter: "filter: cq-1, sec-1" or "filter cq-1 sec-1"
  const filterMatch = normalized.match(/^filter[:\s]+(.+)/);
  if (filterMatch) {
    const ids = filterMatch[1]!
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (ids.length > 0) {
      return { action: "filter", approvedIds: ids };
    }
  }

  // Default: treat unrecognized input as approve (safe default — matches
  // sign-off timeout behavior where timeout = auto-approve)
  return { action: "approve" };
}

/**
 * Creates an approval gate that prompts the user via a messaging channel
 * (WhatsApp or Telegram) using the MessagingDispatcher.
 *
 * Flow:
 *   1. Send formatted findings via dispatcher.send()
 *   2. Send instruction text
 *   3. dispatcher.ask("") — wait for reply
 *   4. Parse reply text into ApprovalAction
 *   5. Timeout → auto-approve (matches sign-off timeout behavior)
 */
export function createMessagingApprovalGate(
  dispatcher: MessagingDispatcher,
): ApprovalGateFn {
  return async (context) => {
    const summary = formatFindingsForApproval(context.fixable, context.deferred);

    await dispatcher.send({
      text: summary,
      type: "summary",
    });

    const result = await dispatcher.ask(
      `Iteration ${context.iteration}/${context.maxIterations}: ${context.fixable.length} findings to fix.\n` +
        "Reply: approve | skip | abort | filter: id1, id2",
    );

    if (!result.replied) {
      // Timeout or no channel — auto-approve (matches sign-off behavior)
      return { action: "approve" };
    }

    return parseApprovalReply(result.message.text);
  };
}
