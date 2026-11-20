// Time zones on the week (CALR-13, AC15). Pure, plus one small device store:
//  • a second zone (Z): its short name, its hours in the gutter, an event's
//    time on its clock ("9–10 AM PT");
//  • clock changes, yours or the second zone's, labelled on their day.
// The grid itself stays on the device's clock (Time & region decision D14-2).
// Other people's own zones aren't readable (members share no zone, guests
// carry none), so an event says its time in the zone you picked.

import { useSyncExternalStore } from "react";

import { deviceTimeZone } from "../../lib/device-time-zone";
import { toFloating, zonedDay } from "../../lib/zoned-time";

const MIN = 60_000;

/** Minutes the zone is ahead of UTC at an instant; the device's when no zone. */
export function zoneOffsetMinutes(zone: string | null | undefined, atMs: number): number {
  if (!zone) return -new Date(atMs).getTimezoneOffset();
  return Math.round((toFloating(new Date(atMs), zone).getTime() - atMs) / MIN);
}

/** Each day's offset in `zone`, read at the day's local noon. */
export function zoneOffsetsByDay(days: readonly Date[], zone: string): number[] {
  return days.map((d) =>
    zoneOffsetMinutes(zone, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime()),
  );
}

export type ClockChange = { direction: "forward" | "back"; atMs: number };

/** The clock change in `zone` (the device's when none) between two instants. */
export function clockChangeBetween(
  zone: string | null | undefined,
  startMs: number,
  endMs: number,
): ClockChange | null {
  const before = zoneOffsetMinutes(zone, startMs);
  const after = zoneOffsetMinutes(zone, endMs - 1);
  if (before === after) return null;
  let lo = startMs;
  let hi = endMs - 1;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (zoneOffsetMinutes(zone, mid) === before) lo = mid;
    else hi = mid;
  }
  return { direction: after > before ? "forward" : "back", atMs: Math.floor(hi / MIN) * MIN };
}

/** The note under a day's date: "Clocks go back", "PT clocks go back". */
export function dayZoneNote(day: Date, secondZone: string | null): string | null {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const mine = clockChangeBetween(null, start, end);
  const theirs = secondZone ? clockChangeBetween(secondZone, start, end) : null;
  const notes: string[] = [];
  if (mine) notes.push(`Clocks go ${mine.direction}`);
  // A zone whose clocks change with yours needs no second note.
  if (theirs && secondZone && theirs.direction !== mine?.direction)
    notes.push(
      `${secondZoneLabel(secondZone, new Date(theirs.atMs))} clocks go ${theirs.direction}`,
    );
  return notes.length > 0 ? notes.join(" · ") : null;
}

function zoneName(
  zone: string,
  at: Date,
  locale: string,
  style: "short" | "shortGeneric",
): string | null {
  try {
    return (
      new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: style })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? null
    );
  } catch {
    return null;
  }
}

/** A zone's short name: "PT", "CET", else its city ("Tokyo"). */
export function secondZoneLabel(zone: string, at: Date): string {
  const short = /^[A-Z]{2,5}$/;
  for (const [locale, style] of [
    ["en-US", "shortGeneric"],
    ["en-US", "short"],
    ["en-GB", "short"],
  ] as const) {
    const name = zoneName(zone, at, locale, style);
    if (name && short.test(name)) return name;
  }
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

type ClockOpts = { hour12: boolean; locale?: string };

type ClockParts = { hour: string; minute: string; period: string };

function clockParts(atMs: number, zone: string, { hour12, locale }: ClockOpts): ClockParts {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hourCycle: hour12 ? "h12" : "h23",
  }).formatToParts(new Date(atMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { hour: get("hour"), minute: get("minute"), period: get("dayPeriod") };
}

function clockText(p: ClockParts, hour12: boolean, withPeriod: boolean): string {
  if (!hour12) return `${p.hour}:${p.minute}`;
  const time = p.minute === "00" ? p.hour : `${p.hour}:${p.minute}`;
  return withPeriod && p.period ? `${time} ${p.period}` : time;
}

/** A gutter hour on the second zone's clock: "10 AM", "10", "22:30". */
export function zoneHourLabel(atMs: number, zone: string, opts: ClockOpts): string {
  const p = clockParts(atMs, zone, opts);
  if (opts.hour12) return clockText(p, true, true);
  return p.minute === "00" ? p.hour : `${p.hour}:${p.minute}`;
}

/** An event's time on the zone's clock: "9–10 AM PT", "11 PM–12 AM PT (Tue)". */
export function formatZoneRange(
  startMs: number,
  endMs: number,
  zone: string,
  opts: ClockOpts & { localZone?: string | null },
): string {
  const s = clockParts(startMs, zone, opts);
  const e = clockParts(endMs, zone, opts);
  const samePeriod = opts.hour12 && s.period === e.period;
  const range = `${clockText(s, opts.hour12, !samePeriod)}–${clockText(e, opts.hour12, true)}`;
  const label = secondZoneLabel(zone, new Date(startMs));
  const localZone = opts.localZone ?? deviceTimeZone();
  const at = new Date(startMs);
  if (zonedDay(at, zone) === zonedDay(at, localZone)) return `${range} ${label}`;
  const weekday = new Intl.DateTimeFormat(opts.locale, { timeZone: zone, weekday: "short" }).format(
    at,
  );
  return `${range} ${label} (${weekday})`;
}

// ── the second zone setting: per device, like the view ──────────────────────

export type SecondZone = { zone: string | null; shown: boolean };

const KEY = "moduo:calendar:second-zone";
const NONE: SecondZone = { zone: null, shown: false };

function knownZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function sanitizeSecondZone(raw: unknown): SecondZone {
  if (!raw || typeof raw !== "object") return NONE;
  const o = raw as { zone?: unknown; shown?: unknown };
  if (!knownZone(o.zone)) return NONE;
  return { zone: o.zone, shown: o.shown === true };
}

/** Z: show or hide the picked zone (nothing to show without one). */
export function toggleSecondZone(s: SecondZone): SecondZone {
  return s.zone ? { zone: s.zone, shown: !s.shown } : s;
}

let cachedRaw: string | null | undefined;
let cached: SecondZone = NONE;
const listeners = new Set<() => void>();

function rawStored(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function readSecondZone(): SecondZone {
  const raw = rawStored();
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    cached = raw ? sanitizeSecondZone(JSON.parse(raw)) : NONE;
  } catch {
    cached = NONE;
  }
  return cached;
}

export function writeSecondZone(next: SecondZone): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sanitizeSecondZone(next)));
  } catch {
    /* storage off: the zone lasts this session only through the cache */
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const serverSnapshot = () => NONE;

/** The second zone, live across the corner, the gutter and the Event view. */
export function useSecondZone(): SecondZone {
  return useSyncExternalStore(subscribe, readSecondZone, serverSnapshot);
}
