// Where the next delta read of a hard-delete table starts (TV-D11b). Its
// changes come in two streams, each in stamp order: rows stamped since the
// cursor, and the tombstones of rows deleted since. A stream cut at its
// ceiling stops at its last stamp; the next read must start there (the
// earlier of the two when both were cut), or whatever lies between that
// stamp and the other stream's end is never read (the keyset trap of
// docs/gotchas/supabase.md, "A delta read by `updated_at` loses rows…").

import { timestampMicros } from "../../features/tasks/live";

type Stream = {
  /** The stream's stamps, in the order it was read (ascending). */
  stamps: readonly (string | null | undefined)[];
  /** The read stopped at its ceiling. */
  cut: boolean;
};

const micros = (stamp: string) => timestampMicros(stamp) ?? Number.NEGATIVE_INFINITY;

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
  if (cuts.length > 0) return cuts.reduce((a, b) => (micros(b) < micros(a) ? b : a));
  let newest: string | null = null;
  for (const v of [...rows.stamps, ...graves.stamps]) {
    if (typeof v !== "string" || !v) continue;
    if (newest === null || micros(v) > micros(newest)) newest = v;
  }
  return newest;
}
