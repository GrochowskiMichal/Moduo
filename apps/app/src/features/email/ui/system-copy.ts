// The words of Mail's system lines, hint line and toasts (specs/mail-v3.md §4,
// §5). Pure, so the copy is tested once and every surface says it the same way.

import type { MailOpKind } from "@contracts/mail";

import type { MailAccount, MailOpRecord, MailThreadRow } from "@/lib/runtime.types.mail-engine";

const DAY_MS = 86_400_000;

export const accountLabel = (a: Pick<MailAccount, "displayName" | "address">) =>
  a.displayName || a.address;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The offline line's sentence: what waits, or that reading still works. */
export function offlineBody(outboxCount: number, pendingOps: number): string {
  const parts: string[] = [];
  if (outboxCount > 0)
    parts.push(
      outboxCount === 1 ? "1 message waits in Outbox." : `${outboxCount} messages wait in Outbox.`,
    );
  if (pendingOps > 0)
    parts.push(
      pendingOps === 1
        ? "1 triage action is saved on this Mac."
        : `${pendingOps} triage actions are saved on this Mac.`,
    );
  return parts.length > 0 ? parts.join(" ") : "Reading works from what's on this Mac.";
}

/** A server or engine error as a sentence start: "invalid_grant" → "Invalid grant". */
export function humaniseError(raw: string | null | undefined): string | null {
  const s = (raw ?? "")
    .trim()
    .replace(/_+/g, " ")
    .replace(/[.\s]+$/, "");
  return s ? s[0]!.toUpperCase() + s.slice(1) : null;
}

/** "{reason}; retrying every minute." for an account that couldn't sync. */
export function accountErrorBody(lastError: string | null | undefined): string {
  const h = humaniseError(lastError);
  return h ? `${h}; retrying every minute.` : "Retrying every minute.";
}

const OP_LABEL: Record<MailOpKind, string> = {
  done: "Done",
  undone: "Not done",
  move: "Move",
  delete: "Delete",
  restore: "Restore",
  mark_read: "Mark read",
  mark_unread: "Mark unread",
  pin: "Pin",
  unpin: "Unpin",
  snooze: "Snooze",
  unsnooze: "Unsnooze",
  mute: "Mute",
  unmute: "Unmute",
  spam: "Report spam",
  not_spam: "Not spam",
  label_add: "Label",
  label_remove: "Remove label",
  block_sender: "Block",
};

export const opLabel = (kind: MailOpKind) => OP_LABEL[kind] ?? kind;

/** "Done · Workshop materials", "Move to Receipts · Studio rent, November". */
const opItem = (op: MailOpRecord) => {
  const target = op.kind === "move" ? op.targetName?.trim() : "";
  const label = target ? `${opLabel(op.kind)} to ${target}` : opLabel(op.kind);
  return `${label} · ${op.subject?.trim() || "(No subject)"}`;
};

/**
 * The failed line's sentence naming each action and thread: "A.", "A, and B.",
 * and with three or more the first two plus "and N more".
 */
export function failedSentence(ops: readonly MailOpRecord[]): string {
  const items = ops.map(opItem);
  if (items.length <= 1) return `${items[0] ?? ""}.`;
  if (items.length === 2) return `${items[0]}, and ${items[1]}.`;
  return `${items[0]}, ${items[1]}, and ${items.length - 2} more.`;
}

/** "{server reason}; Moduo keeps retrying for a day." from the newest failure. */
export function failedReason(ops: readonly MailOpRecord[]): string {
  const newest = [...ops].sort((a, b) => b.createdAtMs - a.createdAtMs).find((o) => o.lastError);
  const h = humaniseError(newest?.lastError);
  return h ? `${h}; Moduo keeps retrying for a day.` : "Moduo keeps retrying for a day.";
}

export function failedTitle(n: number, account: string): string {
  return `${plural(n, "action", "actions")} didn't reach ${account}`;
}

/** Undo for one, Undo both for two, Undo all for three or more. */
export function failedUndoLabel(n: number): string {
  if (n <= 1) return "Undo";
  return n === 2 ? "Undo both" : "Undo all";
}

export type FailedGroup = { accountId: string | null; label: string; ops: MailOpRecord[] };

/** One failed line per account, in account order (an unknown account last). */
export function groupFailedOps(
  ops: readonly MailOpRecord[],
  accounts: readonly MailAccount[],
  accountOf: (op: MailOpRecord) => string | null,
): FailedGroup[] {
  const single = accounts.length === 1 ? accounts[0]!.id : null;
  const by = new Map<string | null, MailOpRecord[]>();
  for (const op of ops) {
    const id = accountOf(op) ?? single;
    by.set(id, [...(by.get(id) ?? []), op]);
  }
  const out: FailedGroup[] = [];
  for (const a of accounts) {
    const list = by.get(a.id);
    if (list) out.push({ accountId: a.id, label: accountLabel(a), ops: list });
  }
  for (const [id, list] of by) {
    if (id === null || !accounts.some((a) => a.id === id))
      out.push({ accountId: id, label: "the server", ops: list });
  }
  return out;
}

/** The counterpart of a sent thread: the newest sender that isn't you. */
function counterpart(row: MailThreadRow, selfAddresses: readonly string[]) {
  const self = new Set(selfAddresses.map((a) => a.trim().toLowerCase()));
  return [...row.senders].reverse().find((s) => !self.has(s.email.trim().toLowerCase()));
}

/** The first name the nudge and its Dismiss tooltip use. */
export function nudgeFirstName(row: MailThreadRow, selfAddresses: readonly string[]): string {
  const other = counterpart(row, selfAddresses);
  if (!other) return "them";
  const name = other.name.trim();
  return name ? name.split(/\s+/)[0]! : other.email;
}

/** "No reply from Ana · 7 days". */
export function nudgeTitle(row: MailThreadRow, selfAddresses: readonly string[], nowMs: number) {
  const days = Math.max(0, Math.floor((nowMs - row.lastDateMs) / DAY_MS));
  const when = days === 0 ? "today" : plural(days, "day", "days");
  return `No reply from ${nudgeFirstName(row, selfAddresses)} · ${when}`;
}
