// NR-2 · AC3 — the engine half of lazy drafts. jsdom has no IndexedDB, so
// y-indexeddb is stubbed and the engine runs on its memory outbox (the queue
// it falls back to in private mode), with a fake runtime counting every call.
//   - a draft session neither pulls nor pushes, however much is typed;
//   - an untouched discarded draft leaves no queued update;
//   - a promoted draft queues durably but pushes only after releasePush (so a
//     push never precedes its create), exactly once for what was typed.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import * as Y from "yjs";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { NotesSyncEngineV2 } from "./engine-v2";

// y-indexeddb needs a real IndexedDB; the engine only needs its lifecycle.
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

/** Append a paragraph in the v2 binding's shape (a `paragraph` element over
 * a text run), so the body derivation reads it like editor-typed content. */
function type(doc: Y.Doc, text: string) {
  const root = doc.get("root-v2", Y.XmlElement);
  const run = new Y.XmlText();
  run.insert(0, text);
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [run]);
  root.insert(root.length, [p]);
}

let engine: NotesSyncEngineV2 | null = null;
afterEach(async () => {
  await engine?.destroy();
  engine = null;
});

describe("engine drafts — lazy create (NR-2, AC3)", () => {
  it("a draft session never pulls or pushes, even while typed into", async () => {
    const { runtime, pullDoc, pushUpdates } = fakeRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.openDraft("d1");
    await session.booted;
    type(session.doc, "hello");
    await settle();
    expect(engine.isDraft("d1")).toBe(true);
    expect(pullDoc).not.toHaveBeenCalled();
    expect(pushUpdates).not.toHaveBeenCalled();
  });

  it("a discarded draft leaves nothing queued and never reaches the server", async () => {
    const { runtime, pushUpdates } = fakeRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.openDraft("d2");
    await session.booted;
    await engine.discardDraft("d2");
    expect(engine.isDraft("d2")).toBe(false);
    await engine.wake();
    await settle();
    expect(pushUpdates).not.toHaveBeenCalled();
  });

  it("a promoted draft holds its push until releasePush, then pushes what was typed once", async () => {
    const { runtime, pushUpdates } = fakeRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.openDraft("d3");
    await session.booted;
    type(session.doc, "first");
    await engine.promoteDraft("d3");
    type(session.doc, " second");
    await settle();
    // The create hasn't landed: nothing may push yet.
    expect(pushUpdates).not.toHaveBeenCalled();
    await engine.wake();
    await settle();
    expect(pushUpdates).not.toHaveBeenCalled();

    engine.releasePush("d3");
    await settle();
    expect(pushUpdates).toHaveBeenCalledTimes(1);
    const call = pushUpdates.mock.calls[0][0] as unknown as {
      noteId: string;
      bodyText: string;
    };
    expect(call.noteId).toBe("d3");
    expect(call.bodyText).toContain("first");
    expect(call.bodyText).toContain("second");
  });

  it("promote and release are idempotent; a second promote queues nothing new", async () => {
    const { runtime, pushUpdates } = fakeRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.openDraft("d4");
    await session.booted;
    type(session.doc, "x");
    await engine.promoteDraft("d4");
    await engine.promoteDraft("d4");
    engine.releasePush("d4");
    engine.releasePush("d4");
    await settle();
    expect(pushUpdates).toHaveBeenCalledTimes(1);
    expect((pushUpdates.mock.calls[0][0] as { updates: unknown[] }).updates).toHaveLength(1);
  });

  it("a refused create reverts to a draft: its queue is dropped and later typing stays local", async () => {
    const { runtime, pushUpdates } = fakeRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.openDraft("d5");
    await session.booted;
    type(session.doc, "kept on screen");
    await engine.promoteDraft("d5");
    await engine.revertToDraft("d5");
    type(session.doc, " and more");
    expect(engine.isDraft("d5")).toBe(true);
    engine.releasePush("d5"); // no-op: it is no longer held
    await engine.wake();
    await settle();
    expect(pushUpdates).not.toHaveBeenCalled();
  });
});
