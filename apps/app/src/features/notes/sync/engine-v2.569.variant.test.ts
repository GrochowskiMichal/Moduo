// HV-15 variant of benchmarks/escapes/569-late-write-to-disposed-store: a
// Notes meta op (a rename, a move, a trash) on its way live when the person
// signs out (or someone else signs in) that then fails on the network is
// answered "queued" but written nowhere: the stopped engine's
// `enqueueMetaOp` is a no-op once its owner is stopped, so the op is lost
// although a sign-out keeps what waits. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/notes/sync/engine-v2.569.variant.test.ts

import { afterAll, afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { NotesSyncEngineV2 } from "./engine-v2";
import { type MetaOutboxEntry, NOTES_DB_NAME, openNotesDb, setNotesSignedIn } from "./idb";
import { attachNotesUser, notesEngines, wipeNotesCopies } from "./people";
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

beforeAll(async () => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = fake.factory;
  await openNotesDb();
});

afterAll(() => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = realIndexedDb;
});

afterEach(async () => {
  for (const engine of notesEngines.all()) await engine.destroy();
  fake.reset();
  setNotesSignedIn(undefined);
});

const metaOutbox = () => [...fake.rows(NOTES_DB_NAME, "metaOutbox").values()] as MetaOutboxEntry[];

/** A rename that hangs until the test lets it fail like a lost connection. */
function hangingRename() {
  let fail!: () => void;
  let started!: () => void;
  const onWay = new Promise<void>((resolve) => (started = resolve));
  const rename = rs.fn(
    () =>
      new Promise((_resolve, reject) => {
        fail = () => reject(new TypeError("Failed to fetch"));
        started();
      }),
  );
  const runtime = {
    notesV2: {
      rename,
      pullDoc: async () => ({ snapshotB64: null, docVersion: 0, updates: [] }),
      pushUpdates: async () => ({ inserted: 0 }),
    },
  } as unknown as ModuoRuntime;
  return { runtime, onWay, fail: () => fail() };
}

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 569: a Notes meta op on its way at sign-out that then fails is lost", () => {
  it("a rename on its way at sign-out that then fails waits for the person on the device", async () => {
    await attachNotesUser("user-a");
    const { runtime, onWay, fail } = hangingRename();
    const engine = new NotesSyncEngineV2(runtime, "ws1", undefined, "user-a");
    const result = engine.runMetaOp("rename", { workspaceId: "ws1", noteId: "n1", title: "Final" });
    await onWay;
    // The person signs out while the rename is on its way…
    await wipeNotesCopies();
    // …and then the connection drops: it comes back as a network failure.
    fail();
    expect(await result).toBe("queued");
    // "Queued" means it waits on the device for user-a, sent when they're back.
    expect(metaOutbox()).toEqual([
      expect.objectContaining({
        userId: "user-a",
        workspaceId: "ws1",
        kind: "rename",
        args: expect.objectContaining({ noteId: "n1", title: "Final" }),
      }),
    ]);
  });

  it("a rename on its way when another person signs in that then fails waits for its owner", async () => {
    await attachNotesUser("user-a");
    const { runtime, onWay, fail } = hangingRename();
    const engine = new NotesSyncEngineV2(runtime, "ws1", undefined, "user-a");
    const result = engine.runMetaOp("rename", { workspaceId: "ws1", noteId: "n1", title: "Final" });
    await onWay;
    await attachNotesUser("user-b");
    fail();
    expect(await result).toBe("queued");
    expect(metaOutbox()).toEqual([expect.objectContaining({ userId: "user-a", kind: "rename" })]);
  });
});
