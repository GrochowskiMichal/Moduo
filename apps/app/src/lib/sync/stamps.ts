// Server timestamps as the sync code compares them: Realtime and PostgREST
// spell timestamptz differently, and two saves can land in the same
// millisecond, so every comparison goes through microseconds. Pure, shared by
// the shared store (lib/sync), the chat store and the Tasks live layer.

/**
 * A Postgres timestamp as microseconds since the epoch, or null. Realtime and
 * PostgREST format timestamptz differently (`2026-10-08 20:05:25.123456+00`
 * vs `…T…+00:00`), and two saves can land in the same millisecond, so this
 * keeps all six fractional digits.
 */
export function timestampMicros(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(
    ts.trim(),
  );
  if (!m) {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? null : ms * 1000;
  }
  let zone = m[4] ?? "Z";
  if (/^[+-]\d\d$/.test(zone)) zone = `${zone}:00`;
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const seconds = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (Number.isNaN(seconds)) return null;
  const micros = Number(`${m[3] ?? ""}000000`.slice(0, 6));
  return seconds * 1000 + micros;
}

/** A server stamp moved back by `ms`, keeping its microseconds. */
export function stampMinus(stamp: string, ms: number): string {
  const micros = timestampMicros(stamp);
  if (micros === null) return stamp;
  const at = micros - ms * 1000;
  const whole = Math.floor(at / 1000);
  const frac = String(((at % 1000) + 1000) % 1000).padStart(3, "0");
  // toISOString gives milliseconds; add the remaining microseconds.
  return new Date(whole).toISOString().replace(/Z$/, `${frac}+00:00`);
}

/** Whether `incoming` is strictly newer than `local` (unknown stamps count as newer). */
export function isNewer(incoming: string | null | undefined, local: string | null | undefined) {
  const a = timestampMicros(incoming);
  const b = timestampMicros(local);
  if (a === null || b === null) return a !== null || b === null;
  return a > b;
}
