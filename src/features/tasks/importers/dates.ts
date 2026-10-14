// Dates as exports write them (TV-U18). A due date stays the date it was
// (the same date for everyone, TV-D9); a due time stays the wall clock it
// was written at. A moment (Trello's and Linear's ISO times) becomes the date
// and time it was in the person's zone from Time & region (TV-D14).

import { toFloating } from "../../../lib/zoned-time";
import type { RecurrenceRule } from "../model";
import { parseCapture } from "../parse/capture-parser";

export type DueParts = { dueOn: string; dueTime: string | null };

const pad = (n: number) => String(n).padStart(2, "0");

function validDay(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "2026-10-20" (or the date at the start of an ISO time). */
export function isoDay(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? validDay(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** An ISO moment's date and wall time in `zone`; midnight reads as a date alone. */
export function dueFromInstant(value: string, zone: string): DueParts | null {
  const v = value.trim();
  if (!v) return null;
  // A date alone is that date, never shifted by a zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const day = isoDay(v);
    return day ? { dueOn: day, dueTime: null } : null;
  }
  const at = new Date(v);
  if (Number.isNaN(at.getTime())) return null;
  const wall = toFloating(at, zone);
  const dueOn = `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  const h = wall.getUTCHours();
  const min = wall.getUTCMinutes();
  return { dueOn, dueTime: h === 0 && min === 0 ? null : `${pad(h)}:${pad(min)}` };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Jira's export dates: "13/Oct/26 10:15 AM", "13/Oct/2026", "2026-10-13
 * 10:15" — the wall clock of whoever exported it.
 */
export function jiraDue(value: string): DueParts | null {
  const v = value.trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(v);
  if (iso) {
    const day = validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (!day) return null;
    return { dueOn: day, dueTime: clock(iso[4], iso[5], null) };
  }
  const m =
    /^(\d{1,2})\/([A-Za-z]{3})[a-z]*\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?$/.exec(v);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const day = validDay(year, month, Number(m[1]));
  if (!day) return null;
  return { dueOn: day, dueTime: clock(m[4], m[5], m[6] ?? null) };
}

function clock(h?: string, min?: string, ampm?: string | null): string | null {
  if (h === undefined || min === undefined) return null;
  let hour = Number(h);
  const minute = Number(min);
  if (ampm) {
    const pm = ampm.toLowerCase() === "pm";
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  if (hour > 23 || minute > 59) return null;
  return hour === 0 && minute === 0 ? null : `${pad(hour)}:${pad(minute)}`;
}

/** US-style exports ("10/20/2026"), Asana's when it isn't ISO. */
export function slashDue(value: string): DueParts | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const day = validDay(Number(m[3]), Number(m[1]), Number(m[2]));
  return day ? { dueOn: day, dueTime: null } : null;
}

export type WordsDue =
  | { kind: "none" }
  | { kind: "date"; due: DueParts; recurrence: RecurrenceRule | null }
  /** Words Moduo can't follow: keep them as text. */
  | { kind: "text"; repeat: boolean };

/**
 * A date written in words, as Todoist exports them ("every monday", "Oct 20
 * 2026 15:00", "2026-10-20"): read with capture's own reader (TV-U14), so
 * a repeat lands only where Moduo's repeats can follow it (TV-D12); anything
 * it can't read whole is kept as text.
 */
export function wordsDue(value: string, now: Date = new Date()): WordsDue {
  const v = value.trim();
  if (!v) return { kind: "none" };
  const day = isoDay(v);
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(v))
    return { kind: "date", due: { dueOn: day, dueTime: null }, recurrence: null };
  const parsed = parseCapture(v, now);
  const repeatWords = /\b(every|each|daily|weekly|monthly|yearly|annually)\b/i.test(v);
  // Read whole or not at all: words outside what the reader recognised mean
  // part of it was missed ("every 3rd workday"), and an end the rule doesn't
  // carry ("until Dec 15", "for 3 weeks") would repeat for ever.
  if (!parsed.matched || parsed.unparsedRecurrence || !coversAll(v, parsed.spans)) {
    return { kind: "text", repeat: repeatWords };
  }
  if (
    parsed.recurrence &&
    /\b(until|ending|ends|for \d+|starting|from)\b/i.test(v) &&
    !/\b(UNTIL|COUNT)=/.test(parsed.recurrence.rrule)
  ) {
    return { kind: "text", repeat: true };
  }
  if (repeatWords && !parsed.recurrence) return { kind: "text", repeat: true };
  const at = parsed.scheduledAt ?? parsed.recurrence?.nextOccurrence ?? parsed.dueDate;
  if (!at) return { kind: "text", repeat: repeatWords };
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return { kind: "text", repeat: repeatWords };
  const dueOn = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const timed =
    parsed.scheduledAt !== null ||
    (parsed.recurrence !== null && /\d(:\d{2})?\s*(am|pm)\b|\d{1,2}:\d{2}|\bnoon\b/i.test(v));
  const dueTime = timed ? `${pad(when.getHours())}:${pad(when.getMinutes())}` : null;
  return { kind: "date", due: { dueOn, dueTime }, recurrence: parsed.recurrence };
}

/** Whether the recognised spans cover every non-space character. */
function coversAll(text: string, spans: ReadonlyArray<readonly [number, number]>): boolean {
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i]!)) continue;
    if (!spans.some(([a, b]) => i >= a && i < b)) return false;
  }
  return true;
}
