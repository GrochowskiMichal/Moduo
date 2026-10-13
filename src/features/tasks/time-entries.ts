// "Add time…" and your own entries (TV-D14, spec §14, REPLAN 75): what the
// Time field's quick line reads ("2h yesterday call with Anna") and how each
// entry reads in your list. Pure.

import { formatDay } from "../../lib/time-format";
import type { TaskTimeEntry } from "./model";
import { formatTracked, parseMinutes } from "./time-format";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A device-local day as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** YYYY-MM-DD as the device-local midnight it names, or null. */
export function dayToDate(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

/** The longest logged time an entry may hold (24 hours), in minutes. */
export const MAX_ENTRY_MINUTES = 24 * 60;

export type ParsedTimeEntry = {
  minutes: number;
  /** YYYY-MM-DD. */
  day: string;
  note: string | null;
};

/** A day word at the start of `words`: today, yesterday, a weekday (the last
 *  one, today included), or a date (2026-10-03). */
function takeDay(words: string[], now: Date): { day: string; used: number } | null {
  const first = (words[0] ?? "").toLowerCase().replace(/[,·]$/, "");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (first === "today") return { day: isoDay(today), used: 1 };
  if (first === "yesterday") {
    today.setDate(today.getDate() - 1);
    return { day: isoDay(today), used: 1 };
  }
  if (first in WEEKDAYS) {
    const back = (today.getDay() - (WEEKDAYS[first] as number) + 7) % 7;
    today.setDate(today.getDate() - back);
    return { day: isoDay(today), used: 1 };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(first) && dayToDate(first)) return { day: first, used: 1 };
  return null;
}

/**
 * "2h yesterday call with Anna" → 120 minutes, yesterday, "call with Anna".
 * The length comes first ("2h", "1h 30m", "45m", "1:30"), then an optional
 * day (today when there's none), then the note. Null without a length, or for
 * one over 24 hours or a day after today.
 */
export function parseTimeEntry(input: string, now: Date = new Date()): ParsedTimeEntry | null {
  const words = input
    .trim()
    .replace(/\s*·\s*/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  let minutes: number | null = null;
  let used = 0;
  // The longest leading run of words that reads as a length ("1h 30m").
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const m = parseMinutes(words.slice(0, n).join(" "));
    if (m !== null) {
      minutes = m;
      used = n;
      break;
    }
  }
  if (minutes === null || minutes < 1 || minutes > MAX_ENTRY_MINUTES) return null;
  const rest = words.slice(used);
  const day = takeDay(rest, now);
  const today = isoDay(now);
  const on = day?.day ?? today;
  if (on > today) return null;
  const note = rest
    .slice(day?.used ?? 0)
    .join(" ")
    .replace(/^[-–—:]\s*/, "")
    .trim();
  return { minutes, day: on, note: note || null };
}

/** How one of your entries reads: what it is, and whether it can change. */
export type EntryLine = {
  /** "Yesterday", "Oct 6". */
  day: string;
  /** "2h", "−3m". */
  length: string;
  /** "Logged" · "Focus" · "Adjusted" · "Given back" (+ the note when there is one). */
  label: string;
  note: string | null;
  /** Logged and Focus entries can be edited and removed by their person. */
  editable: boolean;
};

/** The device-local day an entry is on: a logged entry's own day, else when it happened. */
export function entryDay(entry: TaskTimeEntry): string {
  if (entry.entryOn) return entry.entryOn;
  return isoDay(new Date(entry.startedAt ?? entry.createdAt));
}

export function entryLine(entry: TaskTimeEntry, now: Date = new Date()): EntryLine {
  const day = dayToDate(entryDay(entry));
  const negative = entry.seconds < 0;
  const label =
    entry.kind === "manual"
      ? "Logged"
      : entry.kind === "focus"
        ? "Focus"
        : entry.reason === "give_back"
          ? "Given back"
          : entry.kind === "waiting"
            ? "Waiting"
            : "Adjusted";
  return {
    day: day ? formatDay(day, now) : "",
    length: `${negative ? "−" : ""}${formatTracked(Math.abs(entry.seconds))}`,
    label,
    note: entry.reason === "give_back" ? "Counted on two devices at once" : entry.note,
    editable: entry.kind === "manual" || entry.kind === "focus",
  };
}
