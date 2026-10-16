// Statuses, presence and Focus as people see them (chat v2 CV-17, spec §10;
// CH28d, CH42, CH45, CH47, CH48). Pure: what a status row and chat_now's
// entries mean, what "clear after" turns into, and the words and the shape
// drawn for a person. One status for every workspace; the server keeps it in
// `user_statuses`, changed only through the `user_op_*_status` ops.

import {
  normalizeStatusClearAfter,
  normalizeStatusPreset,
  STATUS_PRESET_DEFAULTS,
  type StatusClearAfter,
  type StatusPreset,
} from "@contracts/vocabularies";

import { formatDate, formatTime } from "../time-format";

export type PersonStatus = {
  emoji: string | null;
  text: string | null;
  /** Do not disturb while it's on: pings wait in Catch up. */
  dnd: boolean;
  /** When it clears; null = never. */
  clearAt: string | null;
  preset: StatusPreset | null;
  setAt: string;
};

export type SavedStatus = {
  id: string;
  emoji: string | null;
  text: string | null;
  dnd: boolean;
  clearAfter: StatusClearAfter;
  position: number;
};

/** One person's "now" in a workspace (chat_now): never the run itself. */
export type PersonNow = {
  userId: string;
  status: PersonStatus | null;
  dnd: boolean;
  focusing: boolean;
  /** Only a Pomodoro work phase's end (from the run, never a task). */
  focusUntil: string | null;
  /** Only with their "Show what I'm focusing on" and a task you can see. */
  focusTaskId: string | null;
  focusTaskTitle: string | null;
};

/** The shapes (AC11.1): green = reachable now; grey outline = away; grey bar
 *  = do not disturb; grey target = Focusing; nothing = offline. "In a call"
 *  is Calls' sixth state (§18). */
export type PresenceState = "reachable" | "away" | "dnd" | "focusing" | "in_call" | "offline";

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A status from the server (`user_statuses` row or chat_now's `status`);
 *  null when cleared, past its time or unreadable. */
export function statusFromRow(raw: unknown, now: number = Date.now()): PersonStatus | null {
  const r = rec(raw);
  if (!r) return null;
  const setAt = str(r.set_at);
  if (!setAt) return null;
  const clearAt = str(r.clear_at);
  if (clearAt && Date.parse(clearAt) <= now) return null;
  const emoji = str(r.emoji);
  const text = str(r.text);
  const dnd = r.dnd === true;
  if (!emoji && !text && !dnd) return null;
  return { emoji, text, dnd, clearAt, preset: normalizeStatusPreset(r.preset), setAt };
}

export function savedStatusFromRow(raw: unknown): SavedStatus | null {
  const r = rec(raw);
  const id = r ? str(r.id) : null;
  if (!r || !id) return null;
  return {
    id,
    emoji: str(r.emoji),
    text: str(r.text),
    dnd: r.dnd === true,
    clearAfter: normalizeStatusClearAfter(r.clear_after),
    position: typeof r.position === "number" ? r.position : 0,
  };
}

/** chat_now's list → people by id (a malformed entry is left out). */
export function peopleNowFromRows(raw: unknown, now: number = Date.now()): Map<string, PersonNow> {
  const out = new Map<string, PersonNow>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const r = rec(item);
    const userId = r ? str(r.user_id) : null;
    if (!r || !userId) continue;
    const status = statusFromRow(r.status, now);
    out.set(userId, {
      userId,
      status,
      dnd: status?.dnd === true,
      focusing: r.focusing === true,
      focusUntil: str(r.focus_until),
      focusTaskId: str(r.focus_task_id),
      focusTaskTitle: str(r.focus_task_title),
    });
  }
  return out;
}

/**
 * The shape for a person. Server facts first (they hold whatever the
 * connection says): do not disturb, then a call, then Focusing; then what
 * presence says: reachable (open and not idle), away (open, idle 10 min),
 * else nothing.
 */
export function presenceStateOf(input: {
  online: boolean;
  away: boolean;
  dnd?: boolean;
  focusing?: boolean;
  inCall?: boolean;
}): PresenceState {
  if (input.dnd) return "dnd";
  if (input.inCall) return "in_call";
  if (input.focusing) return "focusing";
  if (!input.online) return "offline";
  return input.away ? "away" : "reachable";
}

/** The text equivalent of a shape ("" for offline: nothing is drawn). */
export function presenceLabel(state: PresenceState): string {
  switch (state) {
    case "reachable":
      return "Online";
    case "away":
      return "Away";
    case "dnd":
      return "Do not disturb";
    case "focusing":
      return "Focusing";
    case "in_call":
      return "In a call";
    default:
      return "";
  }
}

