// NR-3 · the honest provider. jsdom has no IndexedDB, so y-indexeddb is
// stubbed (its cache "loads" at once) and the runtime's pull is held open by
// hand, to watch what the session reports while the pull is in flight:
//   - the cache is ready (the editor may mount and type) before the pull lands;
//   - Lexical hears `sync` only after the first pull has settled;
//   - the session counts as synced only when a pull succeeded.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import * as Y from "yjs";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { applyAgentEdit } from "../editor/agent-write";
import { deriveNoteBody, NOTES_DOC_ROOT } from "../editor/doc-markdown";
import { buildDocStateFromMarkdown } from "../editor/materialize";
import { encodeUint8ToBase64 } from "../utils/base64";
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
    // Once the pull lands, the body owed goes out on its own (no updates).
    await new Promise((resolve) => setTimeout(resolve, 50));
    const last = push.mock.calls.at(-1)![0] as { updates: unknown[]; bodyMd: string | null };
    expect(last.updates).toEqual([]);
    expect(last.bodyMd).toBe("typed before the pull");
  });

  it("a draft is synced from the start, so its first push carries its body", async () => {
    const { runtime } = heldPullRuntime();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.openDraft("d2");
    await session.booted;
    expect(engine.isSynced("d2")).toBe(true);
    const root = session.doc.get("root-v2", Y.XmlElement);
    const run = new Y.XmlText();
    run.insert(0, "capture");
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [run]);
    root.insert(0, [p]);
    await engine.promoteDraft("d2");
    engine.releasePush("d2");
    await engine.flushNote("d2");
    const push = runtime.notesV2.pushUpdates as unknown as { mock: { calls: unknown[][] } };
    expect(push.mock.calls.at(-1)![0]).toMatchObject({ bodyMd: "capture" });
  });
});

describe("agent writes reach an open note (NR-6)", () => {
  function agentScenario() {
    const base = buildDocStateFromMarkdown("n9", "# Plan\n\nHello")!;
    const server = new Y.Doc();
    server.get(NOTES_DOC_ROOT, Y.XmlElement);
    Y.applyUpdate(server, Uint8Array.from(Buffer.from(base.docStateB64, "base64")));
    const before = Y.encodeStateVector(server);
    applyAgentEdit(server, { kind: "append", markdown: "From the agent" });
    const agentRow = {
      id: 7,
      clientId: "agent:x",
      clientSeq: 1,
      updateB64: encodeUint8ToBase64(Y.encodeStateAsUpdate(server, before)),
      origin: "agent",
      actorKeyId: "key-1",
    };
    let rows: (typeof agentRow)[] = [];
    const pullDoc = rs.fn(async () => ({
      snapshotB64: base.docStateB64,
      docVersion: 1,
      updates: rows,
    }));
    const pushUpdates = rs.fn(async (_input: { updates: unknown[]; bodyMd?: string | null }) => ({
      inserted: 1,
      duplicates: 0,
      maxUpdateId: 8,
    }));
    const runtime = { notesV2: { pullDoc, pushUpdates } } as unknown as ModuoRuntime;
    return { runtime, pushUpdates, agentRow, setRows: (r: (typeof agentRow)[]) => (rows = r) };
  }

  it("a live agent row lands, is not pushed back, re-saves the merged body, and Undo reverts it", async () => {
    const { runtime, pushUpdates, agentRow, setRows } = agentScenario();
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.getOrCreateSession("n9");
    await session.booted;

    setRows([agentRow]);
    await engine.pullNote("n9");
    expect(deriveNoteBody(session.doc).md).toBe("# Plan\n\nHello\n\nFrom the agent");
    const undo = engine.agentUndo("n9")!;
    expect(undo.canUndo()).toBe(true);

    // The agent's update itself is never echoed; only an update-free body save.
    await engine.flushNote("n9");
    await tick();
    for (const [call] of pushUpdates.mock.calls) expect(call.updates).toEqual([]);
    expect(pushUpdates.mock.calls.at(-1)?.[0].bodyMd).toBe("# Plan\n\nHello\n\nFrom the agent");

    undo.undo();
    await tick();
    await engine.flushNote("n9");
    await tick();
    expect(deriveNoteBody(session.doc).md).toBe("# Plan\n\nHello");
    const last = pushUpdates.mock.calls.at(-1)?.[0];
    expect(last?.updates.length).toBeGreaterThan(0);
    expect(last?.bodyMd).toBe("# Plan\n\nHello");
  });

  it("agent rows in the first pull are history: shown, never offered for Undo", async () => {
    const { runtime, agentRow, setRows } = agentScenario();
    setRows([agentRow]);
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.getOrCreateSession("n9");
    await session.booted;
    expect(deriveNoteBody(session.doc).md).toBe("# Plan\n\nHello\n\nFrom the agent");
    expect(engine.agentUndo("n9")!.canUndo()).toBe(false);
  });
});
