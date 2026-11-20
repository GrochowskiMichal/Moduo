// Snooze scheduling (EM-6, AC6). Pure wall-clock helpers: the preset menu
// ("Later today / Tomorrow / This weekend / Next week") resolves each choice to a
// concrete local instant, and small label/selection helpers the picker + rail use.
// No I/O — the cloud state (email_op_snooze) + the IMAP move (email_snooze_thread)
// are driven by the hook; this module only computes WHEN. It also reads typed
// times ("thu 9am", "in 3 days", "next week", "dec 2") for the picker (MV-9).

import { formatDate, formatTime, formatWeekdayDate } from "../../lib/time-format";

/** A resolved snooze choice: a stable id, a human label, and the target instant. */
export type SnoozePreset = {
  id: "later_today" | "tomorrow" | "this_weekend" | "next_week" | "someday";
  label: string;
  /** Local instant the thread returns to the inbox. */
  at: Date;
};

/** The default morning hour a "tomorrow / weekend / next week" snooze lands on. */
export const SNOOZE_MORNING_HOUR = 9;
/** "Later today" lands at this hour (specs/mail-v3.md §8: Later today 18:00). */
export const SNOOZE_EVENING_HOUR = 18;
/** "Someday" (MR-14): out of sight for three months, back on a morning. */
export const SNOOZE_SOMEDAY_DAYS = 90;

