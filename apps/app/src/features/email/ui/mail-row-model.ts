// What one list row says (specs/mail-v3.md §3, AC15): the place it is shown
// in, the "To {name}" line, the stripped subject, the time by place and the
// flags (at most three, then "+N"). Pure, so the row stays a dumb renderer and
// every case is tested without a DOM.

import type { MailMailbox, MailThreadRow, MailView } from "@/lib/runtime.types.mail-engine";

import type { MailLinkedKind } from "../commands/spine";

/** Where a row is shown; it decides the to-line, the time and the hover actions. */
export type MailRowPlace =
  | "inbox"
  | "sent"
  | "drafts"
  | "archive"
  | "trash"
  | "spam"
  | "snoozed"
  | "followups"
  | "outbox"
  | "new_senders"
  | "folder";

const ROLE_PLACES = new Set<string>(["inbox", "sent", "drafts", "archive", "trash", "spam"]);

/** The place a view reads; a folder takes its mailbox's role when it has a known one. */
export function rowPlace(
  view: MailView,
  mailboxes: Readonly<Record<string, readonly MailMailbox[]>> = {},
): MailRowPlace {
  if (view.kind === "unified")
    return ROLE_PLACES.has(view.role) ? (view.role as MailRowPlace) : "folder";
  if (view.kind !== "mailbox") return view.kind;
  const role = Object.values(mailboxes)
    .flat()
    .find((b) => b.id === view.mailboxId)?.role;
  return role && ROLE_PLACES.has(role) ? (role as MailRowPlace) : "folder";
}

/** Places whose rows read "To {name}" (you wrote them). */
const TO_PLACES = new Set<MailRowPlace>(["sent", "followups", "outbox", "drafts"]);

const SUBJECT_PREFIX = /^(?:\s*(?:re|fwd?|aw|wg|antw)\s*:\s*)+/i;

/** The subject without leading Re:/Fwd:/Fw:/AW:/WG:/Antw: (repeated, any case). */
export function stripSubject(subject: string): string {
  return subject.replace(SUBJECT_PREFIX, "").trim();
}

const displayName = (s: { name: string; email: string }) =>
  s.name.trim() || s.email.split("@")[0] || s.email;

/** "Ana, Tom" or "Ana … Tom" for longer threads. */
export function senderLine(row: MailThreadRow): string {
  const names = row.senders.map(displayName);
  if (names.length <= 2) return names.join(", ");
  return `${names[0]} … ${names[names.length - 1]}`;
}

/** The newest participant who isn't you (the Outbox's senders are its recipients). */
export function counterpart(
  row: MailThreadRow,
  self: ReadonlySet<string>,
): { name: string; email: string } | null {
  return [...row.senders].reverse().find((s) => !self.has(s.email.trim().toLowerCase())) ?? null;
}

/** The row's name line: "To {name}" where you wrote it, else the senders. A thread
 *  only you have written to (no recipient on the row) keeps its sender line. */
export function rowWho(row: MailThreadRow, place: MailRowPlace, self: ReadonlySet<string>): string {
  if (!TO_PLACES.has(place)) return senderLine(row);
  const other = counterpart(row, self);
  return other ? `To ${displayName(other)}` : senderLine(row);
}

/** Compact's narrow sender column (specs/mail-improve.md §2): one first name, "To Ana"
 *  where you wrote; senders outside Personal keep their whole name (a list's name is one). */
export function rowWhoCompact(
  row: MailThreadRow,
  place: MailRowPlace,
  self: ReadonlySet<string>,
): string {
  const person = rowPerson(row, place, self);
  const name = displayName(person);
  const first = row.tab === "personal" ? (name.split(/\s+/)[0] ?? name) : name;
  return TO_PLACES.has(place) && counterpart(row, self) ? `To ${first}` : first;
}

/** The person the avatar stands for: the counterpart where you wrote, else the newest sender. */
export function rowPerson(
  row: MailThreadRow,
  place: MailRowPlace,
  self: ReadonlySet<string>,
): { name: string; email: string } {
  const other = TO_PLACES.has(place) ? counterpart(row, self) : null;
  return other ?? row.senders[row.senders.length - 1] ?? { name: "", email: "" };
}

const DAY_MS = 86_400_000;

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Whole calendar days from `nowMs` to `ms` (negative in the past). */
const dayDelta = (ms: number, nowMs: number) =>
  Math.round((startOfDay(ms) - startOfDay(nowMs)) / DAY_MS);

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const weekday = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: "short" });

function calendarDate(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { year: "numeric", month: "short", day: "numeric" },
  );
}

/** Inbox time: the time today, a weekday within 6 days, then the date. */
export function formatRowTime(ms: number, nowMs: number): string {
  const days = dayDelta(ms, nowMs);
  if (days === 0) return clock(ms);
  if (days < 0 && days >= -6) return weekday(ms);
  return calendarDate(ms, nowMs);
}

