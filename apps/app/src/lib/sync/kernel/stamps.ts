// Server timestamps as the sync code compares them (sync kernel, Track C).
// Realtime and PostgREST spell timestamptz differently, and two saves can land
// in the same millisecond, so every comparison goes through microseconds.
// Carry stamps and keyset positions as text, never a JS `Date`: it drops the
// microseconds, and a keyset page restarting from it repeats or skips rows.
//
// One question every caller answers differently is what a missing (or
// unreadable) stamp means. The kernel names the two answers in use and each
// caller picks one; `stamps.test.ts` pins every caller's pick:
//   - "newer": anything beats an unknown held stamp, and an unknown incoming
//     stamp beats nothing known (Tasks' store and live layer, tags: a held row
//     without a stamp is replaced rather than kept).
//   - "oldest": an unknown stamp reads as the epoch (Chat: its rows always
//     carry one; a missing one never replaces a stamped row).

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

/** A stamp's microseconds, with `missing` standing in for one that can't be read. */
export function micros(ts: string | null | undefined, missing: number): number {
  return timestampMicros(ts) ?? missing;
}

/** What a missing or unreadable stamp means to a comparison (see the header). */
export type MissingStamp = "newer" | "oldest";

/** A server stamp moved back by `ms`, keeping its microseconds (a delta's lookback). */
export function stampMinus(stamp: string, ms: number): string {
  const at = timestampMicros(stamp);
  if (at === null) return stamp;
  const back = at - ms * 1000;
  const whole = Math.floor(back / 1000);
  const frac = String(((back % 1000) + 1000) % 1000).padStart(3, "0");
  // toISOString gives milliseconds; add the remaining microseconds.
  return new Date(whole).toISOString().replace(/Z$/, `${frac}+00:00`);
}

/**
 * Whether `incoming` is strictly newer than `held`.
 *  - "newer": a held stamp that can't be read loses to anything (two
 *    unknowns: newer); an unknown incoming stamp never beats a known one.
 *  - "oldest": an unknown stamp is the epoch: unknown never beats anything,
 *    and two unknowns are equal (not newer).
 */
export function isNewerStamp(
  incoming: string | null | undefined,
  held: string | null | undefined,
  missing: MissingStamp,
): boolean {
  if (missing === "oldest") return micros(incoming, 0) > micros(held, 0);
  const a = timestampMicros(incoming);
  const b = timestampMicros(held);
  if (a === null || b === null) return a !== null || b === null;
  return a > b;
}

/**
 * The later of two stamps (either may be absent: the other wins). Between two
 * present stamps, `missing` decides an unreadable one: "newer" takes `b`
 * when `b` is newer by `isNewerStamp`; "oldest" takes `b` only when it is
 * strictly later by the clock.
 */
export function laterOf(a: string | null, b: string | null, missing: MissingStamp): string | null {
  if (!a) return b;
  if (!b) return a;
  return isNewerStamp(b, a, missing) ? b : a;
}

// ── Each caller's pick, by its old name ─────────────────────────────────────

/** Tasks: `incoming` strictly newer than `local` (an unknown `local` loses to anything). */
export function isNewer(incoming: string | null | undefined, local: string | null | undefined) {
  return isNewerStamp(incoming, local, "newer");
}

/** Tasks: the newer of two cursors. */
export function newestOf(a: string | null, b: string | null): string | null {
  return laterOf(a, b, "newer");
}

/** Chat: the later of two stamps by the server's clock (null loses). */
export function laterStamp(a: string | null, b: string | null): string | null {
  return laterOf(a, b, "oldest");
}

/** Chat: whether `incoming` is a newer version than `held` (no held row: yes). */
export function isNewerRow(
  incoming: { updatedAt: string },
  held: { updatedAt: string } | undefined,
): boolean {
  if (!held) return true;
  return isNewerStamp(incoming.updatedAt, held.updatedAt, "oldest");
}