/** "until 3:00 PM" today, else "until Oct 20". */
export function untilText(at: string | null, now: Date = new Date()): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return `until ${sameDay ? formatTime(d) : formatDate(d, now)}`;
}

/** A status's words: "🌴 On vacation · until Oct 20"; do not disturb by hand
 *  reads "Do not disturb". Empty for none. */
export function statusLine(status: PersonStatus | null, now: Date = new Date()): string {
  if (!status) return "";
  const words = status.text ?? (status.dnd ? "Do not disturb" : "");
  const head = [status.emoji, words].filter(Boolean).join(" ");
  const until = untilText(status.clearAt, now);
  return until ? `${head} · ${until}` : head;
}

/** What teammates read for someone now (DM rows, Details, the person card):
 *  the status, else "Focusing · until 3:00 PM" (+ the task when shown),
 *  else the presence word. */
export function nowLine(
  person: PersonNow | undefined,
  state: PresenceState,
  now: Date = new Date(),
  opts: { task?: boolean } = {},
): string {
  if (person?.status) return statusLine(person.status, now);
  if (person?.focusing) {
    const on = opts.task && person.focusTaskTitle ? ` on ${person.focusTaskTitle}` : "";
    const until = untilText(person.focusUntil, now);
    return `Focusing${on}${until ? ` · ${until}` : ""}`;
  }
  return state === "away" ? "Away" : "";
}

/**
 * The line above the composer when someone you're writing to won't be
 * pinged (#33): "Jana is on vacation until Oct 20. They won't be notified;
 * your message waits in their Catch up." Null when nothing holds.
 */
export function composerHoldLine(
  firstName: string,
  person: PersonNow | undefined,
  now: Date = new Date(),
): string | null {
  const status = person?.status;
  if (!status?.dnd) return null;
  const until = untilText(status.clearAt, now);
  const what = status.preset
    ? PRESET_PHRASES[status.preset]
    : status.text
      ? `“${status.text}”`
      : "on do not disturb";
  const tail = "They won't be notified; your message waits in their Catch up.";
  return `${firstName} is ${what}${until ? ` ${until}` : ""}. ${tail}`;
}

const PRESET_PHRASES: Record<StatusPreset, string> = {
  meeting: "in a meeting",
  sick: "out sick",
  vacation: "on vacation",
  commuting: "commuting",
};

/** For the shared person picker: "Jana · on vacation until Oct 20". */
export function pickerSuffix(person: PersonNow | undefined, now: Date = new Date()): string {
  const status = person?.status;
  if (!status) return "";
  const what = status.preset
    ? PRESET_PHRASES[status.preset]
    : (status.text ?? (status.dnd ? "do not disturb" : ""));
  const until = untilText(status.clearAt, now);
  return [what, until].filter(Boolean).join(" ");
}

/**
 * "Clear after" → the moment the status clears, on your own clock: 30 min,
 * 1 h, the end of today, the end of this week (your week start), a picked
 * date's end, or never (null).
 */
export function clearAtFor(
  choice: StatusClearAfter,
  now: Date = new Date(),
  opts: { date?: Date | null; weekStart?: number } = {},
): string | null {
  const endOfDay = (d: Date) => {
    const e = new Date(d);
    e.setHours(23, 59, 59, 999);
    return e;
  };
  switch (choice) {
    case "30m":
      return new Date(now.getTime() + 30 * 60_000).toISOString();
    case "1h":
      return new Date(now.getTime() + 60 * 60_000).toISOString();
    case "today":
      return endOfDay(now).toISOString();
    case "this_week": {
      const start = opts.weekStart ?? 1;
      const lastDay = (start + 6) % 7;
      const ahead = (lastDay - now.getDay() + 7) % 7;
      const e = endOfDay(now);
      e.setDate(e.getDate() + ahead);
      return e.toISOString();
    }
    case "date":
      return opts.date ? endOfDay(opts.date).toISOString() : null;
    default:
      return null;
  }
}

/** "clears in 1 h", "do not disturb · today": a saved status's or preset's hint. */
export function clearAfterHint(choice: StatusClearAfter, dnd: boolean): string {
  const when: Record<StatusClearAfter, string> = {
    "30m": "clears in 30 min",
    "1h": "clears in 1 h",
    today: "clears today",
    this_week: "clears this week",
    date: "until…",
    never: "",
  };
  const w = when[choice];
  if (!dnd) return w;
  return w ? `do not disturb · ${w.replace(/^clears /, "")}` : "do not disturb";
}

export const PRESET_ORDER: readonly StatusPreset[] = ["meeting", "sick", "vacation", "commuting"];
export { STATUS_PRESET_DEFAULTS };
