// HV-15 variant of benchmarks/escapes/509-2-outbox-overtaken: Notes'
// `runMetaOp` sends a rename (any meta op) straight to the server whenever it
// can, without looking at the meta outbox, so an older rename queued while the
// network was gone replays later (on the next wake) and wins over the newer
// one. Fixed in MOD-563; un-parked.
// Run: bun run --cwd apps/app test src/features/notes/sync/engine-v2.509-2.variant.test.ts

import { describe, expect, it, rs } from "@rstest/core";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import * as actualIdb from "./idb" with { rstest: "importActual" };

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

// jsdom has no IndexedDB: the meta outbox is kept in memory here (the device
// store is the boundary; the engine's own queue logic runs as written).
const outbox = rs.hoisted(() => ({ rows: [] as { key: number; [k: string]: unknown }[], next: 1 }));
rs.mock("./idb", () => {
  return {
    ...actualIdb,
    enqueueMetaOp: async (
      owner: { userId: string; workspaceId: string },
      entry: Record<string, unknown>,
    ) => {
      outbox.rows.push({
        ...entry,
        userId: owner.userId,
        workspaceId: owner.workspaceId,
        key: outbox.next++,
      });
    },
    readMetaOutbox: async () => outbox.rows.map((r) => ({ ...r })),
    deleteMetaOutboxEntries: async (keys: number[]) => {
      outbox.rows = outbox.rows.filter((r) => !keys.includes(r.key));
    },
  };
});

import { NotesSyncEngineV2 } from "./engine-v2";

describe("HV-15 variant 509-2-outbox-overtaken: a live Notes meta op jumps a queued one", () => {
  it("a rename made after an offline rename of the same note is the title that stays", async () => {
    let title = "Untitled";
    let networkUp = false;
    const rename = rs.fn(async (args: { noteId: string; title: string }) => {
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
    const engine = new NotesSyncEngineV2(runtime, "ws-509-2", undefined, "user-509-2");
    try {
      // Offline: the first rename waits in the meta outbox.
      expect(
        await engine.runMetaOp("rename", { workspaceId: "ws-509-2", noteId: "n1", title: "Draft" }),
      ).toBe("queued");
      // The network is back; before the next wake replays the queue, the
      // person renames the note again and it goes straight through.
      networkUp = true;
      await engine.runMetaOp("rename", { workspaceId: "ws-509-2", noteId: "n1", title: "Final" });
      // The next wake (reconnect, refocus) replays what waited.
      await engine.wake();
      // In the order they were made: the newer title is the one that stays.
      expect(title).toBe("Final");
    } finally {
      await engine.destroy();
    }
  });

  it("while the network stays gone, a newer op queues behind the waiting one without a live try", async () => {
    let title = "Untitled";
    let networkUp = false;
    const tried: string[] = [];
    const rename = rs.fn(async (args: { noteId: string; title: string }) => {
      tried.push(args.title);
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
    outbox.rows = [];
    const engine = new NotesSyncEngineV2(runtime, "ws-509-2", undefined, "user-509-2");
    try {
      const args = { workspaceId: "ws-509-2", noteId: "n1" };
      expect(await engine.runMetaOp("rename", { ...args, title: "Draft" })).toBe("queued");
      expect(await engine.runMetaOp("rename", { ...args, title: "Final" })).toBe("queued");
      // The second op only retried the waiting one; it never went out ahead of it.
      expect(tried).toEqual(["Draft", "Draft"]);
      expect(outbox.rows.map((r) => (r.args as { title: string }).title)).toEqual([
        "Draft",
        "Final",
      ]);
      networkUp = true;
      await engine.wake();
      expect(tried.slice(2)).toEqual(["Draft", "Final"]);
      expect(title).toBe("Final");
      expect(outbox.rows).toEqual([]);
    } finally {
      await engine.destroy();
    }
  });

  it("a newer op waits for an older one still on its way, even when that one then times out", async () => {
    let title = "Untitled";
    let releaseDraft: (() => void) | null = null;
    const rename = rs.fn(async (args: { noteId: string; title: string }) => {
      if (args.title === "Draft" && !releaseDraft) {
        // It lands, but its answer never comes back in time.
        title = args.title;
        await new Promise<void>((resolve) => {
          releaseDraft = resolve;
        });
        throw new Error("Request timed out");
      }
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
    outbox.rows = [];
    const engine = new NotesSyncEngineV2(runtime, "ws-509-2", undefined, "user-509-2");
    try {
      const args = { workspaceId: "ws-509-2", noteId: "n1" };
      const draft = engine.runMetaOp("rename", { ...args, title: "Draft" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const final = engine.runMetaOp("rename", { ...args, title: "Final" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      releaseDraft!();
      expect(await draft).toBe("queued");
      await final;
      await engine.wake();
      expect(title).toBe("Final");
      expect(outbox.rows).toEqual([]);
    } finally {
      await engine.destroy();
    }
  });
});
