// The persistent hint line at the foot of the list (specs/mail-v3.md §5;
// specs/mail-improve.md §3, AC10): key hints only, the next useful keys for the
// place. What an action did is the undo toast's ("Done · in Archive"), and the key
// a pointer action could have used rides in that toast's description. It follows
// the Settings "Show key hints" toggle; a waiting `g` chord reads "g…".

import type { MailOpKind } from "@contracts/mail";

import type { MailOpInput, MailView } from "@/lib/runtime.types.mail-engine";

import { opLabel } from "./system-copy";

/** The next useful key for a place, or null when the list is empty. */
export function restHint(view: MailView, hasRows: boolean): string | null {
  if (!hasRows) return null;
  if (view.kind === "outbox") return "↵ Edit · sends on its own when online";
  if (view.kind === "new_senders") return "j k to move · Allow or Block · ? all keys";
  if (view.kind === "unified") {
    if (view.role === "archive") return "j k to move · ⇧e Not done · ? all keys";
    if (view.role === "drafts") return "j k to move · ↵ Edit · # Delete · ? all keys";
    if (view.role === "sent") return "j k to move · w Remind me if no reply · ? all keys";
  }
  return "j k to move · e Done · s Snooze · t Task · ? all keys";
}

/** Where an action left the threads: the toast's "{Action} · {where}" (AC10). */
const RESULT: Partial<Record<MailOpKind, [one: string, many: string, where: string | null]>> = {
  done: ["Done", "done", "in Archive"],
  undone: ["Not done", "not done", "back in Inbox"],
  delete: ["Deleted", "deleted", "in Trash"],
  restore: ["Restored", "restored", null],
  move: ["Moved", "moved", null],
  spam: ["Reported spam", "reported spam", "in Spam"],
  not_spam: ["Not spam", "not spam", "back in Inbox"],
  pin: ["Pinned", "pinned", null],
  unpin: ["Unpinned", "unpinned", null],
  mark_read: ["Marked read", "marked read", null],
  mark_unread: ["Marked unread", "marked unread", null],
  mute: ["Muted", "muted", "new replies skip the inbox"],
  unmute: ["Unmuted", "unmuted", null],
  block_sender: ["Blocked", "blocked", null],
  snooze: ["Snoozed", "snoozed", null],
};

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });

/** "Mon 9:00", local time. */
export function formatReturn(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAY.format(d)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The undo toast's words for a triage action: "Done · in Archive", "3 done · in
 *  Archive", "Snoozed · until Mon 9:00", "Moved · to Receipts". */
export function triageToastLabel(
  kind: MailOpKind,
  count: number,
  args?: MailOpInput["args"],
  target?: string | null,
): string {
  const [one, many, where] = RESULT[kind] ?? [opLabel(kind), opLabel(kind).toLowerCase(), null];
  const what = count > 1 ? `${count} ${many}` : one;
  const until = (args as { untilMs?: number } | undefined)?.untilMs;
  const place =
    kind === "snooze" && typeof until === "number"
      ? `until ${formatReturn(until)}`
      : kind === "move" && target
        ? `to ${target}`
        : where;
  return place ? `${what} · ${place}` : what;
}

export function MailHintLine({
  enabled,
  rest,
  chord = null,
}: {
  /** Settings → Mail "Show key hints". */
  enabled: boolean;
  rest: string | null;
  /** A `g` chord waiting for its second key: the line reads "g…" (spec §7). */
  chord?: string | null;
}) {
  if (!enabled) return null;
  const body = chord ? `${chord}…` : rest;
  return (
    <div
      data-slot="mail-hint-line"
      className="flex min-h-(--row-h-sm) shrink-0 items-center gap-1 border-t border-hairline px-3 text-xs text-muted-foreground"
    >
      {body}
    </div>
  );
}