function atLocalHour(base: Date, dayOffset: number, hour: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Days until the upcoming Saturday (0 = today is already Saturday). */
function daysUntilSaturday(base: Date): number {
  // getDay(): 0 = Sun … 6 = Sat.
  return (6 - base.getDay() + 7) % 7;
}

/** Days until the upcoming Monday (0 = today is already Monday). */
function daysUntilMonday(base: Date): number {
  return (1 - base.getDay() + 7) % 7;
}

/**
 * The preset menu, resolved against `now` (specs/mail-v3.md §8). Every choice
 * lands strictly in the future: "Later today" is today at 18:00 and is left out
 * once that has passed; "This weekend" / "Next week" skip to the *next* Saturday /
 * Monday morning when today already is one (so snoozing on a Saturday goes to next
 * Saturday, never a past instant).
 */
export function snoozePresets(now: Date): SnoozePreset[] {
  const laterToday = atLocalHour(now, 0, SNOOZE_EVENING_HOUR);

  const satOffset = daysUntilSaturday(now) === 0 ? 7 : daysUntilSaturday(now);
  const monOffset = daysUntilMonday(now) === 0 ? 7 : daysUntilMonday(now);

  const later: SnoozePreset[] =
    laterToday.getTime() > now.getTime()
      ? [{ id: "later_today", label: "Later today", at: laterToday }]
      : [];
  return [
    ...later,
    { id: "tomorrow", label: "Tomorrow", at: atLocalHour(now, 1, SNOOZE_MORNING_HOUR) },
    {
      id: "this_weekend",
      label: "This weekend",
      at: atLocalHour(now, satOffset, SNOOZE_MORNING_HOUR),
    },
    { id: "next_week", label: "Next week", at: atLocalHour(now, monOffset, SNOOZE_MORNING_HOUR) },
    {
      id: "someday",
      label: "Someday",
      at: atLocalHour(now, SNOOZE_SOMEDAY_DAYS, SNOOZE_MORNING_HOUR),
    },
  ];
}

/** Clamp a custom datetime to strictly-future; returns null when it isn't. */
export function normalizeSnoozeAt(at: Date, now: Date): Date | null {
  if (!Number.isFinite(at.getTime())) return null;
  if (at.getTime() <= now.getTime()) return null;
  return at;
}

/**
 * A short "returns <when>" label. Same-day → time only; within a week → weekday +
 * time; else a compact date + time. Wall-clock, locale-formatted.
 */
export function formatSnoozeUntil(atIso: string, now: Date): string {
  const at = new Date(atIso);
  if (!Number.isFinite(at.getTime())) return "";
  const time = formatTime(at);
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) return time;
  const days = Math.round((atLocalMidnight(at) - atLocalMidnight(now)) / 86_400_000);
  if (days === 1) return `Tomorrow ${time}`;
  if (days > 1 && days < 7) {
    return `${at.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  }
  return `${formatDate(at, now)} ${time}`;
}

function atLocalMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// ── Typed times (specs/mail-v3.md §8, AC27) ─────────────────────────────────
// "thu 9am", "in 3 days", "next week", "dec 2", "tomorrow 3pm", "9:30", "sat".
// A day without a time lands on the morning hour; a time without a day is today,
// or tomorrow once it has passed. Anything left unread makes the whole text
// unreadable (null), so the picker can say "Can't read that".

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  min: 60_000,
  hour: 3600_000,
  hr: 3600_000,
};
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7 };

type Clock = { h: number; m: number };

/** A prefix match of at least three letters ("thursday", "thurs", "thu" → 4); -1 when none. */
function prefixIndex(list: readonly string[], word: string): number {
  if (word.length < 3) return -1;
  return list.findIndex((name) => word.startsWith(name));
}

function toClock(hour: number, minute: number, meridiem: string | undefined): Clock | null {
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    return { h: (hour % 12) + (meridiem === "pm" ? 12 : 0), m: minute };
  }
  return hour > 23 ? null : { h: hour, m: minute };
}

/** One time token ("9am", "9:30", "18:00", "noon"), or a bare hour when allowed. */
function parseClock(token: string, bareHour: boolean): Clock | null {
  if (token === "noon") return { h: 12, m: 0 };
  if (token === "midnight") return { h: 0, m: 0 };
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(token);
  if (!m) return null;
  if (!m[2] && !m[3] && !bareHour) return null;
  return toClock(Number(m[1]), Number(m[2] ?? 0), m[3]);
}

/** Splits the time off the words ("thu 9 am" → ["thu"], 9:00); null on two times. */
function takeClock(words: string[]): { rest: string[]; clock: Clock | null } | null {
  const joined = words.join(" ").replace(/\b(\d{1,2}(?::\d{2})?) (am|pm)\b/g, "$1$2");
  const tokens = joined.split(" ").filter((w) => w && w !== "at");
  // "dec 2": a bare number next to a month is the day, not the hour.
  const bareHour = !tokens.some((t) => prefixIndex(MONTHS, t) >= 0);
  const rest: string[] = [];
  let clock: Clock | null = null;
  for (const t of tokens) {
    const c = parseClock(t, bareHour);
    if (c && clock) return null;
    if (c) clock = c;
    else rest.push(t);
  }
  return { rest, clock };
}

function dayAt(base: Date, dayOffset: number, clock: Clock): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(clock.h, clock.m, 0, 0);
  return d;
}

/** "in 3 days", "in 2 hours", "in a week": hours from now, days on the morning. */
function parseRelative(text: string, now: Date): Date | null {
  const m = /^in (\d+|a|an|one|two|three|four) (minute|min|hour|hr|day|week)s?$/.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : WORD_NUMBERS[m[1]!]!;
  const unit = m[2]!;
  if (UNIT_MS[unit]) return new Date(now.getTime() + n * UNIT_MS[unit]!);
  return dayAt(now, n * UNIT_DAYS[unit]!, { h: SNOOZE_MORNING_HOUR, m: 0 });
}

/** "dec 2", "2 dec", "december 2nd": this year's, or next year's once passed. */
function parseMonthDay(words: string[], now: Date, clock: Clock): Date | null {
  if (words.length !== 2) return null;
  const [a, b] = words as [string, string];
  const monthFirst = prefixIndex(MONTHS, a) >= 0;
  const month = prefixIndex(MONTHS, monthFirst ? a : b);
  const dayText = (monthFirst ? b : a).replace(/(st|nd|rd|th)$/, "");
  if (month < 0 || !/^\d{1,2}$/.test(dayText)) return null;
  const at = new Date(now.getFullYear(), month, Number(dayText), clock.h, clock.m, 0, 0);
  if (at.getMonth() !== month) return null;
  if (at.getTime() <= now.getTime()) at.setFullYear(at.getFullYear() + 1);
  return at;
}

/** Days from today to a weekday: today while its time is still ahead, else next week's. */
function weekdayOffset(now: Date, weekday: number, clock: Clock): number {
  const offset = (weekday - now.getDay() + 7) % 7;
  if (offset > 0) return offset;
  return dayAt(now, 0, clock).getTime() > now.getTime() ? 0 : 7;
}

const NAMED_DAYS: Record<string, (now: Date) => number> = {
  today: () => 0,
  tonight: () => 0,
  tomorrow: () => 1,
  tmrw: () => 1,
  "next week": (now) => daysUntilMonday(now) || 7,
  weekend: (now) => daysUntilSaturday(now) || 7,
  "this weekend": (now) => daysUntilSaturday(now) || 7,
};

/** A time with no day: today, or tomorrow once it has passed. */
function nextAt(now: Date, clock: Clock): Date {
  const today = dayAt(now, 0, clock);
  return today.getTime() > now.getTime() ? today : dayAt(now, 1, clock);
}

/** The day words ("", "tomorrow", "thu", "next thu", "dec 2") at the given clock. */
function parseDay(words: string[], now: Date, clock: Clock | null): Date | null {
  const text = words.join(" ");
  if (!text) return clock ? nextAt(now, clock) : null;
  const time = clock ?? { h: text === "tonight" ? 20 : SNOOZE_MORNING_HOUR, m: 0 };
  const named = NAMED_DAYS[text];
  if (named) return dayAt(now, named(now), time);
  const bare = words[0] === "next" || words[0] === "this" ? words.slice(1) : words;
  const weekday = bare.length === 1 ? prefixIndex(WEEKDAYS, bare[0]!) : -1;
  if (weekday >= 0) return dayAt(now, weekdayOffset(now, weekday, time), time);
  return parseMonthDay(words, now, time);
}

function parseWords(text: string, now: Date): Date | null {
  const split = takeClock(text.split(" "));
  return split ? parseDay(split.rest, now, split.clock) : null;
}

/**
 * A typed snooze time resolved against `now`; null when it can't be read or
 * lands in the past.
 */
export function parseSnoozeText(input: string, now: Date): Date | null {
  const text = input.toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const at = parseRelative(text, now) ?? parseWords(text, now);
  return at ? normalizeSnoozeAt(at, now) : null;
}

const SHORT_WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/**
 * A preset's resolved time beside its label: the time today, "Sat 9:00" within
 * the week, else the date.
 */
export function snoozeHint(at: Date, now: Date): string {
  const days = Math.round((atLocalMidnight(at) - atLocalMidnight(now)) / 86_400_000);
  if (days === 0) return formatTime(at);
  if (days < 7) return `${SHORT_WEEKDAY.format(at)} ${formatTime(at)}`;
  return formatDate(at, now);
}

/** The typed field's live preview: "Thu, Jul 9 · 9:00 AM". */
export function snoozePreview(at: Date, now: Date): string {
  return `${formatWeekdayDate(at, now)} · ${formatTime(at)}`;
}
