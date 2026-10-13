// The one date, time and duration grammar (Tasks v3 decision 41, TV-P0):
//   Today · Tomorrow · Mon · Oct 16 · Oct 16, 2027 · 3:00 PM · 45m · 1h 30m · 4h
// Every surface that shows a task's date, time or length reads it through
// here, so a date never says the same thing two ways. The order of day and
// month and the 12/24-hour clock come from Settings → Time & region
// (TV-D14, `time-region.ts`), the device's when the person hasn't chosen.
// Clocks are the device's own. A component that must redraw when the setting
// changes reads `useTimeRegion()` (a memoised row included). No IO.

import type { DateOrder } from "@contracts/vocabularies";

import { deviceDateOrder, deviceHour12, getResolvedTimeRegion } from "./time-region";

type Formats = {
  key: string;
  time: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
  month: Intl.DateTimeFormat;
  monthDay: Intl.DateTimeFormat;
  monthDayYear: Intl.DateTimeFormat;
  /** The device writes dates in this order: its formats can be used as they are. */
  natural: boolean;
  order: DateOrder;
};

let cached: Formats | null = null;
const DEVICE_HOUR12 = deviceHour12();
const DEVICE_ORDER = deviceDateOrder();

function formats(): Formats {
  const { hour12, dateOrder } = getResolvedTimeRegion();
  const key = `${hour12}|${dateOrder}`;
  if (cached?.key === key) return cached;
  cached = {
    key,
    time: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(hour12 === DEVICE_HOUR12 ? {} : { hourCycle: hour12 ? "h12" : "h23" }),
    }),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }),
    month: new Intl.DateTimeFormat(undefined, { month: "short" }),
    monthDay: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }),
    monthDayYear: new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    natural: dateOrder === DEVICE_ORDER,
    order: dateOrder,
  };
  return cached;
}

/** "Oct 16" / "16 Oct", with the year when asked: "Oct 16, 2027" / "16 Oct 2027". */
function monthDayText(d: Date, withYear: boolean): string {
  const f = formats();
  if (f.natural) return (withYear ? f.monthDayYear : f.monthDay).format(d);
  const month = f.month.format(d);
  const day = d.getDate();
  if (f.order === "day_month")
    return withYear ? `${day} ${month} ${d.getFullYear()}` : `${day} ${month}`;
  return withYear ? `${month} ${day}, ${d.getFullYear()}` : `${month} ${day}`;
}

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
  if (offset > 1 && offset < 7) return formats().weekday.format(d);
  return monthDayText(d, d.getFullYear() !== now.getFullYear());
}

/** A calendar date with no relative words: "Oct 16", "Oct 16, 2027". */
export function formatDate(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  return monthDayText(d, d.getFullYear() !== now.getFullYear());
}

/** A clock time with its minutes: "3:00 PM" (or "15:00" on a 24-hour clock). */
export function formatTime(value: DateInput): string {
  const d = toDate(value);
  return d ? formats().time.format(d) : "";
}

/** The Intl options for a clock time on the person's clock (another zone's
 *  clock, say: pass `timeZone` alongside). */
export function clockOptions(): Intl.DateTimeFormatOptions {
  const { hour12 } = getResolvedTimeRegion();
  return { hour: "numeric", minute: "2-digit", hourCycle: hour12 ? "h12" : "h23" };
}

/** An hour on its own, for a grid's gutter: "9 AM" or "09". */
export function formatHour(hour: number): string {
  const { hour12 } = getResolvedTimeRegion();
  const d = new Date(2000, 0, 1, hour);
  return hour12
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", hourCycle: "h12" }).format(d)
    : String(hour).padStart(2, "0");
}

/** A date with its year always: "Oct 16, 2026" / "16 Oct 2026". */
export function formatFullDate(value: DateInput): string {
  const d = toDate(value);
  return d ? monthDayText(d, true) : "";
}

/** A weekday and a date: "Thu, Jul 2" / "Thu, 2 Jul" (the year when it isn't this one). */
export function formatWeekdayDate(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  return `${formats().weekday.format(d)}, ${monthDayText(d, d.getFullYear() !== now.getFullYear())}`;
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

/**
 * How long ago, as short as a column allows (a List's Updated and Waiting on
 * cells, TV-U10): "now", "5m", "3h", "2d", "3w", then the date ("Oct 16").
 * A moment in the future (a clock ahead) reads "now".
 */
export function formatAge(value: DateInput, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "";
  const minutes = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 35) return `${Math.floor(days / 7)}w`;
  return formatDate(d, now);
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
