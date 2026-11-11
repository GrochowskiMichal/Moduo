// HV-15 variant of benchmarks/escapes/569-late-write-to-disposed-store: a Notes
// meta op (rename, move, archive…) still on its way at sign-out whose request
// then fails on the network is queued through the stopped engine's owner, and
// `enqueueMetaOp` writes nothing for a stopped owner: the op is answered
// "queued" and never sent. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/notes/sync/engine-v2.569.variant.test.ts

import { afterAll, afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { NotesSyncEngineV2 } from "./engine-v2";
import { NOTES_DB_NAME, openNotesDb, setNotesSignedIn } from "./idb";
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
const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

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

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

hunt("HV-15 variant 569: a Notes meta op on its way at sign-out that then fails is lost", () => {
  it("a rename on its way at sign-out that fails is kept for the person, and sent when they're back", async () => {
    let title = "Untitled";
    let networkUp = true;
    let failInFlight: (() => void) | null = null;
    const rename = rs.fn(async (args: { noteId: string; title: string }) => {
      if (!failInFlight && networkUp) {
        // The first one leaves; the connection goes before it answers.
        await new Promise<void>((_resolve, reject) => {
          failInFlight = () => reject(new TypeError("Failed to fetch"));
        });
      }
      if (!networkUp) throw new TypeError("Failed to fetch");
      title = args.title;
      return { id: args.noteId, title: args.title };
    });
    const runtime = {
      notesV2: {
        rename,
        pullDoc: async () => ({ snapshotB64: null, docVersion: 0, updates: [] }),
        pushUpdates: async () => ({ inserted: 0 }),
      },
    } as unknown as ModuoRuntime;

    await attachNotesUser("user-a");
    const engine = new NotesSyncEngineV2(runtime, "ws1", undefined, "user-a");
    const renamed = engine.runMetaOp("rename", {
      workspaceId: "ws1",
      noteId: "n1",
      title: "Final",
    });
    await tick();
    expect(rename).toHaveBeenCalledTimes(1);

    // Signed out while it is on its way; then its request fails on the network.
    await wipeNotesCopies();
    networkUp = false;
    failInFlight!();
    // The person was told it waits to sync.
    expect(await renamed).toBe("queued");

    // So it waits on the device under their key…
    const waiting = [...fake.rows(NOTES_DB_NAME, "metaOutbox").values()] as {
      userId: string;
      args: { title: string };
    }[];
    expect(waiting.map((e) => [e.userId, e.args.title])).toEqual([["user-a", "Final"]]);

    // …and goes out the next time they're signed in here.
    networkUp = true;
    await attachNotesUser("user-a");
    const back = new NotesSyncEngineV2(runtime, "ws1", undefined, "user-a");
    await back.wake();
    expect(title).toBe("Final");
  });
});
