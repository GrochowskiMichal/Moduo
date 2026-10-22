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
      origin: "api_key",
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

    // A view-only session (no local edits) never re-saves a body.
    setRows([agentRow]);
    await engine.pullNote("n9");
    await tick();
    await engine.flushNote("n9");
    expect(pushUpdates).not.toHaveBeenCalled();
    expect(deriveNoteBody(session.doc).md).toBe("# Plan\n\nHello\n\nFrom the agent");
    const undo = engine.agentUndo("n9")!;
    expect(undo.canUndo()).toBe(true);

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

describe("agent body re-save (NR-6)", () => {
  it("an editing session re-saves the merged body after an agent write, without echoing it", async () => {
    const base = buildDocStateFromMarkdown("n8", "# Plan\n\nHello")!;
    const server = new Y.Doc();
    server.get(NOTES_DOC_ROOT, Y.XmlElement);
    Y.applyUpdate(server, Uint8Array.from(Buffer.from(base.docStateB64, "base64")));
    const before = Y.encodeStateVector(server);
    applyAgentEdit(server, { kind: "append", markdown: "From the agent" });
    const agentB64 = encodeUint8ToBase64(Y.encodeStateAsUpdate(server, before));
    let rows: unknown[] = [];
    const pullDoc = rs.fn(async () => ({
      snapshotB64: base.docStateB64,
      docVersion: 1,
      updates: rows,
    }));
    const pushUpdates = rs.fn(async (_i: { updates: unknown[]; bodyMd?: string | null }) => ({
      inserted: 1,
      duplicates: 0,
      maxUpdateId: 9,
    }));
    engine = new NotesSyncEngineV2(
      { notesV2: { pullDoc, pushUpdates } } as unknown as ModuoRuntime,
      "ws1",
    );
    const session = engine.getOrCreateSession("n8");
    await session.booted;
    applyAgentEdit(session.doc, { kind: "append", markdown: "Mine" });
    await tick();
    await engine.flushNote("n8");
    const localPushes = pushUpdates.mock.calls.length;
    expect(localPushes).toBeGreaterThan(0);

    rows = [
      {
        id: 8,
        clientId: "agent:y",
        clientSeq: 1,
        updateB64: agentB64,
        origin: "api_key",
        actorKeyId: "k",
      },
    ];
    await engine.pullNote("n8");
    await new Promise((r) => setTimeout(r, 1700));
    await engine.flushNote("n8");
    const later = pushUpdates.mock.calls.slice(localPushes).map(([c]) => c);
    expect(later.length).toBeGreaterThan(0);
    for (const c of later) expect(c.updates).toEqual([]);
    expect(later.at(-1)?.bodyMd).toContain("From the agent");
    expect(later.at(-1)?.bodyMd).toContain("Mine");
  });
});

describe("compaction against a newer snapshot", () => {
  it("is refused when another client folded since the pull, then pulls and folds on top", async () => {
    let serverVersion = 3;
    const pullDoc = rs.fn(async () => ({
      snapshotB64: null,
      docVersion: serverVersion,
      updates: [],
    }));
    const pushUpdates = rs.fn(async () => ({ inserted: 0 }));
    const saveSnapshot = rs.fn(
      async ({ expectedDocVersion }: { expectedDocVersion?: number | null }) => {
        if (expectedDocVersion !== serverVersion) {
          return { folded: 0, docVersion: serverVersion, refused: true };
        }
        serverVersion += 1;
        return { folded: 5, docVersion: serverVersion, refused: false };
      },
    );
    const runtime = { notesV2: { pullDoc, pushUpdates, saveSnapshot } } as unknown as ModuoRuntime;
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.getOrCreateSession("c1");
    await session.booted;
    // biome-ignore lint/suspicious/noExplicitAny: driving the private fold directly
    const internal = engine as any;
    const s = internal.sessions.get("c1");
    s.state = { ...s.state, updatesSinceCompact: 50 };

    // Another client folds between our compaction's pull and its save.
    pullDoc.mockImplementationOnce(async () => {
      const res = { snapshotB64: null, docVersion: serverVersion, updates: [] };
      serverVersion += 1;
      return res;
    });
    await internal.compact(s);
    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    expect(saveSnapshot.mock.calls[0]![0]).toMatchObject({ expectedDocVersion: 3 });
    // Refused: we pulled the newer snapshot and still owe a fold.
    expect(s.docVersion).toBe(4);
    expect(s.state.updatesSinceCompact).toBe(50);

    await internal.compact(s);
    expect(saveSnapshot).toHaveBeenCalledTimes(2);
    expect(saveSnapshot.mock.calls[1]![0]).toMatchObject({ expectedDocVersion: 4 });
    expect(s.docVersion).toBe(5);
    expect(s.state.updatesSinceCompact).toBe(0);
  });

  it("never folds while no pull has told it the server's version", async () => {
    const pullDoc = rs.fn(async () => {
      throw new Error("Failed to fetch");
    });
    const pushUpdates = rs.fn(async () => ({ inserted: 0 }));
    const saveSnapshot = rs.fn(async () => ({ folded: 0, docVersion: 1, refused: false }));
    const runtime = { notesV2: { pullDoc, pushUpdates, saveSnapshot } } as unknown as ModuoRuntime;
    engine = new NotesSyncEngineV2(runtime, "ws1");
    const session = engine.getOrCreateSession("c2");
    await session.booted;
    // biome-ignore lint/suspicious/noExplicitAny: driving the private fold directly
    const internal = engine as any;
    const s = internal.sessions.get("c2");
    s.state = { ...s.state, updatesSinceCompact: 50 };
    await internal.compact(s);
    expect(s.docVersion).toBeNull();
    expect(saveSnapshot).not.toHaveBeenCalled();
  });
});
