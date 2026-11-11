// HV-15 variant of benchmarks/escapes/645-1-queue-bypass: Notes' Duplicate
// calls `notesV2.duplicate` live, past the meta outbox, so a rename of the
// source still waiting there (queued while the network was gone) isn't on the
// server yet and the copy carries the old title. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/notes/hooks/use-notes-module.645-1.variant.test.ts

import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
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

import { useNotesModule } from "./use-notes-module";

const WS = "ws-645-1";
const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

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

hunt("HV-15 variant 645-1: Duplicate goes live past the source's queued meta ops", () => {
  it("a note renamed offline, then duplicated once back online, is copied with its new title", async () => {
    window.localStorage.setItem(`moduo:notes:welcome-seeded:v1:${WS}`, "done");
    let networkUp = false;
    const server = new Map([["n1", note("n1", "Plan")]]);
    const offline = () => {
      if (!networkUp) throw new TypeError("Failed to fetch");
    };
    const runtime = {
      notesV2: {
        listMeta: async () => ({ notes: [...server.values()], degraded: false, truncated: [] }),
        listFavorites: async () => [],
        purgeExpired: async () => ({ count: 0 }),
        create: async () => ({}),
        rename: async (args: { noteId: string; title: string }) => {
          offline();
          server.set(args.noteId, { ...server.get(args.noteId)!, title: args.title });
          return server.get(args.noteId);
        },
        duplicate: async (args: { sourceNoteId: string }) => {
          offline();
          const copy = { ...server.get(args.sourceNoteId)!, id: "n1-copy" };
          copy.title = `${copy.title} (copy)`;
          server.set(copy.id, copy);
          return copy;
        },
        pullDoc: async () => ({ snapshotB64: null, docVersion: 0, updates: [] }),
        pushUpdates: async () => ({ inserted: 0 }),
      },
    } as unknown as ModuoRuntime;

    const { result, unmount } = renderHook(() =>
      useNotesModule(runtime, { userId: "user-645-1", workspaceId: WS, modulePermission: "edit" }),
    );
    try {
      await waitFor(() => expect(result.current.notes.map((n) => n.title)).toEqual(["Plan"]));

      // Offline: the rename shows at once and waits in the meta outbox.
      act(() => {
        result.current.renameNote("n1", "Q4 plan");
      });
      await waitFor(() => expect(outbox.rows.length).toBe(1));

      // The network is back; before the next wake replays the queue, the
      // person duplicates the note they see titled "Q4 plan".
      networkUp = true;
      let copyId: string | null = null;
      await act(async () => {
        copyId = await result.current.duplicateNote("n1");
      });
      // The next wake (reconnect, refocus) replays the rename.
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await waitFor(() => expect(outbox.rows.length).toBe(0));

      expect(server.get("n1")?.title).toBe("Q4 plan");
      // The copy is of the note as the person left it.
      expect(server.get(copyId ?? "")?.title).toBe("Q4 plan (copy)");
    } finally {
      unmount();
    }
  });
});
