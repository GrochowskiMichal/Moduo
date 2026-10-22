// Reading only what changed (sync kernel, Track C). One delta read for Tasks'
// tables and Chat's messages, and the keyset filter the runtime's readers page
// with (docs/gotchas/supabase.md, "A delta read by `updated_at` loses rows
// unless it pages by key and starts early"):
//
//   - **Starts early.** A save stamped T1 can commit after a read at T2, so a
//     read starts `lagMs` before its cursor (`stampMinus`): rows already held
//     come again and land only if newer.
//   - **Pages by key.** Offset pages shift when a row of an earlier page is
//     saved mid-read, so pages continue after the last (stamp, id) read.
//   - **Moves the cursor only over what was read**, page by page: a read that
//     fails half-way starts the next one where this one got to.
//   - **Stops at a page cap** and says so (`capped`): the caller decides what
//     a read that couldn't reach the end means (Chat re-reads its open
//     window; Tasks reads on next time).

import { laterOf, micros, type MissingStamp, stampMinus, timestampMicros } from "./stamps";

/** One page of a delta. */
export type DeltaPage<P> = {
  page: P;
  /** The newest stamp the page read (null: none). */
  newest: string | null;
  /** The page stopped at its size: there is more after it. */
  more: boolean;
};

export type DeltaRead = {
  /** Where the next delta starts. */
  cursor: string;
  /** It stopped at `maxPages` with more to read. */
  capped: boolean;
  /** A page failed (`page` answered null); the cursor holds what came before it. */
  failed: boolean;
};

/**
 * Read changes since `cursor` (minus the lookback), page by page.
 *  - `page(since, prev)`: read one page: the first from `since`, later ones on
 *    from `prev` (keyset, or a new `since`, as the source pages). Null: the
 *    read failed and the delta stops.
 *  - `land(page)`: apply it.
 *  - `advance(cursor)`: the cursor moved (after each page).
 *  - `missing`: how the cursor compares an unreadable stamp (stamps.ts).
 */
export async function readDelta<P>(opts: {
  cursor: string;
  lagMs: number;
  maxPages: number;
  missing: MissingStamp;
  page: (since: string, prev: DeltaPage<P> | null) => Promise<DeltaPage<P> | null>;
  land: (page: P) => void;
  advance?: (cursor: string) => void;
}): Promise<DeltaRead> {
  const since = stampMinus(opts.cursor, opts.lagMs);
  let cursor = opts.cursor;
  let prev: DeltaPage<P> | null = null;
  for (let n = 1; n <= opts.maxPages; n += 1) {
    const read: DeltaPage<P> | null = await opts.page(since, prev);
    if (!read) return { cursor, capped: false, failed: true };
    opts.land(read.page);
    cursor = laterOf(cursor, read.newest, opts.missing) ?? cursor;
    opts.advance?.(cursor);
    if (!read.more) return { cursor, capped: false, failed: false };
    prev = read;
  }
  return { cursor, capped: true, failed: false };
}

/** The lookback a delta starts from. */
export function deltaSince(cursor: string, lagMs: number): string {
  return stampMinus(cursor, lagMs);
}

/** A value PostgREST reads whole inside `or=(…)` (timestamps carry `:` and `+`). */
export function pgrstQuoted(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * The keyset filter for the page after `last` in (`stamp`, `key`) order, as
 * PostgREST's `or=(…)`: `stamp > T, or stamp = T and key > id`. Timestamps
 * are double-quoted (they carry `:` and `+`).
 */
export function keysetAfter(
  stampColumn: string,
  keyColumn: string,
  last: { stamp: string; key: string },
): string {
  const at = pgrstQuoted(last.stamp);
  return `${stampColumn}.gt.${at},and(${stampColumn}.eq.${at},${keyColumn}.gt.${last.key})`;
}

/**
 * The newest readable stamp among rows (by `stampOf`), as the server spelled
 * it: a delta's `maxUpdatedAt`. Rows without a readable stamp don't count.
 */
export function newestStamp<R>(
  rows: readonly R[],
  stampOf: (row: R) => string | null | undefined,
): string | null {
  let newest: string | null = null;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const stamp = stampOf(row);
    if (typeof stamp !== "string" || !stamp) continue;
    const at = timestampMicros(stamp);
    if (at !== null && at > max) {
      max = at;
      newest = stamp;
    }
  }
  return newest;
}

// ── Two streams, one cursor (TV-D11b) ───────────────────────────────────────
//
// Where the next delta read of a hard-delete table starts. Its changes come in
// two streams, each in stamp order: rows stamped since the cursor, and the
// tombstones of rows deleted since. A stream cut at its ceiling stops at its
// last stamp; the next read must start there (the earlier of the two when both
// were cut), or whatever lies between that stamp and the other stream's end is
// never read.

/** An unreadable stamp sorts first: it never wins the cursor. */
const floor = (stamp: string) => micros(stamp, Number.NEGATIVE_INFINITY);

type Stream = {
  /** The stream's stamps, in the order it was read (ascending). */
  stamps: readonly (string | null | undefined)[];
  /** The read stopped at its ceiling. */
  cut: boolean;
};

/** The cursor after reading both streams (null when neither had a stamp). */
export function deltaCursor(rows: Stream, graves: Stream): string | null {
  const last = (s: Stream) => {
    for (let i = s.stamps.length - 1; i >= 0; i -= 1) {
      const v = s.stamps[i];
      if (typeof v === "string" && v) return v;
    }
    return null;
  };
  const cuts = [rows, graves]
    .filter((s) => s.cut)
    .map(last)
    .filter((v): v is string => v !== null);
  if (cuts.length > 0) return cuts.reduce((a, b) => (floor(b) < floor(a) ? b : a));
  let newest: string | null = null;
  for (const v of [...rows.stamps, ...graves.stamps]) {
    if (typeof v !== "string" || !v) continue;
    if (newest === null || floor(v) > floor(newest)) newest = v;
  }
  return newest;
}
