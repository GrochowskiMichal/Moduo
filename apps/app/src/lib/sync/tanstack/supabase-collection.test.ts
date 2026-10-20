// TS-2: the kernel as a TanStack DB collection, characterized like SK-C1's
// kernel suite: seed then delta, a Realtime event during the first read, an
// older event ignored, a soft delete, access loss, sign-out and a user switch,
// and the TS-3c hook (only the changed fields go; the server row lands).

import { describe, expect, it } from "@rstest/core";
import { createCollection } from "@tanstack/db";
import {
  type CollectionCopy,
  type CollectionRead,
  createSyncedCollection,
} from "../kernel/collection";
import {
  type ChangedFields,
  type LiveHandlers,
  supabaseCollectionOptions,
} from "./supabase-collection";

const at = (minute: number) => `2026-10-20T10:${String(minute).padStart(2, "0")}:00.000000+00:00`;
type Row = { id: string; updatedAt?: string; deletedAt?: string | null; v?: number };

const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const read = (rows: Row[], extra: Partial<CollectionRead<Row>> = {}): CollectionRead<Row> => ({
  rows,
  deleted: [],
  maxUpdatedAt: rows.reduce<string | null>(
    (m, r) => (r.updatedAt && (!m || r.updatedAt > m) ? r.updatedAt : m),
    null,
  ),
  truncated: null,
  ...extra,
});

/** One table over a fake server: reads wait on `answers`, Realtime on `live`. */
function harness(opts: {
  copy?: CollectionCopy | null;
  /** Each read's answer, in order (an Error rejects that read). */
  answers?: Array<Promise<CollectionRead<Row>> | Error>;
  sendChanges?: (c: ChangedFields[]) => Promise<Row[]>;
  isAccessLoss?: (e: unknown) => boolean;
}) {
  const reads: (string | null)[] = [];
  const answers = opts.answers ?? [Promise.resolve(read([]))];
  const kernel = createSyncedCollection<Row>({
    name: "t",
    read: (since) => {
      reads.push(since);
      const next = answers.shift() ?? Promise.resolve(read([]));
      return next instanceof Error ? Promise.reject(next) : next;
    },
    lagMs: 60_000,
    maxPages: 20,
    goneTtlMs: 60_000,
  });
  let live: LiveHandlers<Row> | null = null;
  const subscribed = deferred<void>();
  const events: string[] = [];
  let closed = false;
  let seedFails = false;
  let changes = 0;
  const options = supabaseCollectionOptions<Row>({
    id: `t-${Math.random()}`,
    kernel,
    seed: async () => {
      events.push("seed");
      if (seedFails) throw new Error("blocked by another tab");
      return opts.copy ?? null;
    },
    subscribe: (h) => {
      events.push("subscribe");
      live = h;
      return {
        ready: subscribed.promise,
        close: () => {
          closed = true;
        },
      };
    },
    isAccessLoss: opts.isAccessLoss,
    sendChanges: opts.sendChanges,
    onChange: () => {
      changes += 1;
    },
  });
  const collection = createCollection(options);
  return {
    collection,
    kernel,
    reads,
    events,
    subscribed,
    live: () => live as unknown as LiveHandlers<Row>,
    closed: () => closed,
    seedFails: () => {
      seedFails = true;
    },
    changes: () => changes,
    rows: () => [...collection.values()].map((r) => `${r.id}:${r.v ?? ""}`).sort(),
  };
}

