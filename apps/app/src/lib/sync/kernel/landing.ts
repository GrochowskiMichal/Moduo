// Which server row wins (sync kernel, Track C). Every row a store gets (a
// read, an op's answer, a Realtime event) goes through one rule
// (docs/gotchas/supabase.md, "An op's answer can be older than the row the
// store already holds"):
//
//   - **"answer"** (a read or an op's answer): lands unless the held copy is
//     strictly newer. A teammate's Realtime row may have landed first.
//   - **"live"** (Realtime): lands only if strictly newer. An equal stamp is
//     your own echo and changes nothing.
//
// And a delete leaves marks (gotcha "A delete must leave a mark, or a read
// already on its way brings the row back"): the deleted row's stamp (an older
// version never lands, a restore does) and when it went (a read that began
// earlier skips it). Marks live `goneTtlMs`.

import { isNewerStamp, type MissingStamp } from "./stamps";

export type LandingRule = "answer" | "live";

/**
 * Whether a row stamped `incoming` replaces one stamped `held`. A side
 * without a stamp at all (`undefined`) isn't compared: it lands.
 */
export function lands(
  rule: LandingRule,
  incoming: string | undefined,
  held: string | undefined,
  missing: MissingStamp = "newer",
): boolean {
  if (incoming === undefined || held === undefined) return true;
  return rule === "live"
    ? isNewerStamp(incoming, held, missing)
    : !isNewerStamp(held, incoming, missing);
}

/** A row as landing sees it: an id, maybe a stamp and a soft-delete stamp. */
export type LandingRow = { id: string; updatedAt?: string; deletedAt?: string | null };

/**
 * One table's held rows with their delete marks. `applyRows`, `applyWhole`
 * and `forget` are the only ways in and out of `rows`; each says whether
 * anything changed.
 */
export class LandedRows<R extends LandingRow = LandingRow> {
  readonly rows = new Map<string, R>();
  /** When each row was last applied (local ms): a whole read that started
   *  earlier can't drop it (it may have been created after the read began). */
  readonly seenAt = new Map<string, number>();
  /** Ids removed (any delete), with when: a read that started earlier can't bring them back. */
  readonly goneAt = new Map<string, number>();
  /** Soft-deleted rows' server stamps: an older version of the row (a late
   *  echo, a read in flight) never brings it back; a restore is newer. */
  readonly tombstones = new Map<string, { stamp: string; at: number }>();

  constructor(private readonly opts: { goneTtlMs: number; now?: () => number }) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /**
   * Rows from a read, an answer or Realtime: each lands by `rule`; a
   * soft-deleted one removes the held row and leaves its marks.
   * `readStartedAt`: they come from a read that began then; a row removed
   * since (a delete it couldn't know about) stays removed.
   */
  applyRows(rows: readonly R[], rule: LandingRule, readStartedAt?: number): boolean {
    const now = this.now();
    let touched = false;
    for (const row of rows) {
      if (!row || typeof row.id !== "string") continue;
      if (readStartedAt !== undefined && (this.goneAt.get(row.id) ?? -1) >= readStartedAt) continue;
      const tomb = this.tombstones.get(row.id);
      if (tomb && row.updatedAt !== undefined && !lands("live", row.updatedAt, tomb.stamp)) {
        continue;
      }
      const held = this.rows.get(row.id);
      if (held && !lands(rule, row.updatedAt, held.updatedAt)) continue;
      if (row.deletedAt) {
        if (this.rows.delete(row.id)) touched = true;
        this.seenAt.delete(row.id);
        this.goneAt.set(row.id, now);
        if (row.updatedAt) this.tombstones.set(row.id, { stamp: row.updatedAt, at: now });
        continue;
      }
      this.rows.set(row.id, row);
      this.seenAt.set(row.id, now);
      this.goneAt.delete(row.id);
      this.tombstones.delete(row.id);
      touched = true;
    }
    return touched;
  }

  /**
   * A whole read: what it has lands; what it lacks goes, unless it arrived
   * after the read began. A read cut at its ceiling (`complete` false) can't
   * tell absent from not-reached, so it drops nothing.
   */
  applyWhole(rows: readonly R[], startedAt: number, complete: boolean): void {
    this.prune();
    const fresh = rows.filter((r) => (this.goneAt.get(r.id) ?? -1) < startedAt);
    this.applyRows(fresh, "answer", startedAt);
    if (!complete) return;
    const present = new Set(rows.map((r) => r.id));
    for (const id of [...this.rows.keys()]) {
      if (present.has(id)) continue;
      if ((this.seenAt.get(id) ?? 0) >= startedAt) continue;
      this.rows.delete(id);
      this.seenAt.delete(id);
    }
  }

  /**
   * Remove rows the server says are gone. `readStartedAt`: they come from a
   * read that began then, so a row applied since (restored meanwhile) stays.
   */
  forget(ids: readonly string[], readStartedAt?: number): boolean {
    if (ids.length === 0) return false;
    const now = this.now();
    for (const id of ids) {
      if (readStartedAt !== undefined && (this.seenAt.get(id) ?? 0) >= readStartedAt) continue;
      this.rows.delete(id);
      this.seenAt.delete(id);
      this.goneAt.set(id, now);
    }
    return true;
  }

  /**
   * The server's answer is the whole of one slice (`inSlice`): held rows of
   * the slice it lacks go (and stay gone from reads already on their way),
   * its rows land as they are. Tasks: a queue op answers with my whole line-up.
   */
  replaceSlice(inSlice: (row: R) => boolean, rows: readonly R[]): void {
    const now = this.now();
    const kept = new Set(rows.map((r) => r.id));
    for (const [id, row] of this.rows) {
      if (!inSlice(row)) continue;
      this.rows.delete(id);
      this.seenAt.delete(id);
      if (!kept.has(id)) this.goneAt.set(id, now);
    }
    for (const row of rows) {
      this.rows.set(row.id, row);
      this.seenAt.set(row.id, now);
      this.goneAt.delete(row.id);
    }
  }

  /**
   * Change fields of a held row, keeping its stamp: what an op's answer told
   * without sending the row. The server's next row for it still replaces it.
   */
  patch(id: string, fields: Record<string, unknown>): boolean {
    const row = this.rows.get(id);
    if (!row) return false;
    this.rows.set(id, { ...row, ...fields } as R);
    return true;
  }

  /** Rows read from the device: each lands unless something newer is held already. */
  restore(rows: readonly unknown[]): void {
    for (const row of rows as R[]) {
      if (row && typeof row.id === "string" && !this.rows.has(row.id)) this.rows.set(row.id, row);
    }
  }

  /** Drop marks older than `goneTtlMs`. */
  prune(): void {
    const cutoff = this.now() - this.opts.goneTtlMs;
    for (const [id, at] of this.goneAt) if (at < cutoff) this.goneAt.delete(id);
    for (const [id, tomb] of this.tombstones) if (tomb.at < cutoff) this.tombstones.delete(id);
  }
}
