// Writes shown before the server has them (sync kernel, Track C). A write is
// an op with an id; its changes lie over the server's rows until its answer
// comes back. The answer lands as a row (by `landing.ts`'s "answer" rule) and
// the op's overlays go; a refusal takes only that op's overlays away, so one
// field rolls back to what the server holds and nothing reloads. A Realtime
// echo of the write is a server row like any other: it lands under the
// overlay (stamp rule) and the overlay stays on top until the answer.

let lastOp = 0;

/** A fresh op id, unique for the page's life (never persisted). */
export function nextOp(): number {
  lastOp += 1;
  return lastOp;
}

/** Overlays keyed by the op that made them, in the order they were added. */
export class OverlayStack<O> {
  private items: { op: number; item: O }[] = [];

  add(op: number, item: O): void {
    this.items.push({ op, item });
  }

  /** Take every overlay of `op` away; returns what went. */
  drop(op: number): O[] {
    const gone: O[] = [];
    this.items = this.items.filter((o) => {
      if (o.op !== op) return true;
      gone.push(o.item);
      return false;
    });
    return gone;
  }

  /** Every overlay, oldest first. */
  list(): O[] {
    return this.items.map((o) => o.item);
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

/** A change shown over one row table: a field patch, a new row, a removal. */
export type RowOverlay<R extends { id: string }> =
  | { patch: { id: string; fields: Record<string, unknown> } }
  | { insert: R }
  | { remove: string };

/**
 * The rows as shown: `rows` with `overlays` laid over in order. A new row
 * shown under `tmp-<id>` (Tasks' "still saving") goes once its own row `<id>`
 * is held: a Realtime insert can come before the answer, and it shows once.
 */
export function withOverlays<R extends { id: string }>(
  rows: ReadonlyMap<string, R>,
  overlays: readonly RowOverlay<R>[],
): R[] {
  if (overlays.length === 0) return [...rows.values()];
  const map = new Map(rows);
  for (const o of overlays) {
    if ("insert" in o) {
      const real = o.insert.id.startsWith("tmp-") ? o.insert.id.slice(4) : null;
      if (real && map.has(real)) continue;
      map.set(o.insert.id, o.insert);
    } else if ("remove" in o) map.delete(o.remove);
    else {
      const row = map.get(o.patch.id);
      if (row) map.set(o.patch.id, { ...row, ...o.patch.fields } as R);
    }
  }
  return [...map.values()];
}

/** A write on its way: show more under it, then settle or fail it, once. */
export type OpenWrite<A> = {
  readonly op: number;
  add(changes: readonly unknown[]): void;
  settle(answers?: A): void;
  fail(): void;
};

/**
 * One write's life: `show` lays changes over the rows, `settled` lands the
 * answer (and drops the op's overlays), `failed` drops them. After the first
 * settle or fail, nothing more happens.
 */
export function openWrite<C, A>(hooks: {
  show(op: number, changes: readonly C[]): void;
  settled(op: number, answers: A | undefined): void;
  failed(op: number): void;
}): OpenWrite<A> & { add(changes: readonly C[]): void } {
  const op = nextOp();
  let open = true;
  return {
    op,
    add(changes: readonly C[]) {
      if (!open || changes.length === 0) return;
      hooks.show(op, changes);
    },
    settle(answers?: A) {
      if (!open) return;
      open = false;
      hooks.settled(op, answers);
    },
    fail() {
      if (!open) return;
      open = false;
      hooks.failed(op);
    },
  };
}
