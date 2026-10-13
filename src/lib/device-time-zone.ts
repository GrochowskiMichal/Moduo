// The device's time zone (TV-D8). Time & region (TV-D14, `time-region.ts`)
// sends it at sign-in when the person has no zone of their own yet, and asks
// once when the device moves to another zone.

/** The IANA zone the device is in ("Europe/Warsaw"), or null when unknown. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone.trim() ? zone : null;
  } catch {
    return null;
  }
}
