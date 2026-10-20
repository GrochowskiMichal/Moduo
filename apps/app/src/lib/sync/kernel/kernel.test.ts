// The sync kernel's pieces on their own (Track C1): landing and delete marks,
// overlays, the delta loop and its keyset filter, the outbox's two policies
// and cross-tab rules, and the person lifecycle (a null session is not a
// sign-out). The stores' own suites test them composed.

import { describe, expect, it } from "@rstest/core";

import { createSyncedCollection } from "./collection";
import { keysetAfter, newestStamp, readDelta } from "./delta";
import { LandedRows, lands } from "./landing";
import { Backoff, drainOutbox, Outbox } from "./outbox";
import { openWrite, withOverlays } from "./overlay";
import {
  type OwnedCopies,
  personLifecycle,
  refcount,
  StoreRegistry,
  waitingEverywhere,
} from "./registry";

const at = (minute: number) => `2026-10-20T10:${String(minute).padStart(2, "0")}:00.000000+00:00`;
type Row = { id: string; updatedAt?: string; deletedAt?: string | null; v?: number };

describe("landing", () => {
  it("an answer lands unless the held copy is strictly newer; live only when strictly newer", () => {
    expect(lands("answer", at(1), at(1))).toBe(true);
    expect(lands("answer", at(1), at(2))).toBe(false);
    expect(lands("live", at(1), at(1))).toBe(false);
    expect(lands("live", at(2), at(1))).toBe(true);
    // A side with no stamp at all isn't compared.
    expect(lands("live", undefined, at(1))).toBe(true);
    expect(lands("answer", at(1), undefined)).toBe(true);
    // Chat's rule: an unreadable stamp is the epoch.
    expect(lands("live", "?", at(1), "oldest")).toBe(false);
  });

  it("a soft delete leaves a tombstone: an older version never lands, a restore does", () => {
    const t = new LandedRows<Row>({ goneTtlMs: 60_000 });
    t.applyRows([{ id: "a", updatedAt: at(1) }], "answer");
    t.applyRows([{ id: "a", updatedAt: at(3), deletedAt: at(3) }], "live");
    expect(t.rows.has("a")).toBe(false);
    t.applyRows([{ id: "a", updatedAt: at(2) }], "answer");
    expect(t.rows.has("a")).toBe(false);
    t.applyRows([{ id: "a", updatedAt: at(4) }], "answer");
    expect(t.rows.has("a")).toBe(true);
  });

  it("a read that began before a delete can't bring the row back", () => {
    let now = 1000;
    const t = new LandedRows<Row>({ goneTtlMs: 60_000, now: () => now });
    t.applyRows([{ id: "a", updatedAt: at(1) }], "answer");
    const readStarted = now;
    now = 2000;
    t.forget(["a"]);
    t.applyRows([{ id: "a", updatedAt: at(1) }], "answer", readStarted);
    expect(t.rows.has("a")).toBe(false);
    // A read that began after it does.
    t.applyRows([{ id: "a", updatedAt: at(1) }], "answer", 3000);
    expect(t.rows.has("a")).toBe(true);
  });

  it("a whole read drops what it lacks, except rows that landed after it began or a cut read", () => {
    let now = 1000;
    const t = new LandedRows<Row>({ goneTtlMs: 60_000, now: () => now });
    t.applyRows([{ id: "old" }, { id: "kept" }], "answer");
    now = 2000;
    const started = now;
    now = 3000;
    t.applyRows([{ id: "late" }], "live");
    t.applyWhole([{ id: "kept" }], started, false);
    expect([...t.rows.keys()].sort()).toEqual(["kept", "late", "old"]);
    t.applyWhole([{ id: "kept" }], started, true);
    expect([...t.rows.keys()].sort()).toEqual(["kept", "late"]);
  });

  it("marks expire after goneTtlMs", () => {
    let now = 0;
    const t = new LandedRows<Row>({ goneTtlMs: 100, now: () => now });
    t.forget(["a"]);
    now = 50;
    t.prune();
    expect(t.goneAt.has("a")).toBe(true);
    now = 200;
    t.prune();
    expect(t.goneAt.has("a")).toBe(false);
  });

  it("replaceSlice makes the answer the whole slice and keeps the rest", () => {
    const t = new LandedRows<Row & { mine?: boolean }>({ goneTtlMs: 60_000 });
    t.applyRows([{ id: "a", mine: true }, { id: "b", mine: true }, { id: "c" }], "answer");
    t.replaceSlice((r) => !!r.mine, [{ id: "b", mine: true, v: 2 }]);
    expect([...t.rows.keys()].sort()).toEqual(["b", "c"]);
    expect(t.goneAt.has("a")).toBe(true);
    expect(t.goneAt.has("b")).toBe(false);
  });
});

