// HV-15 variant of benchmarks/escapes/645-3-error-as-empty: the meta chain asks
// `readMetaOutbox` "is anything still queued?" before sending a Notes op live,
// and a read that fails (the connection closing, a transaction that can't
// start) answers [], which reads as "nothing queued". The new op goes straight
// to the server, ahead of an older op still waiting on the device, and that
// older op replays on the next wake and wins. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/notes/sync/meta-chain.645.variant.test.ts

import { afterAll, beforeAll, describe, expect, it, rs } from "@rstest/core";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { NotesSyncEngineV2 } from "./engine-v2";
import { enqueueMetaOp, openNotesDb, setNotesSignedIn } from "./idb";
import { fakeIdb } from "./testing-idb";

rs.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve();
    destroy() {
      return Promise.resolve();
    }
    clearData() {
      return Promise.resolve();
    }
  },
}));

const fake = fakeIdb();
const realIndexedDb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;

// The device store is the boundary: while `failReads` is on, a read-only
// transaction on the meta outbox can't start, as on a connection that is
// closing (InvalidStateError). Writes still land.
let failReads = false;
const flaky = {
  ...fake.factory,
  open(name: string, version?: number) {
    const request = fake.factory.open(name, version) as unknown as {
      result?: IDBDatabase;
      onsuccess?: () => void;
    };
    const wrapped: { result?: IDBDatabase; onsuccess?: () => void; [k: string]: unknown } = request;
    return new Proxy(wrapped, {
      get(target, prop) {
        if (prop !== "result" || !target.result) return Reflect.get(target, prop);
        const db = target.result;
        return new Proxy(db, {
          get(d, p) {
            if (p !== "transaction") return Reflect.get(d, p);
            return (names: string | string[], mode?: IDBTransactionMode) => {
              const list = Array.isArray(names) ? names : [names];
              if (failReads && (mode ?? "readonly") === "readonly" && list.includes("metaOutbox")) {
                throw new Error("InvalidStateError: The database connection is closing.");
              }
              return d.transaction(names, mode);
            };
          },
        });
      },
    }) as unknown as IDBOpenDBRequest;
  },
} as IDBFactory;

beforeAll(async () => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = flaky;
  await openNotesDb();
});

afterAll(() => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = realIndexedDb;
  setNotesSignedIn(undefined);
});

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 645-3: an unreadable meta outbox reads as nothing queued", () => {
  it("a rename made while the outbox can't be read doesn't jump an older queued rename", async () => {
    setNotesSignedIn("user-645");
    let title = "Untitled";
    const runtime = {
      notesV2: {
        rename: async (args: { noteId: string; title: string }) => {
          title = args.title;
          return { id: args.noteId, title: args.title };
        },
        pullDoc: async () => ({ snapshotB64: null, docVersion: 0, updates: [] }),
        pushUpdates: async () => ({ inserted: 0 }),
      },
    } as unknown as ModuoRuntime;
    const engine = new NotesSyncEngineV2(runtime, "ws-645", undefined, "user-645");
    try {
      // Offline before the last reload: a rename still waits in the meta
      // outbox on the device, made by that earlier page load.
      await enqueueMetaOp(
        { userId: "user-645", workspaceId: "ws-645" },
        {
          kind: "rename",
          args: { workspaceId: "ws-645", noteId: "n1", title: "Draft" },
          queuedAt: Date.now() - 60_000,
          made: { life: "the-page-before-the-reload", seq: 1 },
        },
      );
      expect(fake.rows("moduo-notes-v2", "metaOutbox").size).toBe(1);

      // Back online after the reload, but the outbox can't be read for a
      // moment; the person renames the note again.
      failReads = true;
      await engine.runMetaOp("rename", { workspaceId: "ws-645", noteId: "n1", title: "Final" });
      failReads = false;

      // The next wake replays what waited on the device.
      await engine.wake();
      // In the order they were made: the newer title stays.
      expect(title).toBe("Final");
    } finally {
      failReads = false;
      await engine.destroy();
    }
  });
});
