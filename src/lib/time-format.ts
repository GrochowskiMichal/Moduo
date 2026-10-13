// The one date, time and duration grammar (Tasks v3 decision 41, TV-P0):
//   Today · Tomorrow · Mon · Oct 16 · Oct 16, 2027 · 3:00 PM · 45m · 1h 30m · 4h
// Every surface that shows a task's date, time or length reads it through
// here, so a date never says the same thing two ways. The order of day and
// month and the 12/24-hour clock follow the device until Settings → Time &
// region (TV-D14) feeds this module. Pure.

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

type DateInput = Date | string | number;

function toDate(value: DateInput): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole days from `now`'s day to `d`'s (0 = same day, 1 = tomorrow, -1 = yesterday). */
export function dayOffset(value: DateInput, now: Date = new Date()): number {
  const d = toDate(value);
  if (!d) return Number.NaN;
  return Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
}

/**
 * A day: "Today", "Tomorrow", "Yesterday", the weekday for the rest of the
 * coming week ("Mon"), else the month and day ("Oct 16"), with the year when
 * it isn't this year's ("Oct 16, 2027"). Empty for an invalid date.
 */
export function formatDay(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  const offset = dayOffset(d, now);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  if (offset > 1 && offset < 7) return WEEKDAY.format(d);
  return d.getFullYear() === now.getFullYear() ? MONTH_DAY.format(d) : MONTH_DAY_YEAR.format(d);
}

/** A calendar date with no relative words: "Oct 16", "Oct 16, 2027". */
export function formatDate(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  return d.getFullYear() === now.getFullYear() ? MONTH_DAY.format(d) : MONTH_DAY_YEAR.format(d);
}

/** A clock time with its minutes: "3:00 PM" (or "15:00" on a 24-hour device). */
export function formatTime(value: DateInput): string {
  const d = toDate(value);
  return d ? TIME.format(d) : "";
}

/** A day and a time: "Today, 3:00 PM", "Mon, 9:30 AM", "Oct 16, 2027, 3:00 PM". */
export function formatDayTime(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  return `${formatDay(d, now)}, ${formatTime(d)}`;
}

/** As short as it can be: just the time today ("3:00 PM"), else the day and time. */
export function formatWhen(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  return dayOffset(d, now) === 0 ? formatTime(d) : formatDayTime(d, now);
}

/** A moment in a record (created, updated): the absolute date and time, "Oct 6, 12:07 PM". */
export function formatStamp(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  return `${formatDate(d, now)}, ${formatTime(d)}`;
}

/** A length in whole minutes: "0m", "45m", "4h", "1h 30m". */
export function formatDuration(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** A length in seconds, rounded to the minute: "0m", "45m", "1h 30m". */
export function formatDurationSeconds(seconds: number): string {
  return formatDuration(Number.isFinite(seconds) ? Math.round(seconds / 60) : 0);
}
