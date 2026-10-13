// NR-3 · the honest provider. jsdom has no IndexedDB, so y-indexeddb is
// stubbed (its cache "loads" at once) and the runtime's pull is held open by
// hand, to watch what the session reports while the pull is in flight:
//   - the cache is ready (the editor may mount and type) before the pull lands;
//   - Lexical hears `sync` only after the first pull has settled;
//   - the session counts as synced only when a pull succeeded.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import * as Y from "yjs";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { NotesSyncEngineV2 } from "./engine-v2";

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

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A runtime whose pulls wait until the test settles them (settling before
 * the pull starts is remembered). */
function heldPullRuntime() {
  let outcome: "ok" | "offline" | null = null;
  const waiting: Array<() => void> = [];
  const pullDoc = rs.fn(async () => {
    if (!outcome) await new Promise<void>((resolve) => waiting.push(resolve));
    if (outcome === "offline") throw new Error("Failed to fetch");
    return { snapshotB64: null, docVersion: 0, updates: [] };
  });
  const pushUpdates = rs.fn(async () => ({ inserted: 0 }));
  const runtime = { notesV2: { pullDoc, pushUpdates } } as unknown as ModuoRuntime;
  const settle = (o: "ok" | "offline") => {
    outcome = o;
    for (const resolve of waiting.splice(0)) resolve();
  };
  return { runtime, settle };
}

let engine: NotesSyncEngineV2 | null = null;
afterEach(async () => {
  await engine?.destroy();
  engine = null;
});

describe("honest provider (NR-3)", () => {
  it("the cache is ready before the pull lands; `sync` waits for the pull", async () => {
    const { runtime, settle } = heldPullRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.getOrCreateSession("n1");
    const onSync = rs.fn();
    session.provider.on("sync", onSync);

    await session.cacheReady;
    await tick();
    expect(onSync).not.toHaveBeenCalled();
    expect(engine.isSynced("n1")).toBe(false);

    settle("ok");
    await session.booted;
    expect(onSync).toHaveBeenCalledWith(true);
    expect(engine.isSynced("n1")).toBe(true);
  });

  it("a late subscriber hears `sync` straight away once it was reported", async () => {
    const { runtime, settle } = heldPullRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.getOrCreateSession("n2");
    settle("ok");
    await session.booted;
    const late = rs.fn();
    session.provider.on("sync", late);
    await tick();
    expect(late).toHaveBeenCalledWith(true);
  });

  it("an offline first pull still lets the editor bootstrap, but is not synced", async () => {
    const { runtime, settle } = heldPullRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.getOrCreateSession("n3");
    const onSync = rs.fn();
    session.provider.on("sync", onSync);
    const statuses: string[] = [];
    engine.onStatus((s) => statuses.push(s));

    settle("offline");
    await session.booted;
    expect(onSync).toHaveBeenCalledWith(true);
    expect(engine.isSynced("n3")).toBe(false);
    expect(statuses.at(-1)).toBe("offline");
  });

  it("a draft reports `sync` without ever pulling", async () => {
    const { runtime } = heldPullRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.openDraft("d1");
    const onSync = rs.fn();
    session.provider.on("sync", onSync);
    await session.booted;
    await tick();
    expect(onSync).toHaveBeenCalledWith(true);
    expect(runtime.notesV2.pullDoc).not.toHaveBeenCalled();
  });

  it("a save during the first pull pushes the update but no body (no stale body_md)", async () => {
    const { runtime, settle } = heldPullRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.getOrCreateSession("n4");
    await session.cacheReady;
    const root = session.doc.get("root-v2", Y.XmlElement);
    const run = new Y.XmlText();
    run.insert(0, "typed before the pull");
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [run]);
    root.insert(0, [p]);
    await engine.flushNote("n4");
    const push = runtime.notesV2.pushUpdates as unknown as { mock: { calls: unknown[][] } };
    expect(push.mock.calls.length).toBeGreaterThan(0);
    expect(push.mock.calls[0]![0]).toMatchObject({ bodyText: null, bodyMd: null });
    settle("ok");
    await session.booted;
  });
});
