/**
 * Dates and times as emails write them: day before month, 24-hour clock, and
 * the zone named the way the booking page names it ("Friday 16 October at
 * 14:00 Warsaw time"). Locale is fixed (en-GB) so a server in any region
 * writes the same thing.
 */

import { zonePlace } from "../../../../src/features/calendar/booking/sentence.ts";

const LOCALE = "en-GB";

/** "Area/Location" IANA names (Europe/Warsaw, America/Argentina/Buenos_Aires); offsets don't match. */
const IANA_NAME = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;

/**
 * The zone's name as the engine resolves it ("europe/warsaw" → "Europe/Warsaw"
 * on V8), or null when it isn't a real IANA zone: offsets ("+01:00") and
 * unknown names are refused. Booking zones come from an unauthenticated
 * request body, so only real zone names reach the formatter cache. (Not
 * checked against Intl.supportedValuesOf: engines that keep the name as given,
 * like JavaScriptCore with "Europe/Kyiv", would wrongly fail it.)
 */
export function canonicalTimeZone(zone: unknown): string | null {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return null;
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat(LOCALE, { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (/^(Etc\/)?(UTC|GMT|UCT|Zulu|Universal)$/i.test(resolved)) return "UTC";
  return IANA_NAME.test(resolved) ? resolved : null;
}

export function isValidTimeZone(zone: unknown): zone is string {
  return canonicalTimeZone(zone) !== null;
}

/** The zone to write in (canonical), falling back when the one we were given is unusable. */
export function usableTimeZone(zone: unknown, fallback = "UTC"): string {
  return canonicalTimeZone(zone) ?? canonicalTimeZone(fallback) ?? "UTC";
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Bounds the cache even if callers pass zones straight from a request (variants of one zone each get a key). */
const MAX_FORMATTERS = 512;

/** One formatter per zone and shape, reused across calls (building one is the expensive part). */
function formatter(zone: string, shape: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${zone}|${shape}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: zone });
    if (formatters.size >= MAX_FORMATTERS) formatters.clear();
    formatters.set(key, fmt);
  }
  return fmt;
}

function parts(date: Date, zone: string, shape: string, options: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  for (const part of formatter(zone, shape, options).formatToParts(date)) {
    out[part.type] = part.value;
  }
  return out;
}

/** "Friday 16 October" */
export function dayLong(date: Date, zone: string): string {
  const p = parts(date, zone, "dayLong", { weekday: "long", day: "numeric", month: "long" });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "Fri 16 Oct" */
export function dayShort(date: Date, zone: string): string {
  const p = parts(date, zone, "dayShort", { weekday: "short", day: "numeric", month: "short" });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "8 October 2026" */
export function dateLong(date: Date, zone: string): string {
  const p = parts(date, zone, "dateLong", { day: "numeric", month: "long", year: "numeric" });
  return `${p.day} ${p.month} ${p.year}`;
}

/** "14:00" */
export function time24(date: Date, zone: string): string {
  const p = parts(date, zone, "time24", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.hour}:${p.minute}`;
}

/** "Warsaw time", or "UTC". */
export function zoneLabel(zone: string): string {
  const place = zonePlace(zone);
  return place === "UTC" ? "UTC" : `${place} time`;
}