describe("overlays", () => {
  it("patches, inserts and removes in order; a tmp- insert hides once its row is held", () => {
    const rows = new Map<string, Row>([
      ["a", { id: "a", v: 1 }],
      ["x", { id: "x" }],
    ]);
    const shown = withOverlays(rows, [
      { patch: { id: "a", fields: { v: 2 } } },
      { insert: { id: "tmp-x", v: 9 } },
      { insert: { id: "tmp-y", v: 9 } },
      { remove: "nope" },
    ]);
    expect(shown).toEqual([{ id: "a", v: 2 }, { id: "x" }, { id: "tmp-y", v: 9 }]);
  });

  it("a write settles or fails once", () => {
    const calls: string[] = [];
    const w = openWrite<number, string>({
      show: (_op, c) => calls.push(`show ${c.join(",")}`),
      settled: (_op, a) => calls.push(`settled ${a}`),
      failed: () => calls.push("failed"),
    });
    w.add([1, 2]);
    w.settle("ans");
    w.fail();
    w.add([3]);
    expect(calls).toEqual(["show 1,2", "settled ans"]);
  });
});

describe("readDelta", () => {
  it("starts from the lookback, pages on, and moves the cursor after each page", async () => {
    const asked: string[] = [];
    const cursors: string[] = [];
    const pages = [
      { newest: at(5), more: true },
      { newest: at(7), more: false },
    ];
    const res = await readDelta({
      cursor: at(10),
      lagMs: 5 * 60_000,
      maxPages: 20,
      missing: "newer",
      page: async (since, prev) => {
        asked.push(prev ? `after ${prev.newest}` : `since ${since}`);
        const p = pages.shift()!;
        return { page: p, ...p };
      },
      land: () => {},
      advance: (c) => cursors.push(c),
    });
    expect(asked).toEqual([`since ${at(5)}`, `after ${at(5)}`]);
    // The lookback re-reads older rows: the cursor never moves back.
    expect(cursors).toEqual([at(10), at(10)]);
    expect(res).toEqual({ cursor: at(10), capped: false, failed: false });
  });

  it("says when it stopped at the page cap, and when a page failed", async () => {
    let n = 0;
    const capped = await readDelta({
      cursor: at(0),
      lagMs: 0,
      maxPages: 3,
      missing: "oldest",
      page: async () => {
        n += 1;
        return { page: n, newest: at(n), more: true };
      },
      land: () => {},
    });
    expect(capped).toEqual({ cursor: at(3), capped: true, failed: false });
    const failed = await readDelta({
      cursor: at(0),
      lagMs: 0,
      maxPages: 3,
      missing: "oldest",
      page: async (_s, prev) => (prev ? null : { page: 1, newest: at(1), more: true }),
      land: () => {},
    });
    expect(failed).toEqual({ cursor: at(1), capped: false, failed: true });
  });

  it("builds the keyset filter with quoted stamps, and finds the newest stamp", () => {
    expect(keysetAfter("updated_at", "id", { stamp: at(1), key: "k" })).toBe(
      `updated_at.gt."${at(1)}",and(updated_at.eq."${at(1)}",id.gt.k)`,
    );
    expect(
      newestStamp(
        [{ s: at(2) }, { s: null }, { s: "2026-10-20 10:03:00+00" }, { s: "x" }],
        (r) => r.s,
      ),
    ).toBe("2026-10-20 10:03:00+00");
  });
});

