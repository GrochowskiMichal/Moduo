// Regression test for the Notes Duplicate variant of
// benchmarks/escapes/645-1-queue-bypass (found by the HV-15 variant hunt).
// Duplicate called `notesV2.duplicate` live, past the meta outbox, so a rename
// of the source still waiting there (queued while the network was gone) wasn't
// on the server yet and the copy carried the old title. Duplicate now takes
// its turn on the engine's meta chain (`runAfterQueued`): behind an older op
// still on its way, after the meta outbox is replayed and the source's queued
// edits are pushed, and it refuses while any of that still waits.
// Run: bun run --cwd apps/app test src/features/notes/hooks/use-notes-module.645-1.test.ts

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { NotesStillSyncingError, NotesSyncEngineV2 } from "../sync/engine-v2";
import * as actualIdb from "../sync/idb" with { rstest: "importActual" };

rs.mock("sonner", () => ({ toast: Object.assign(rs.fn(), { error: rs.fn() }) }));
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
rs.mock("../sync/redb-import", () => ({ runRedbImportOnce: async () => null }));
rs.mock("../repair", () => ({
  repairNote: async () => "skipped",
  repairUnmaterializedNotes: async () => ({ seeded: 0, failed: 0 }),
}));

// jsdom has no IndexedDB: the device stores are kept in memory (the boundary);
// the engine's queue logic and the hook run as written.
const outbox = rs.hoisted(() => ({ rows: [] as { key: number; [k: string]: unknown }[], next: 1 }));
rs.mock("../sync/idb", () => ({
  ...actualIdb,
  openNotesDb: async () => null,
  readMetaCache: async () => null,
  writeMetaCache: async () => {},
  listDocOutboxNoteIds: async () => [],
  enqueueMetaOp: async (owner: { userId: string; workspaceId: string }, entry: object) => {
    outbox.rows.push({ ...entry, ...owner, key: outbox.next++ });
  },
  readMetaOutbox: async () => outbox.rows.map((r) => ({ ...r })),
  deleteMetaOutboxEntries: async (keys: number[]) => {
    outbox.rows = outbox.rows.filter((r) => !keys.includes(r.key));
  },
}));

import { toast } from "sonner";

import { useNotesModule } from "./use-notes-module";

const WS = "ws-645-1";

afterEach(() => {
  outbox.rows = [];
});

function note(id: string, title: string) {
  const at = "2026-10-30T10:00:00.000Z";
  return {
    id,
    workspaceId: WS,
    createdBy: "user-645-1",
    parentId: null,
    title,
    icon: null,
    position: "a0",
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    shareMode: "custom",
    workspaceShared: false,
    inInbox: true,
    fullWidth: false,
  };
}

/** A server with note n1 ("Plan"); `net.renames` / `net.duplicates` play the network per op. */
function fixture() {
  window.localStorage.setItem(`moduo:notes:welcome-seeded:v1:${WS}`, "done");
  const net = { renames: false, duplicates: false };
  const server = new Map([["n1", note("n1", "Plan")]]);
  let holdRename: Promise<void> | null = null;
  const runtime = {
    notesV2: {
      listMeta: async () => ({ notes: [...server.values()], degraded: false, truncated: [] }),
      listFavorites: async () => [],
      purgeExpired: async () => ({ count: 0 }),
      create: async () => ({}),
      rename: async (args: { noteId: string; title: string }) => {
        if (!net.renames) throw new TypeError("Failed to fetch");
        if (holdRename) await holdRename;
        server.set(args.noteId, { ...server.get(args.noteId)!, title: args.title });
        return server.get(args.noteId);
      },
      duplicate: async (args: { sourceNoteId: string }) => {
        if (!net.duplicates) throw new TypeError("Failed to fetch");
        const copy = { ...server.get(args.sourceNoteId)!, id: "n1-copy" };
        copy.title = `${copy.title} (copy)`;
        server.set(copy.id, copy);
        return copy;
      },
      pullDoc: async () => ({ snapshotB64: null, docVersion: 0, updates: [] }),
      pushUpdates: async () => ({ inserted: 0 }),
    },
  } as unknown as ModuoRuntime;
  const hook = renderHook(() =>
    useNotesModule(runtime, { userId: "user-645-1", workspaceId: WS, modulePermission: "edit" }),
  );
  const hold = () => {
    let release!: () => void;
    holdRename = new Promise((r) => (release = r));
    return release;
  };
  return { net, server, hook, hold };
}

