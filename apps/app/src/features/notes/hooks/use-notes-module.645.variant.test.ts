// HV-15 variant of benchmarks/escapes/645-1-queue-bypass: "Delete forever" calls
// `notesV2.purge` live, past the meta outbox. A sub-note restored while the
// network was gone (its restore still waiting there) is still under its
// trashed parent on the server, so purging the parent deletes it for good, and
// the queued restore then finds nothing. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/notes/hooks/use-notes-module.645.variant.test.ts

import { afterEach, describe, expect, it, rs } from "@rstest/core";
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

const WS = "ws-645-v";
const TRASHED_AT = "2026-11-20T10:00:00.000Z";

afterEach(() => {
  outbox.rows = [];
});

type Row = ReturnType<typeof note>;

function note(id: string, title: string, parentId: string | null) {
  const at = "2026-11-01T10:00:00.000Z";
  return {
    id,
    workspaceId: WS,
    createdBy: "user-645-v",
    parentId,
    title,
    icon: null,
    position: "a0",
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: at,
    updatedAt: at,
    deletedAt: TRASHED_AT as string | null,
    shareMode: "custom",
    workspaceShared: false,
    inInbox: false,
    fullWidth: false,
  };
}

/**
 * The server as notes_op_restore / notes_op_purge treat it: a restore of a
 * sub-note whose parent is still trashed re-roots it; a purge deletes the
 * note's whole subtree by parent.
 */
function fixture() {
  window.localStorage.setItem(`moduo:notes:welcome-seeded:v1:${WS}`, "done");
  const net = { restores: false, purges: false };
  const server = new Map<string, Row>([
    ["p1", note("p1", "Project", null)],
    ["c1", note("c1", "Meeting notes", "p1")],
  ]);
  const subtree = (id: string): string[] => [
    id,
    ...[...server.values()].filter((n) => n.parentId === id).flatMap((n) => subtree(n.id)),
  ];
  const runtime = {
    notesV2: {
      listMeta: async () => ({ notes: [...server.values()], degraded: false, truncated: [] }),
      listFavorites: async () => [],
      purgeExpired: async () => ({ count: 0 }),
      create: async () => ({}),
      restore: async (args: { noteId: string }) => {
        if (!net.restores) throw new TypeError("Failed to fetch");
        const n = server.get(args.noteId);
        if (!n?.deletedAt) throw new Error("This note is not in the trash.");
        for (const id of subtree(n.id)) {
          const row = server.get(id)!;
          server.set(id, { ...row, deletedAt: null });
        }
        const parent = n.parentId ? server.get(n.parentId) : null;
        if (n.parentId && (!parent || parent.deletedAt)) {
          server.set(n.id, { ...server.get(n.id)!, parentId: null });
        }
        return { restoredIds: subtree(n.id), count: 1 };
      },
      purge: async (args: { noteId: string }) => {
        if (!net.purges) throw new TypeError("Failed to fetch");
        const n = server.get(args.noteId);
        if (!n?.deletedAt) throw new Error("Only trashed notes can be deleted forever.");
        const ids = subtree(n.id);
        for (const id of ids) server.delete(id);
        return { count: ids.length };
      },
      pullDoc: async () => ({ snapshotB64: null, docVersion: 0, updates: [] }),
      pushUpdates: async () => ({ inserted: 0 }),
    },
  } as unknown as ModuoRuntime;
  const hook = renderHook(() =>
    useNotesModule(runtime, { userId: "user-645-v", workspaceId: WS, modulePermission: "edit" }),
  );
  return { net, server, hook };
}

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 645-1: Delete forever goes live past a queued restore", () => {
  it("a sub-note restored offline survives its parent being deleted forever once back online", async () => {
    const { net, server, hook } = fixture();
    const { result, unmount } = hook;
    try {
      await waitFor(() =>
        expect(result.current.notes.map((n) => n.id).sort()).toEqual(["c1", "p1"]),
      );

      // Offline: the person opens the trashed sub-note and restores it. It
      // shows restored at once and the restore waits in the meta outbox.
      act(() => {
        result.current.restoreNote("c1");
      });
      await waitFor(() => expect(outbox.rows.length).toBe(1));
      expect(result.current.notes.find((n) => n.id === "c1")?.deletedAt).toBe(null);

      // The network is back; before the next wake replays the queue, the
      // person empties the parent from the trash ("Delete forever").
      net.restores = net.purges = true;
      await act(async () => {
        await result.current.purgeNote("p1");
      });
      // The next wake (reconnect, refocus) replays anything left.
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await waitFor(() => expect(outbox.rows.length).toBe(0));

      expect(server.has("p1")).toBe(false);
      // The note the person brought back is still there, out of the trash.
      expect(server.get("c1")?.deletedAt ?? "gone").toBe(null);
    } finally {
      unmount();
    }
  });
});