describe("a synced collection", () => {
  it("reads live rows first, then changes from the lookback; a whole answer replaces", async () => {
    const reads: (string | null)[] = [];
    let answer = {
      rows: [{ id: "a", updatedAt: at(1) }] as Row[],
      deleted: [] as string[],
      maxUpdatedAt: at(1) as string | null,
      truncated: null,
      whole: false,
    };
    const c = createSyncedCollection<Row>({
      name: "t",
      read: async (since) => {
        reads.push(since);
        return answer;
      },
      lagMs: 60_000,
      maxPages: 20,
      goneTtlMs: 60_000,
    });
    await c.readChanges(Date.now());
    expect(c.cursor).toBe(at(1));
    answer = {
      ...answer,
      rows: [{ id: "b", updatedAt: at(2) }],
      deleted: ["a"],
      maxUpdatedAt: at(2),
    };
    await c.readChanges(Date.now() + 1);
    expect(reads).toEqual([null, at(0)]);
    expect(c.view().map((r) => r.id)).toEqual(["b"]);
    expect(c.cursor).toBe(at(2));
    const before = c.view();
    expect(c.view()).toBe(before);
    c.show(1, { patch: { id: "b", fields: { v: 3 } } });
    expect(c.view()).not.toBe(before);
    expect(c.view()[0]?.v).toBe(3);
    c.drop(1);
    expect(c.view()[0]?.v).toBeUndefined();
  });
});

describe("the outbox", () => {
  type E = { id: string; failed?: string };

  it("FIFO drops a refusal and sends on; a lost network stops at the head", async () => {
    const ob = new Outbox<E>("fifo-drop-on-refusal");
    for (const id of ["a", "b", "c"]) ob.push({ id });
    const log: string[] = [];
    await drainOutbox(ob, {
      running: () => true,
      send: async (e) =>
        e.id === "a"
          ? { ok: false, error: new Error("no") }
          : e.id === "c"
            ? { ok: false, error: new Error("Failed to fetch") }
            : { ok: true, value: e.id },
      isNetwork: (e) => /fetch/.test(String(e)),
      sent: (e) => log.push(`sent ${e.id}`),
      refused: (e) => log.push(`refused ${e.id}`),
      offline: (e) => log.push(`offline ${e.id}`),
    });
    expect(log).toEqual(["refused a", "sent b", "offline c"]);
    expect(ob.list().map((e) => e.id)).toEqual(["c"]);
    expect(ob.isHandled("a")).toBe(true);
  });

  it("hold keeps a refused entry for Retry and sends the next", async () => {
    const ob = new Outbox<E>("hold-failed-for-retry", (e) => !!e.failed);
    for (const id of ["a", "b"]) ob.push({ id });
    const log: string[] = [];
    await drainOutbox(ob, {
      running: () => true,
      send: async (e) => (e.id === "a" ? { ok: false, error: "no" } : { ok: true, value: 1 }),
      isNetwork: () => false,
      sent: (e) => log.push(`sent ${e.id}`),
      refused: (e) => {
        e.failed = "no";
        log.push(`refused ${e.id}`);
      },
      offline: () => {},
    });
    expect(log).toEqual(["refused a", "sent b"]);
    expect(ob.list()).toEqual([{ id: "a", failed: "no" }]);
  });

  it("merges another tab's waiting entries and never brings back what this tab handled", () => {
    const ob = new Outbox<E>("fifo-drop-on-refusal");
    ob.push({ id: "mine" });
    ob.push({ id: "sent" });
    ob.remove("sent");
    const stored = [{ id: "theirs" }, { id: "sent" }, { id: "mine" }, null];
    expect(ob.merged(stored).map((e) => e.id)).toEqual(["mine", "theirs"]);
    expect(ob.adopt(stored).map((e) => e.id)).toEqual(["theirs"]);
    expect(ob.isAdopted("theirs")).toBe(true);
    // Another tab sent "theirs": it left the stored outbox.
    expect(ob.goneElsewhere([{ id: "mine" }])).toEqual(["theirs"]);
    expect(ob.goneElsewhere([{ id: "mine" }], "theirs")).toEqual([]);
  });

  it("backs off ×2 up to its cap", () => {
    const b = new Backoff(3000, 20_000);
    expect([b.next(), b.next(), b.next(), b.next()]).toEqual([3000, 6000, 12_000, 20_000]);
    b.reset();
    expect(b.next()).toBe(3000);
  });
});