/** A future moment: "9:00" today, "Mon 9:00" within a week, else the date. */
function upcoming(ms: number, nowMs: number): string {
  const days = dayDelta(ms, nowMs);
  if (days <= 0) return clock(ms);
  if (days <= 6) return `${weekday(ms)} ${clock(ms)}`;
  return calendarDate(ms, nowMs);
}

/** A future day: "Thu" within a week, else the date. */
const upcomingDay = (ms: number, nowMs: number) =>
  dayDelta(ms, nowMs) <= 6 ? weekday(ms) : calendarDate(ms, nowMs);

/** "No reply · 7 days" once the follow-up came due, else "Reminds Thu". */
export function followUpLabel(row: MailThreadRow, nowMs: number): string | null {
  const at = row.followUpAtMs ?? null;
  if (at === null) return null;
  if (at > nowMs) return `Reminds ${upcomingDay(at, nowMs)}`;
  const days = Math.max(0, Math.floor((nowMs - row.lastDateMs) / DAY_MS));
  return `No reply · ${days} ${days === 1 ? "day" : "days"}`;
}

/** The time column by place (spec §3). */
export function rowTime(row: MailThreadRow, place: MailRowPlace, nowMs: number): string {
  if (place === "outbox") return "Waiting";
  if (place === "snoozed" && row.snoozedUntilMs !== null)
    return `Returns ${upcoming(row.snoozedUntilMs, nowMs)}`;
  if (place === "followups")
    return followUpLabel(row, nowMs) ?? formatRowTime(row.lastDateMs, nowMs);
  return formatRowTime(row.lastDateMs, nowMs);
}

export type MailRowFlagId =
  | "not_sent"
  | "outbox"
  | "new_reply"
  | "back"
  | "waiting"
  | "priority"
  | "pinned"
  | "task"
  | "note"
  | "invite"
  | "attachment"
  | "muted"
  | "snoozed";

/** One flag: a glyph with an accessible label, or a short state word (`text`). */
export type MailRowFlag = {
  id: MailRowFlagId;
  label: string;
  text?: string;
  tone?: "destructive" | "warning";
};

export type MailRowFlagContext = {
  place: MailRowPlace;
  nowMs: number;
  /** The kinds the thread links to on the spine (decision 7). */
  linked?: readonly MailLinkedKind[];
  /** A draft on this thread whose send failed (`lastError`). */
  notSent?: boolean;
  /** The row's account is offline (the Outbox then waits for connection). */
  offline?: boolean;
  /** Under the PINNED heading the pin says nothing new (specs/mail-improve.md §2, C2). */
  inPinnedGroup?: boolean;
};

export const MAX_ROW_FLAGS = 3;

/** State words first (they ask for action), then the glyphs in the spec's order. */
function stateFlags(row: MailThreadRow, ctx: MailRowFlagContext): MailRowFlag[] {
  const out: MailRowFlag[] = [];
  if (ctx.notSent)
    out.push({ id: "not_sent", label: "Not sent", text: "Not sent", tone: "destructive" });
  if (row.outboxState) {
    const text = ctx.offline ? "Waiting for connection" : "Sending…";
    out.push({ id: "outbox", label: text, text });
  }
  if (row.returnReason === "reply")
    out.push({ id: "new_reply", label: "Came back early: a new reply", text: "New reply" });
  if (row.returnReason === "snooze")
    out.push({ id: "back", label: "Came back from snooze", text: "Back" });
  return out;
}

function glyphFlags(row: MailThreadRow, ctx: MailRowFlagContext): MailRowFlag[] {
  const linked = ctx.linked ?? [];
  const wait = followUpLabel(row, ctx.nowMs);
  const candidates: [boolean, MailRowFlag][] = [
    [wait !== null, { id: "waiting", label: wait ?? "", tone: "warning" }],
    [row.priority, { id: "priority", label: "Priority person", tone: "warning" }],
    [row.pinned && !ctx.inPinnedGroup, { id: "pinned", label: "Pinned" }],
    [linked.includes("task"), { id: "task", label: "Has a task" }],
    [linked.includes("note"), { id: "note", label: "Has a note" }],
    [row.hasInvite, { id: "invite", label: "Invite" }],
    [row.hasAttachments, { id: "attachment", label: "Attachment" }],
    [row.muted, { id: "muted", label: "Muted" }],
    [row.snoozedUntilMs !== null && ctx.place !== "snoozed", { id: "snoozed", label: "Snoozed" }],
  ];
  return candidates.filter(([on]) => on).map(([, f]) => f);
}

/** Every flag the row carries, in display order. */
export function rowFlags(row: MailThreadRow, ctx: MailRowFlagContext): MailRowFlag[] {
  return [...stateFlags(row, ctx), ...glyphFlags(row, ctx)];
}

/** The flags shown (at most three) and the ones folded into "+N". */
export function visibleFlags(flags: readonly MailRowFlag[]): {
  shown: MailRowFlag[];
  hidden: MailRowFlag[];
} {
  return { shown: flags.slice(0, MAX_ROW_FLAGS), hidden: flags.slice(MAX_ROW_FLAGS) };
}
