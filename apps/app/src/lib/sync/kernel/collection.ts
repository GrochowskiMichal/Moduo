// One synced table (sync kernel, Track C): the rows the server sent with their
// delete marks (`landing.ts`), the writes shown over them (`overlay.ts`), a
// delta cursor (`delta.ts`) and what the device copy keeps of it.
//
// A store composes its collections with one outbox (`outbox.ts`: its order
// runs across tables) and one device-copy record per person and workspace
// (`registry.ts`). Tasks' store holds one collection per table it syncs.
// Chat keeps its own row windows (conversations paged by key) and uses the
// pieces directly; Notes syncs Yjs documents and uses none of this.

import type { Truncation } from "../../paged-select";
import { type DeltaPage, type DeltaRead, readDelta } from "./delta";
import { LandedRows, type LandingRow, type LandingRule } from "./landing";
import { OverlayStack, type RowOverlay, withOverlays } from "./overlay";
import type { MissingStamp } from "./stamps";

/** One read of a table: live rows, ids deleted since, the newest stamp read. */
export type CollectionRead<R> = {
  rows: R[];
  deleted: string[];
  maxUpdatedAt: string | null;
  truncated: Truncation | null;
  /** The source answered with every live row (it can't read changes). */
  whole?: boolean;
};

export type CollectionOptions<R> = {
  name: string;
  /** Read the table: live rows (`since` null) or changes since a stamp. */
  read?: (since: string | null) => Promise<CollectionRead<R>>;
  /** A delta starts this far before its cursor. */
  lagMs: number;
  /** A delta reads at most this many pages before it waits for the next one. */
  maxPages: number;
  /** Delete marks live this long. */
  goneTtlMs: number;
  /** How the cursor compares an unreadable stamp. */
  missing?: MissingStamp;
};

/** What the device copy keeps of a collection. */
export type CollectionCopy = { rows: unknown[]; cursor: string | null };

export class SyncedCollection<R extends LandingRow> {
  readonly name: string;
  readonly landed: LandedRows<R>;
  readonly overlays = new OverlayStack<RowOverlay<R>>();
  /** The newest server stamp a read of this table has seen ("": read, empty). */
  cursor: string | null = null;
  truncated: Truncation | null = null;
  private shown: R[] | null = null;

  constructor(private readonly opts: CollectionOptions<R>) {
    this.name = opts.name;
    this.landed = new LandedRows<R>({ goneTtlMs: opts.goneTtlMs });
  }

  get rows(): ReadonlyMap<string, R> {
    return this.landed.rows;
  }

  /** The rows as shown (overlays on top); the same array until something changes. */
  view(): R[] {
    this.shown ??= withOverlays(this.landed.rows, this.overlays.list());
    return this.shown;
  }

  /** Something changed the rows or their overlays: the next view is built afresh. */
  invalidate(): void {
    this.shown = null;
  }

  // ── Landing ───────────────────────────────────────────────────────────────

  applyRows(rows: readonly R[], rule: LandingRule, readStartedAt?: number): void {
    if (this.landed.applyRows(rows, rule, readStartedAt)) this.invalidate();
  }

  applyWhole(rows: readonly R[], startedAt: number, truncated: Truncation | null): void {
    this.landed.applyWhole(rows, startedAt, truncated === null);
    this.truncated = truncated;
    this.invalidate();
  }

  forget(ids: readonly string[], readStartedAt?: number): void {
    if (this.landed.forget(ids, readStartedAt)) this.invalidate();
  }

  replaceSlice(inSlice: (row: R) => boolean, rows: readonly R[]): void {
    this.landed.replaceSlice(inSlice, rows);
    this.invalidate();
  }

  patch(id: string, fields: Record<string, unknown>): boolean {
    const done = this.landed.patch(id, fields);
    if (done) this.invalidate();
    return done;
  }

  // ── Overlays ──────────────────────────────────────────────────────────────

  show(op: number, overlay: RowOverlay<R>): void {
    this.overlays.add(op, overlay);
    this.invalidate();
  }

  drop(op: number): void {
    if (this.overlays.drop(op).length > 0) this.invalidate();
  }

  // ── Reading the server ────────────────────────────────────────────────────

  private reader(): (since: string | null) => Promise<CollectionRead<R>> {
    if (!this.opts.read) throw new Error(`${this.name} has no reader.`);
    return this.opts.read;
  }

  /** Its live rows, whole (a first load, or a table without stamps). */
  async readWhole(startedAt: number): Promise<CollectionRead<R>> {
    const res = await this.reader()(null);
    this.applyWhole(res.rows, startedAt, res.truncated);
    return res;
  }

  /**
   * What changed since the cursor, from the lookback, page after page until
   * a page isn't cut at its ceiling. A source that can't read changes
   * answers whole. A table never read reads its live rows.
   */
  async readChanges(startedAt: number): Promise<DeltaRead | null> {
    this.landed.prune();
    if (!this.cursor) {
      // Never had a row: its live rows ("" keeps an empty table's place).
      const res = await this.readWhole(startedAt);
      this.cursor = res.maxUpdatedAt ?? this.cursor;
      return null;
    }
    const read = this.reader();
    return readDelta<CollectionRead<R>>({
      cursor: this.cursor,
      lagMs: this.opts.lagMs,
      maxPages: this.opts.maxPages,
      missing: this.opts.missing ?? "newer",
      // A delta past its ceiling reads on from where it stopped.
      page: async (since, prev) => {
        const res = await read(prev ? (prev.page.maxUpdatedAt as string) : since);
        return toPage(res);
      },
      land: (res) => {
        if (res.whole) {
          this.applyWhole(res.rows, startedAt, res.truncated);
          return;
        }
        this.applyRows(res.rows, "answer", startedAt);
        this.forget(res.deleted, startedAt);
      },
      advance: (cursor) => {
        this.cursor = cursor;
      },
    });
  }

  // ── The device copy ───────────────────────────────────────────────────────

  toCopy(): CollectionCopy {
    return { rows: [...this.landed.rows.values()], cursor: this.cursor };
  }

  /** Rows from the device copy (a live change that landed first is newer: it stays). */
  restore(copy: CollectionCopy): void {
    this.landed.restore(copy.rows);
    this.cursor ??= copy.cursor;
    this.invalidate();
  }
}

function toPage<R>(res: CollectionRead<R>): DeltaPage<CollectionRead<R>> {
  return {
    page: res,
    newest: res.maxUpdatedAt,
    // A whole answer has nothing after it; a cut one without a stamp can't go on.
    more: !res.whole && !!res.truncated && !!res.maxUpdatedAt,
  };
}

export function createSyncedCollection<R extends LandingRow>(
  opts: CollectionOptions<R>,
): SyncedCollection<R> {
  return new SyncedCollection<R>(opts);
}