describe("the registry and the person lifecycle", () => {
  it("refcount starts on the first hold and stops on the last release, once each", () => {
    const log: string[] = [];
    const holds = refcount(
      () => log.push("start"),
      () => log.push("stop"),
    );
    const a = holds.acquire();
    const b = holds.acquire();
    a();
    a();
    expect(log).toEqual(["start"]);
    expect(holds.held()).toBe(true);
    b();
    expect(log).toEqual(["start", "stop"]);
    expect(holds.held()).toBe(false);
  });

  type S = {
    userId: string;
    workspaceId: string;
    waiting: string[];
    disposed?: boolean;
    persisted?: boolean;
    dispose(o: { persist: boolean }): void;
  };
  const scope = {};
  const make = (userId: string, workspaceId: string, waiting: string[] = []): S => ({
    userId,
    workspaceId,
    waiting,
    dispose(o) {
      this.disposed = true;
      this.persisted = o.persist;
    },
  });

  function memCopies(seed: Record<string, { rows: number; waiting: string[] }>) {
    const records = new Map(Object.entries(seed));
    const copies: OwnedCopies<string> = {
      keys: async () => [...records.keys()],
      async keepOnlyWaiting(key, inMemory) {
        const stored = records.get(key)?.waiting ?? [];
        const waiting = [...new Set([...stored, ...inMemory])];
        records.set(key, { rows: 0, waiting });
        return waiting.length;
      },
      deleteWhere: async (match) => {
        for (const k of [...records.keys()]) if (match(k)) records.delete(k);
      },
      clear: async () => records.clear(),
    };
    return { records, copies };
  }

  it("a store made for someone else is thrown away", () => {
    const reg = new StoreRegistry<S>();
    const first = reg.get(scope, "u1", "w", () => make("u1", "w"));
    expect(reg.get(scope, "u1", "w", () => make("u1", "w"))).toBe(first);
    const second = reg.get(scope, "u2", "w", () => make("u2", "w"));
    expect(second).not.toBe(first);
    expect(first.disposed).toBe(true);
    expect(first.persisted).toBe(false);
    expect(reg.find(scope, "w")).toBe(second);
  });

  it("a null session stops the stores and keeps every copy whole", async () => {
    const reg = new StoreRegistry<S>();
    const { records, copies } = memCopies({ "u1:w": { rows: 5, waiting: ["x"] } });
    const lc = personLifecycle({
      registry: reg,
      scopeOf: () => scope,
      copies: () => copies,
      waiting: (s) => s.waiting,
    });
    const store = reg.get(scope, "u1", "w", () => make("u1", "w", ["y"]));
    await lc.attachUser(null);
    expect(store.disposed).toBe(true);
    expect(store.persisted).toBe(true);
    expect(records.get("u1:w")).toEqual({ rows: 5, waiting: ["x"] });
  });

  it("someone else signing in cuts the others' copies to what waits; empty ones go", async () => {
    const reg = new StoreRegistry<S>();
    const { records, copies } = memCopies({
      "u1:w": { rows: 5, waiting: ["x"] },
      "u1:v": { rows: 5, waiting: [] },
      "u2:w": { rows: 3, waiting: [] },
    });
    const lc = personLifecycle({
      registry: reg,
      scopeOf: () => scope,
      copies: () => copies,
      waiting: (s) => s.waiting,
    });
    reg.get(scope, "u1", "w", () => make("u1", "w", ["y"]));
    expect(lc.waitingCount()).toBe(1);
    expect(waitingEverywhere()).toBeGreaterThanOrEqual(1);
    await lc.attachUser("u2");
    expect(records.get("u1:w")).toEqual({ rows: 0, waiting: ["x", "y"] });
    expect(records.has("u1:v")).toBe(false);
    expect(records.get("u2:w")).toEqual({ rows: 3, waiting: [] });
    expect(lc.waitingCount()).toBe(0);
  });

  it("a sign-out keeps what waits; account deletion and a left workspace take everything", async () => {
    const reg = new StoreRegistry<S>();
    const { records, copies } = memCopies({
      "u1:w": { rows: 5, waiting: ["x"] },
      "u1:gone": { rows: 5, waiting: ["z"] },
    });
    const lc = personLifecycle({
      registry: reg,
      scopeOf: () => scope,
      copies: () => copies,
      waiting: (s) => s.waiting,
    });
    await lc.keepWorkspaces("u1", ["w"]);
    expect([...records.keys()]).toEqual(["u1:w"]);
    await lc.wipe();
    expect(records.get("u1:w")).toEqual({ rows: 0, waiting: ["x"] });
    await lc.wipe({ keepWaiting: false });
    expect(records.size).toBe(0);
  });
});
