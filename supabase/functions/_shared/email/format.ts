/**
 * Dates and times as emails write them: day before month, 24-hour clock, and
 * the zone named the way the booking page names it ("Friday 16 October at
 * 14:00 Warsaw time"). Locale is fixed (en-GB) so a server in any region
 * writes the same thing.
 */

// The formatters live with the booking page's, so the page and the emails
// write a time identically (specs/transactional-email.md T15).
export {
  dateLong,
  dayLong,
  dayShort,
  time24,
  zoneLabel,
} from "../../../../src/features/calendar/booking/sentence.ts";

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