describe("645-1 (Notes Duplicate): a copy is of the note as the person sees it", () => {
  it("a note renamed offline, then duplicated once back online, is copied with its new title", async () => {
    const { net, server, hook } = fixture();
    const { result, unmount } = hook;
    try {
      await waitFor(() => expect(result.current.notes.map((n) => n.title)).toEqual(["Plan"]));

      // Offline: the rename shows at once and waits in the meta outbox.
      act(() => {
        result.current.renameNote("n1", "Q4 plan");
      });
      await waitFor(() => expect(outbox.rows.length).toBe(1));

      // The network is back; before the next wake replays the queue, the
      // person duplicates the note they see titled "Q4 plan".
      net.renames = net.duplicates = true;
      let copyId: string | null = null;
      await act(async () => {
        copyId = await result.current.duplicateNote("n1");
      });
      // The next wake (reconnect, refocus) replays anything left.
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await waitFor(() => expect(outbox.rows.length).toBe(0));

      expect(server.get("n1")?.title).toBe("Q4 plan");
      // The copy is of the note as the person left it.
      expect(copyId).toBe("n1-copy");
      expect(server.get("n1-copy")?.title).toBe("Q4 plan (copy)");
    } finally {
      unmount();
    }
  });

  it("a rename still on its way lands before the copy is made", async () => {
    const { net, server, hook, hold } = fixture();
    const { result, unmount } = hook;
    try {
      await waitFor(() => expect(result.current.notes.map((n) => n.title)).toEqual(["Plan"]));
      net.renames = net.duplicates = true;
      const release = hold();
      act(() => {
        result.current.renameNote("n1", "Q4 plan");
      });
      // Nothing is queued: the rename is live, its answer not back yet.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(outbox.rows.length).toBe(0);
      let copy: Promise<string | null> = Promise.resolve(null);
      act(() => {
        copy = result.current.duplicateNote("n1");
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(server.has("n1-copy")).toBe(false);
      release();
      let copyId: string | null = null;
      await act(async () => {
        copyId = await copy;
      });
      expect(server.get(copyId ?? "")?.title).toBe("Q4 plan (copy)");
    } finally {
      unmount();
    }
  });

  it("while the rename still can't reach the server, no copy is made from the old title", async () => {
    const { net, server, hook } = fixture();
    const { result, unmount } = hook;
    try {
      await waitFor(() => expect(result.current.notes.map((n) => n.title)).toEqual(["Plan"]));
      act(() => {
        result.current.renameNote("n1", "Q4 plan");
      });
      await waitFor(() => expect(outbox.rows.length).toBe(1));

      // The duplicate call itself would get through; the queued rename doesn't.
      net.duplicates = true;
      let copyId: string | null = "unset";
      await act(async () => {
        copyId = await result.current.duplicateNote("n1");
      });
      expect(copyId).toBe(null);
      expect(server.has("n1-copy")).toBe(false);
      expect(outbox.rows.length).toBe(1);
    } finally {
      unmount();
    }
  });
});

describe("Duplicate before the notes engine is up", () => {
  it("says it couldn't duplicate rather than doing nothing", async () => {
    rs.mocked(toast.error).mockClear();
    const { result, unmount } = renderHook(() =>
      useNotesModule(null, { userId: "user-645-1", workspaceId: WS, modulePermission: "edit" }),
    );
    try {
      let copyId: string | null = "unset";
      await act(async () => {
        copyId = await result.current.duplicateNote("n1");
      });
      expect(copyId).toBe(null);
      expect(toast.error).toHaveBeenCalledWith("Couldn't duplicate the note.");
    } finally {
      unmount();
    }
  });
});

describe("645-1 (Notes Duplicate): the source's queued edits go first", () => {
  let engine: NotesSyncEngineV2 | null = null;
  afterEach(async () => {
    await engine?.destroy();
    engine = null;
  });

  async function withQueuedEdit() {
    const calls: string[] = [];
    const net = { up: false };
    const runtime = {
      notesV2: {
        pullDoc: async () => ({ snapshotB64: null, docVersion: 0, updates: [] }),
        pushUpdates: async (args: { updates: unknown[] }) => {
          if (!net.up) throw new TypeError("Failed to fetch");
          if (args.updates.length > 0) calls.push("push");
          return { inserted: args.updates.length };
        },
      },
    } as unknown as ModuoRuntime;
    engine = new NotesSyncEngineV2(runtime, WS, undefined, "user-645-1");
    const session = engine.getOrCreateSession("n1");
    await session.booted;
    // An edit made offline waits on the device.
    session.doc.getMap("probe").set("k", "typed offline");
    for (let i = 0; i < 50 && session.memOutbox.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(session.memOutbox.length).toBe(1);
    return { engine, calls, net };
  }

  it("pushes the source's queued edits before it reads the note back", async () => {
    const { engine, calls, net } = await withQueuedEdit();
    net.up = true;
    await engine.runAfterQueued("n1", async () => {
      calls.push("duplicate");
    });
    expect(calls).toEqual(["push", "duplicate"]);
  });

  it("refuses while those edits still can't reach the server", async () => {
    const { engine, calls } = await withQueuedEdit();
    await expect(
      engine.runAfterQueued("n1", async () => {
        calls.push("duplicate");
      }),
    ).rejects.toBeInstanceOf(NotesStillSyncingError);
    expect(calls).toEqual([]);
  });
});