describe("supabaseCollectionOptions", () => {
  it("opens Realtime before reading, paints the seed at once, then catches up by delta", async () => {
    const answer = deferred<CollectionRead<Row>>();
    const h = harness({
      copy: { rows: [{ id: "a", updatedAt: at(1), v: 1 }], cursor: at(1) },
      answers: [answer.promise],
    });
    h.collection.startSyncImmediate();
    await tick();
    expect(h.events).toEqual(["subscribe", "seed"]);
    // Ready from the device, before the network answers or Realtime subscribes.
    expect(h.collection.status).toBe("ready");
    expect(h.rows()).toEqual(["a:1"]);
    expect(h.reads).toEqual([]);

    h.subscribed.resolve();
    await tick();
    // A delta from the seed's cursor minus the lookback, not a whole read.
    expect(h.reads).toEqual([at(0)]);
    answer.resolve(
      read([
        { id: "a", updatedAt: at(2), v: 2 },
        { id: "b", updatedAt: at(2), v: 1 },
      ]),
    );
    await tick();
    expect(h.rows()).toEqual(["a:2", "b:1"]);
    expect(h.kernel.cursor).toBe(at(2));
    expect(h.changes()).toBeGreaterThan(0);
  });

  it("without a copy, reads live rows whole and is ready after the catch-up", async () => {
    const h = harness({ answers: [Promise.resolve(read([{ id: "a", updatedAt: at(1), v: 1 }]))] });
    h.collection.startSyncImmediate();
    await tick();
    expect(h.collection.status).toBe("loading");
    h.subscribed.resolve();
    await h.collection.toArrayWhenReady();
    expect(h.reads).toEqual([null]);
    expect(h.rows()).toEqual(["a:1"]);
  });

  it("buffers a Realtime event during the first read and flushes it, newest per id", async () => {
    const answer = deferred<CollectionRead<Row>>();
    const h = harness({ answers: [answer.promise] });
    h.collection.startSyncImmediate();
    h.subscribed.resolve();
    await tick();
    // Arrives while the read is in flight; the read's row for it is older.
    h.live().rows([
      { id: "a", updatedAt: at(3), v: 3 },
      { id: "a", updatedAt: at(2), v: 2 },
    ]);
    expect(h.rows()).toEqual([]);
    answer.resolve(read([{ id: "a", updatedAt: at(1), v: 1 }]));
    await h.collection.toArrayWhenReady();
    expect(h.rows()).toEqual(["a:3"]);
  });

  it("ignores an older or equal live event (an echo) and lands a newer one", async () => {
    const h = harness({ answers: [Promise.resolve(read([{ id: "a", updatedAt: at(2), v: 2 }]))] });
    h.collection.startSyncImmediate();
    h.subscribed.resolve();
    await h.collection.toArrayWhenReady();
    h.live().rows([{ id: "a", updatedAt: at(1), v: 1 }]);
    h.live().rows([{ id: "a", updatedAt: at(2), v: 9 }]);
    expect(h.rows()).toEqual(["a:2"]);
    h.live().rows([{ id: "a", updatedAt: at(3), v: 3 }]);
    expect(h.rows()).toEqual(["a:3"]);
  });

  it("a soft delete removes the row; an older version never brings it back, a restore does", async () => {
    const h = harness({ answers: [Promise.resolve(read([{ id: "a", updatedAt: at(1), v: 1 }]))] });
    h.collection.startSyncImmediate();
    h.subscribed.resolve();
    await h.collection.toArrayWhenReady();
    h.live().rows([{ id: "a", updatedAt: at(2), deletedAt: at(2) }]);
    expect(h.rows()).toEqual([]);
    h.live().rows([{ id: "a", updatedAt: at(1), v: 1 }]);
    expect(h.rows()).toEqual([]);
    h.live().rows([{ id: "a", updatedAt: at(3), v: 3, deletedAt: null }]);
    expect(h.rows()).toEqual(["a:3"]);
    h.live().deleted(["a"]);
    expect(h.rows()).toEqual([]);
  });

  it("access loss truncates every row, from the kernel too", async () => {
    const denied = Object.assign(new Error("denied"), { code: "42501" });
    const h = harness({
      copy: { rows: [{ id: "a", updatedAt: at(1), v: 1 }], cursor: at(1) },
      answers: [denied],
      isAccessLoss: (e) => (e as { code?: string }).code === "42501",
    });
    h.collection.startSyncImmediate();
    await tick();
    expect(h.rows()).toEqual(["a:1"]);
    h.subscribed.resolve();
    await tick();
    await tick();
    expect(h.rows()).toEqual([]);
    expect(h.kernel.rows.size).toBe(0);

    // And on demand (a workspace left mid-session).
    h.live().rows([{ id: "b", updatedAt: at(2), v: 1 }]);
    h.collection.utils.loseAccess();
    expect(h.rows()).toEqual([]);
  });

  it("sign-out stops it: Realtime closes and a late read or event writes nothing", async () => {
    const answer = deferred<CollectionRead<Row>>();
    const h = harness({
      copy: { rows: [{ id: "a", updatedAt: at(1), v: 1 }], cursor: at(1) },
      answers: [answer.promise],
    });
    h.collection.startSyncImmediate();
    h.subscribed.resolve();
    await tick();
    const live = h.live();
    await h.collection.cleanup();
    expect(h.closed()).toBe(true);
    answer.resolve(read([{ id: "b", updatedAt: at(2), v: 1 }]));
    live.rows([{ id: "c", updatedAt: at(3), v: 1 }]);
    await tick();
    expect(h.collection.size).toBe(0);
  });

  it("a user switch: the first person's late read never reaches the next person's collection", async () => {
    const annRead = deferred<CollectionRead<Row>>();
    const ann = harness({
      copy: { rows: [{ id: "ann-row", updatedAt: at(1) }], cursor: at(1) },
      answers: [annRead.promise],
    });
    ann.collection.startSyncImmediate();
    ann.subscribed.resolve();
    await tick();
    await ann.collection.cleanup();
    const bob = harness({ copy: { rows: [{ id: "bob-row", updatedAt: at(1) }], cursor: at(1) } });
    bob.collection.startSyncImmediate();
    annRead.resolve(read([{ id: "ann-new", updatedAt: at(2) }]));
    await tick();
    expect(bob.rows()).toEqual(["bob-row:"]);
    expect(ann.collection.size).toBe(0);
  });

  it("a device copy that can't be read falls back to the server", async () => {
    const h = harness({ answers: [Promise.resolve(read([{ id: "a", updatedAt: at(1), v: 1 }]))] });
    h.seedFails();
    h.collection.startSyncImmediate();
    h.subscribed.resolve();
    await h.collection.toArrayWhenReady();
    expect(h.reads).toEqual([null]);
    expect(h.rows()).toEqual(["a:1"]);
  });

  it("a failed catch-up after the seed keeps live events landing, and catchUp retries", async () => {
    const h = harness({
      copy: { rows: [{ id: "a", updatedAt: at(1), v: 1 }], cursor: at(1) },
      answers: [new Error("offline"), Promise.resolve(read([{ id: "b", updatedAt: at(4), v: 1 }]))],
    });
    h.collection.startSyncImmediate();
    h.subscribed.resolve();
    await tick();
    await tick();
    h.live().rows([{ id: "a", updatedAt: at(5), v: 5 }]);
    expect(h.rows()).toEqual(["a:5"]);
    await h.collection.utils.catchUp();
    expect(h.rows()).toEqual(["a:5", "b:1"]);
  });

  it("a hard delete buffered during the first read lands after it", async () => {
    const answer = deferred<CollectionRead<Row>>();
    const h = harness({ answers: [answer.promise] });
    h.collection.startSyncImmediate();
    h.subscribed.resolve();
    await tick();
    h.live().deleted(["a"]);
    answer.resolve(
      read([
        { id: "a", updatedAt: at(1), v: 1 },
        { id: "b", updatedAt: at(1) },
      ]),
    );
    await h.collection.toArrayWhenReady();
    expect(h.rows()).toEqual(["b:"]);
  });

  it("losing access mid-read: the read can't bring rows back, and the cursor resets", async () => {
    const answer = deferred<CollectionRead<Row>>();
    const h = harness({
      copy: { rows: [{ id: "a", updatedAt: at(1), v: 1 }], cursor: at(1) },
      answers: [answer.promise],
    });
    h.collection.startSyncImmediate();
    h.subscribed.resolve();
    await tick();
    h.collection.utils.loseAccess();
    answer.resolve(
      read([
        { id: "a", updatedAt: at(1), v: 1 },
        { id: "new", updatedAt: at(2) },
      ]),
    );
    await tick();
    await tick();
    expect(h.rows()).toEqual([]);
    expect(h.kernel.rows.size).toBe(0);
    expect(h.kernel.cursor).toBeNull();
  });

  it("an answer without the row keeps the edit until the echo", async () => {
    const h = harness({
      answers: [Promise.resolve(read([{ id: "a", updatedAt: at(1), v: 1 }]))],
      sendChanges: async () => [],
    });
    h.collection.startSyncImmediate();
    h.subscribed.resolve();
    await h.collection.toArrayWhenReady();
    const tx = h.collection.update("a", (d) => {
      d.v = 7;
    });
    await tx.isPersisted.promise;
    expect(h.rows()).toEqual(["a:7"]);
    h.live().rows([{ id: "a", updatedAt: at(2), v: 7 }]);
    expect(h.kernel.rows.get("a")?.updatedAt).toBe(at(2));
  });

  it("TS-3c hook: an update sends only the changed fields and lands the server row", async () => {
    const sent: ChangedFields[][] = [];
    const h = harness({
      answers: [Promise.resolve(read([{ id: "a", updatedAt: at(1), v: 1 }]))],
      sendChanges: async (c) => {
        sent.push(c);
        return [{ id: "a", updatedAt: at(2), v: 5 }];
      },
    });
    h.collection.startSyncImmediate();
    h.subscribed.resolve();
    await h.collection.toArrayWhenReady();
    const tx = h.collection.update("a", (d) => {
      d.v = 5;
    });
    expect(h.rows()).toEqual(["a:5"]);
    await tx.isPersisted.promise;
    expect(sent).toEqual([[{ id: "a", changes: { v: 5 } }]]);
    expect(h.kernel.rows.get("a")?.updatedAt).toBe(at(2));
    expect(h.rows()).toEqual(["a:5"]);
  });
});
