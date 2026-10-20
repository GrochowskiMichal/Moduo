// The opener heals a database that lacks a store (gotcha: "An IndexedDB
// database can exist without its object store"). jsdom has no IndexedDB, so a
// small fake plays the parts the opener uses: open with or without a
// version, an upgrade that may create stores, and a blocked open.

import { describe, expect, it } from "@rstest/core";

import { idbOpener } from "./idb";

type FakeDb = { version: number; stores: Set<string>; closed: boolean };

function fakeFactory(seed?: { name: string; version: number; stores: string[] }) {
  const dbs = new Map<string, { version: number; stores: Set<string> }>();
  if (seed) dbs.set(seed.name, { version: seed.version, stores: new Set(seed.stores) });
  const opens: (number | undefined)[] = [];
  let blocked = false;
  const factory = {
    open(name: string, version?: number) {
      opens.push(version);
      const req: Record<string, unknown> & { result?: unknown } = {};
      queueMicrotask(() => {
        if (blocked) {
          (req.onblocked as () => void)?.();
          return;
        }
        let held = dbs.get(name);
        const want = version ?? held?.version ?? 1;
        const upgrade = !held || want > held.version;
        if (!held) {
          held = { version: want, stores: new Set() };
          dbs.set(name, held);
        }
        const db: FakeDb & Record<string, unknown> = {
          version: want,
          stores: held.stores,
          closed: false,
          objectStoreNames: { contains: (s: string) => held!.stores.has(s) },
          createObjectStore: (s: string) => held!.stores.add(s),
          close() {
            db.closed = true;
          },
        };
        req.result = db;
        if (upgrade) {
          held.version = want;
          (req.onupgradeneeded as () => void)?.();
        }
        (req.onsuccess as () => void)?.();
      });
      return req;
    },
  };
  return {
    factory: factory as unknown as IDBFactory,
    dbs,
    opens,
    block: () => {
      blocked = true;
    },
  };
}

const schema = {
  name: "test-db",
  stores: {
    a: (db: IDBDatabase) => db.createObjectStore("a"),
    b: (db: IDBDatabase) => db.createObjectStore("b"),
  },
};

describe("idbOpener", () => {
  it("makes every store on a first open", async () => {
    const fake = fakeFactory();
    const db = (await idbOpener(fake.factory, schema).open()) as unknown as FakeDb;
    expect([...db.stores].sort()).toEqual(["a", "b"]);
    expect(fake.opens).toEqual([undefined]);
  });

  it("reopens one version up when a store is missing", async () => {
    const fake = fakeFactory({ name: "test-db", version: 3, stores: ["a"] });
    const db = (await idbOpener(fake.factory, schema).open()) as unknown as FakeDb;
    expect([...db.stores].sort()).toEqual(["a", "b"]);
    expect(fake.opens).toEqual([undefined, 4]);
    expect(fake.dbs.get("test-db")?.version).toBe(4);
  });

  it("opens once and shares the handle", async () => {
    const fake = fakeFactory();
    const opener = idbOpener(fake.factory, schema);
    const [x, y] = await Promise.all([opener.open(), opener.open()]);
    expect(x).toBe(y);
    expect(fake.opens).toHaveLength(1);
  });

  it("reopens after close, and after a blocked open fails", async () => {
    const fake = fakeFactory();
    const opener = idbOpener(fake.factory, schema);
    const first = (await opener.open()) as unknown as FakeDb;
    await opener.close();
    expect(first.closed).toBe(true);
    await opener.open();
    expect(fake.opens).toHaveLength(2);

    const stuck = fakeFactory();
    stuck.block();
    const blocked = idbOpener(stuck.factory, schema);
    await expect(blocked.open()).rejects.toThrow("blocked");
    await expect(blocked.open()).rejects.toThrow("blocked");
    expect(stuck.opens).toHaveLength(2);
  });
});
