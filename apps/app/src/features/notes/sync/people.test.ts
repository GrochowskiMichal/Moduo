// Notes' caches are one person's (Track C4). A sign-out, or another person
// signing in, stops every other person's engine at once: nothing it still
// holds goes out under the next person's session (the validator's MAJOR:
// a disposed engine flushed A's edits through B's token). A null session
// changes nothing. jsdom has no IndexedDB, so the engine runs on its memory
// outbox and y-indexeddb is stubbed, as in the other engine tests.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import * as Y from "yjs";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { NotesSyncEngineV2 } from "./engine-v2";
import { mayWrite, setNotesSignedIn } from "./idb";
import { attachNotesUser, notesEngines, wipeNotesCopies } from "./people";

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

function fakeRuntime() {
  const pullDoc = rs.fn(async () => ({ snapshotB64: null, docVersion: 0, updates: [] }));
  const pushUpdates = rs.fn(async (input: { updates: unknown[] }) => ({
    inserted: input.updates.length,
  }));
  const runtime = { notesV2: { pullDoc, pushUpdates } } as unknown as ModuoRuntime;
  return { runtime, pullDoc, pushUpdates };
}

function type(doc: Y.Doc, text: string) {
  const root = doc.get("root-v2", Y.XmlElement);
  const run = new Y.XmlText();
  run.insert(0, text);
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [run]);
  root.insert(root.length, [p]);
}

afterEach(async () => {
  for (const engine of notesEngines.all()) await engine.destroy();
  setNotesSignedIn(undefined);
});

describe("Notes engines follow who is signed in", () => {
  it("another person signing in stops the first one's engine: nothing more is sent", async () => {
    const { runtime, pushUpdates } = fakeRuntime();
    await attachNotesUser("user-a");
    const engine = new NotesSyncEngineV2(runtime, "ws", undefined, "user-a");
    const session = engine.getOrCreateSession("n1");
    await session.booted;
    pushUpdates.mockClear();
    type(session.doc, "A's words");
    // B signs in before the debounced push fires (and before React tears down).
    void attachNotesUser("user-b");
    await settle();
    await engine.destroy();
    expect(pushUpdates).not.toHaveBeenCalled();
    expect(notesEngines.all()).not.toContain(engine);
  });

  it("the signed-in person's engine keeps sending", async () => {
    const { runtime, pushUpdates } = fakeRuntime();
    await attachNotesUser("user-a");
    const engine = new NotesSyncEngineV2(runtime, "ws", undefined, "user-a");
    const session = engine.getOrCreateSession("n2");
    await session.booted;
    type(session.doc, "kept");
    await attachNotesUser("user-a");
    await settle();
    expect(pushUpdates).toHaveBeenCalled();
  });

  it("a sign-out stops every engine and every write; a null session wipes and blocks nothing", async () => {
    const { runtime } = fakeRuntime();
    await attachNotesUser("user-a");
    // A null session (an expired token offline) stops the engines as Tasks'
    // and Chat's stores stop, but the person's writes are still theirs.
    await attachNotesUser(null);
    expect(mayWrite("user-a")).toBe(true);
    const engine = new NotesSyncEngineV2(runtime, "ws", undefined, "user-a");
    expect(notesEngines.all()).toContain(engine);
    void wipeNotesCopies();
    expect(notesEngines.all()).not.toContain(engine);
    // A notes list that answers after the sign-out isn't written for anyone.
    expect(mayWrite("user-a")).toBe(false);
  });
});
