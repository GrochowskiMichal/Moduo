// Regression test for the Notes variant of
// benchmarks/escapes/569-late-write-to-disposed-store (found by the HV-15
// variant hunt). A meta op (a rename, a move, a create) still on its way at
// sign-out whose request then failed on the network was "queued" into the
// stopped engine's owner, and `enqueueMetaOp` wrote nothing for a stopped
// owner: the op was lost, though the caller was told it waits. Now it waits on
// the device for the person (stamped when it was made, so it replays in front
// of anything they queued since), the person's running engine picks it up,
// and only account deletion drops it.
// Run: bun run --cwd apps/app test src/features/notes/sync/engine-v2.569.test.ts

import { afterAll, afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { NotesSyncEngineV2 } from "./engine-v2";
import { enqueueDocUpdate, NOTES_DB_NAME, openNotesDb, setNotesSignedIn } from "./idb";
import { replayOrder } from "./meta-outbox";
import { attachNotesUser, wipeNotesCopies } from "./people";
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

afterEach(() => {
  fake.reset();
  setNotesSignedIn(undefined);
});

type Waiting = { kind: string; args: { title: string }; queuedAt: number; key?: number };

/** user-a's queued meta ops, in the order a replay sends them. */
const waitingFor = (userId: string) =>
  replayOrder(
    [...fake.rows(NOTES_DB_NAME, "metaOutbox").entries()]
      .map(([key, e]) => ({ ...(e as Waiting & { userId?: string }), key: key as number }))
      .filter((e) => e.userId === userId) as never[],
  ).map((e) => `${(e as unknown as Waiting).kind}:${(e as unknown as Waiting).args.title}`);

const tick = () => new Promise((r) => setTimeout(r, 1));

function runtimeWith(rename: (...a: unknown[]) => Promise<unknown>): ModuoRuntime {
  return {
    notesV2: {
      rename,
      pullDoc: async () => ({ snapshotB64: null, docVersion: 0, updates: [] }),
      pushUpdates: async () => ({ inserted: 0 }),
    },
  } as unknown as ModuoRuntime;
}

/** A rename whose request hangs until `fail()` is called. */
function hangingRename() {
  let failRename: (() => void) | null = null;
  const rename = rs.fn(
    () =>
      new Promise((_resolve, reject) => {
        failRename = () => reject(new TypeError("Failed to fetch"));
      }),
  );
  return {
    rename,
    started: async () => {
      for (let i = 0; i < 50 && !failRename; i++) await tick();
      expect(rename).toHaveBeenCalledTimes(1);
    },
    fail: () => failRename!(),
  };
}

describe("MOD-569 (Notes): a meta op on its way at sign-out that then fails is kept for the person", () => {
  it("the rename waits on the device for the person, as a check-off does", async () => {
    await attachNotesUser("user-a");
    const net = hangingRename();
    const engine = new NotesSyncEngineV2(runtimeWith(net.rename), "ws1", undefined, "user-a");

    // The person renames a note; the request is on its way.
    const result = engine.runMetaOp("rename", {
      workspaceId: "ws1",
      noteId: "n1",
      title: "Q4 plan",
    });
    await net.started();

    // They sign out (their outboxes stay on the device for next time)…
    await wipeNotesCopies();
    // …and the rename's request then fails on the network.
    net.fail();
    expect(await result).toBe("queued");

    // Told "queued": it must be waiting on the device for them.
    expect(waitingFor("user-a")).toEqual(["rename:Q4 plan"]);
  });

  it("one that fails after the person is back replays in front of their newer rename", async () => {
    await attachNotesUser("user-a");
    const net = hangingRename();
    const old = new NotesSyncEngineV2(runtimeWith(net.rename), "ws1", undefined, "user-a");
    const result = old.runMetaOp("rename", { workspaceId: "ws1", noteId: "n1", title: "Q4 plan" });
    await net.started();

    // Signed out and straight back in; offline, they rename the note again.
    await wipeNotesCopies();
    await attachNotesUser("user-a");
    let online = false;
    const sent: string[] = [];
    const rename2 = rs.fn(async (args: unknown) => {
      if (!online) throw new TypeError("Failed to fetch");
      sent.push((args as { title: string }).title);
      return {};
    });
    const now = new NotesSyncEngineV2(runtimeWith(rename2), "ws1", undefined, "user-a");
    expect(
      await now.runMetaOp("rename", { workspaceId: "ws1", noteId: "n1", title: "Q4 final" }),
    ).toBe("queued");

    // The older rename's request fails only now.
    net.fail();
    expect(await result).toBe("queued");
    expect(waitingFor("user-a")).toEqual(["rename:Q4 plan", "rename:Q4 final"]);

    // Back online: the newer title is the one that stays.
    online = true;
    await now.wake();
    expect(sent).toEqual(["Q4 plan", "Q4 final"]);
    expect(waitingFor("user-a")).toEqual([]);
    await now.destroy();
  });

  it("one that fails after the person's newer rename already went out never overwrites it", async () => {
    await attachNotesUser("user-a");
    const net = hangingRename();
    const old = new NotesSyncEngineV2(runtimeWith(net.rename), "ws1", undefined, "user-a");
    const result = old.runMetaOp("rename", { workspaceId: "ws1", noteId: "n1", title: "Q4 plan" });
    await net.started();

    // Signed out and straight back in; online, they rename the note again (live).
    await wipeNotesCopies();
    await attachNotesUser("user-a");
    const sent: string[] = [];
    const moved: string[] = [];
    const now = new NotesSyncEngineV2(
      {
        notesV2: {
          rename: async (args: { noteId: string; title: string }) => {
            sent.push(`${args.noteId}:${args.title}`);
            return {};
          },
          move: async (args: { noteId: string }) => {
            moved.push(args.noteId);
            return {};
          },
          pullDoc: async () => ({ snapshotB64: null, docVersion: 0, updates: [] }),
          pushUpdates: async () => ({ inserted: 0 }),
        },
      } as unknown as ModuoRuntime,
      "ws1",
      undefined,
      "user-a",
    );
    // The device clock was set back an hour meanwhile: the order ops were made in still holds.
    const clock = rs.spyOn(Date, "now").mockReturnValue(Date.now() - 3_600_000);
    try {
      expect(
        await now.runMetaOp("rename", { workspaceId: "ws1", noteId: "n1", title: "Q4 final" }),
      ).toBe("applied");
    } finally {
      clock.mockRestore();
    }

    // The older rename's request fails only now, and is handed to `now`.
    net.fail();
    expect(await result).toBe("queued");
    await now.wake();
    for (let i = 0; i < 20; i++) await tick();

    // The newer title stays; the stale one is never sent over it, nor kept.
    expect(sent).toEqual(["n1:Q4 final"]);
    expect(waitingFor("user-a")).toEqual([]);
    await now.destroy();
  });

  it("a newer op for another note doesn't stand for it", async () => {
    await attachNotesUser("user-a");
    const net = hangingRename();
    const old = new NotesSyncEngineV2(runtimeWith(net.rename), "ws1", undefined, "user-a");
    const result = old.runMetaOp("rename", { workspaceId: "ws1", noteId: "n1", title: "Q4 plan" });
    await net.started();
    await wipeNotesCopies();
    await attachNotesUser("user-a");

    const sent: string[] = [];
    const now = new NotesSyncEngineV2(
      runtimeWith(async (args) => {
        const a = args as { noteId: string; title: string };
        sent.push(`${a.noteId}:${a.title}`);
        return {};
      }),
      "ws1",
      undefined,
      "user-a",
    );
    // Another note's rename goes out: it says nothing about n1's title.
    await now.runMetaOp("rename", { workspaceId: "ws1", noteId: "n2", title: "Budget" });

    net.fail();
    expect(await result).toBe("queued");
    await now.wake();
    for (let i = 0; i < 20; i++) await tick();
    expect(sent).toEqual(["n2:Budget", "n1:Q4 plan"]);
    await now.destroy();
  });

  it("the person's running engine sends it without waiting for another wake", async () => {
    await attachNotesUser("user-a");
    const net = hangingRename();
    const old = new NotesSyncEngineV2(runtimeWith(net.rename), "ws1", undefined, "user-a");
    const result = old.runMetaOp("rename", { workspaceId: "ws1", noteId: "n1", title: "Q4 plan" });
    await net.started();

    await wipeNotesCopies();
    await attachNotesUser("user-a");
    const sent: string[] = [];
    const now = new NotesSyncEngineV2(
      runtimeWith(async (args) => {
        sent.push((args as { title: string }).title);
        return {};
      }),
      "ws1",
      undefined,
      "user-a",
    );

    net.fail();
    expect(await result).toBe("queued");
    for (let i = 0; i < 50 && sent.length === 0; i++) await tick();
    expect(sent).toEqual(["Q4 plan"]);
    await now.destroy();
  });

  it("an op made on a stopped engine isn't sent under the next session, it waits", async () => {
    await attachNotesUser("user-a");
    const rename = rs.fn(async () => ({}));
    const engine = new NotesSyncEngineV2(runtimeWith(rename), "ws1", undefined, "user-a");
    await attachNotesUser("user-b");

    expect(
      await engine.runMetaOp("rename", { workspaceId: "ws1", noteId: "n1", title: "Q4 plan" }),
    ).toBe("queued");
    expect(rename).not.toHaveBeenCalled();
    expect(waitingFor("user-a")).toEqual(["rename:Q4 plan"]);
    expect(waitingFor("user-b")).toEqual([]);
  });

  it("one that fails while another person's sign-in cuts their caches down still waits", async () => {
    await attachNotesUser("user-a");
    // user-a has a notes list on the device, so the sign-in cuts it down.
    fake.rows(NOTES_DB_NAME, "metaCache").set("user-a:ws1", { notes: [], savedAt: 0 });
    const net = hangingRename();
    const engine = new NotesSyncEngineV2(runtimeWith(net.rename), "ws1", undefined, "user-a");
    const result = engine.runMetaOp("rename", {
      workspaceId: "ws1",
      noteId: "n1",
      title: "Q4 plan",
    });
    await net.started();

    // The request fails just after the cut-down counted what of theirs waits
    // (nothing yet): their list goes, then the queued ops are read.
    const lists = fake.rows(NOTES_DB_NAME, "metaCache");
    const queued = fake.rows(NOTES_DB_NAME, "metaOutbox");
    const drop = lists.delete.bind(lists);
    const read = queued.entries.bind(queued);
    let armed = false;
    lists.delete = (key) => {
      if (key === "user-a:ws1") armed = true;
      return drop(key);
    };
    queued.entries = () => {
      const out = read();
      if (armed) {
        armed = false;
        net.fail();
      }
      return out;
    };
    await attachNotesUser("user-b");
    expect(await result).toBe("queued");
    await attachNotesUser("user-b");
    expect(waitingFor("user-a")).toEqual(["rename:Q4 plan"]);
  });

  it("account deletion drops one from an engine that had already stopped", async () => {
    await attachNotesUser("user-a");
    const net = hangingRename();
    const engine = new NotesSyncEngineV2(runtimeWith(net.rename), "ws1", undefined, "user-a");
    const result = engine.runMetaOp("rename", {
      workspaceId: "ws1",
      noteId: "n1",
      title: "Q4 plan",
    });
    await net.started();

    // A lost session stops the engine (not a sign-out); then the person deletes their account.
    await attachNotesUser(null);
    await wipeNotesCopies({ keepWaiting: false });
    net.fail();
    await result;
    expect([...fake.rows(NOTES_DB_NAME, "metaOutbox").values()]).toEqual([]);

    // Nor does a document edit of theirs that arrives late.
    const kept = await enqueueDocUpdate(
      { userId: "user-a", workspaceId: "ws1", stopped: true },
      { noteId: "n1", clientSeq: 1, updateB64: "AA==", queuedAt: 0 },
    );
    expect(kept).toBe(false);
    expect([...fake.rows(NOTES_DB_NAME, "docOutbox").values()]).toEqual([]);

    // Someone else signing in on this device afterwards still keeps what they queue.
    await attachNotesUser("user-b");
    const offline = new NotesSyncEngineV2(
      runtimeWith(async () => {
        throw new TypeError("Failed to fetch");
      }),
      "ws1",
      undefined,
      "user-b",
    );
    expect(
      await offline.runMetaOp("rename", { workspaceId: "ws1", noteId: "n2", title: "Budget" }),
    ).toBe("queued");
    expect(waitingFor("user-b")).toEqual(["rename:Budget"]);
    await offline.destroy();
  });

  it("account deletion drops one that fails after it", async () => {
    await attachNotesUser("user-a");
    const net = hangingRename();
    const engine = new NotesSyncEngineV2(runtimeWith(net.rename), "ws1", undefined, "user-a");
    const result = engine.runMetaOp("rename", {
      workspaceId: "ws1",
      noteId: "n1",
      title: "Q4 plan",
    });
    await net.started();

    await wipeNotesCopies({ keepWaiting: false });
    net.fail();
    await result;
    expect([...fake.rows(NOTES_DB_NAME, "metaOutbox").values()]).toEqual([]);
  });
});

describe("MOD-569 (Notes): a document edit on its way to the device at sign-out is kept for the person", () => {
  const docOutbox = (userId: string) =>
    [...fake.rows(NOTES_DB_NAME, "docOutbox").values()].filter(
      (e) => (e as { userId?: string }).userId === userId,
    ) as { noteId: string; clientSeq: number }[];
  const noteRow = () =>
    fake.rows(NOTES_DB_NAME, "noteState").get("n1") as
      { nextClientSeq: number; cursors?: Record<string, unknown> } | undefined;

  async function openNote() {
    await attachNotesUser("user-a");
    const pushUpdates = rs.fn(async () => ({ inserted: 0 }));
    const runtime = {
      notesV2: {
        pullDoc: async () => ({ snapshotB64: null, docVersion: 0, updates: [] }),
        pushUpdates,
      },
    } as unknown as ModuoRuntime;
    const engine = new NotesSyncEngineV2(runtime, "ws1", undefined, "user-a");
    const session = engine.getOrCreateSession("n1");
    await session.booted;
    return { engine, session, pushUpdates };
  }

  const settle = async () => {
    for (let i = 0; i < 20; i++) await tick();
  };

  for (const [how, stop] of [
    ["sign-out", () => wipeNotesCopies()],
    ["another person signing in", () => attachNotesUser("user-b")],
  ] as const) {
    it(`an edit typed just before ${how} still waits on the device`, async () => {
      const { engine, session, pushUpdates } = await openNote();

      // The person types; the edit is on its way into the outbox when they stop.
      session.doc.getMap("probe").set("k", "typed last");
      await stop();
      await settle();
      await engine.destroy();

      const kept = docOutbox("user-a");
      expect(kept.map((e) => e.noteId)).toEqual(["n1"]);
      // Its seq is taken: the next edit on this device can't reuse it (the
      // server would drop one of the two as a duplicate).
      expect(noteRow()!.nextClientSeq).toBeGreaterThan(kept[0]!.clientSeq);
      // Nothing went out under the next session.
      expect(pushUpdates).not.toHaveBeenCalled();
    });
  }

  it("an edit that lands after the stop is kept, its seq taken, no cursor written back", async () => {
    const { engine, session, pushUpdates } = await openNote();
    const switched = attachNotesUser("user-b");
    // The engine stopped at once; the editor is still up while it tears down,
    // and a keystroke lands.
    session.doc.getMap("probe").set("k", "typed after");
    await switched;
    await settle();
    await engine.destroy();

    const kept = docOutbox("user-a");
    expect(kept.map((e) => e.noteId)).toEqual(["n1"]);
    expect(noteRow()!.nextClientSeq).toBeGreaterThan(kept[0]!.clientSeq);
    // Their document cache is gone: a cursor without it would skip content on the next pull.
    expect(noteRow()!.cursors?.["user-a:ws1"]).toBeUndefined();
    expect(pushUpdates).not.toHaveBeenCalled();
  });

  it("account deletion keeps no edit that lands after it", async () => {
    const { engine, session } = await openNote();
    session.doc.getMap("probe").set("k", "typed last");
    const wiped = wipeNotesCopies({ keepWaiting: false });
    session.doc.getMap("probe").set("k", "typed after");
    await wiped;
    await settle();
    await engine.destroy();
    expect(docOutbox("user-a")).toEqual([]);
  });
});
