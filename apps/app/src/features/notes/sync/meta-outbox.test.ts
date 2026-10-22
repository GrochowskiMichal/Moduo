import { describe, expect, it } from "@rstest/core";

import type { MetaOutboxEntry } from "./idb";
import {
  callMetaOp,
  isDuplicateKeyError,
  isNetworkError,
  replayDecision,
  replayOrder,
} from "./meta-outbox";

function entry(kind: MetaOutboxEntry["kind"], queuedAt: number, key?: number): MetaOutboxEntry {
  return { key, workspaceId: "ws1", kind, args: {}, queuedAt };
}

describe("meta outbox replay decisions (AC6)", () => {
  it("classifies network failures as retry-later (queue survives intact)", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("Load failed"))).toBe(true); // WebKit
    expect(isNetworkError(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(replayDecision(entry("rename", 1), new TypeError("Failed to fetch"))).toBe(
      "retry-later",
    );
  });

  it("treats a replayed create hitting the PK as already-applied", () => {
    const err = new Error('duplicate key value violates unique constraint "notes_pkey"');
    expect(isDuplicateKeyError(err)).toBe(true);
    expect(replayDecision(entry("create", 1), err)).toBe("applied");
  });

  it("drops server rejections so one poison op can't wedge the queue", () => {
    expect(
      replayDecision(entry("move", 1), new Error("A note cannot be moved into its own subtree.")),
    ).toBe("drop");
    // …but the same rejection on a create-dup is NOT a drop (handled above)
    expect(replayDecision(entry("rename", 1), new Error("You do not have edit access"))).toBe(
      "drop",
    );
  });

  it("success clears the entry", () => {
    expect(replayDecision(entry("archive", 1), null)).toBe("applied");
  });

  it("replays strictly FIFO by queue time then insertion key", () => {
    const order = replayOrder([entry("move", 5, 2), entry("create", 1, 1), entry("rename", 5, 1)]);
    expect(order.map((e) => e.kind)).toEqual(["create", "rename", "move"]);
  });
});

describe("file + favorite replay (NR-1, AC2/AC3)", () => {
  function fakeRuntime() {
    const calls: string[] = [];
    const op = (name: string) => async (args: any) => {
      calls.push(`${name}:${JSON.stringify(args)}`);
      return {};
    };
    const notesV2 = new Proxy({}, { get: (_t, name: string) => op(name) });
    return { calls, rt: { notesV2 } as any };
  }

  it("dispatches the new kinds to fileNote / setFavorite", async () => {
    const { calls, rt } = fakeRuntime();
    await callMetaOp(rt, "file", { noteId: "n1", inInbox: false });
    await callMetaOp(rt, "setFavorite", { noteId: "n1", value: true });
    expect(calls).toEqual([
      'fileNote:{"noteId":"n1","inInbox":false}',
      'setFavorite:{"noteId":"n1","value":true}',
    ]);
  });

  it("replays a queued create → file → favorite in queue order, once each", async () => {
    const { calls, rt } = fakeRuntime();
    const queued = replayOrder([
      { ...entry("setFavorite", 3, 3), args: { noteId: "n1", value: true } },
      { ...entry("create", 1, 1), args: { id: "n1" } },
      { ...entry("file", 2, 2), args: { noteId: "n1", inInbox: false } },
    ]);
    for (const e of queued) {
      expect(replayDecision(e, null)).toBe("applied");
      await callMetaOp(rt, e.kind, e.args);
    }
    expect(calls.map((c) => c.split(":")[0])).toEqual(["create", "fileNote", "setFavorite"]);
  });

  it("replaying the same file/favorite twice (lost response) leaves one result", async () => {
    // A set-to-value server, like notes_op_file / notes_op_set_favorite: the
    // SQL rehearsal (docs/testing/2026-W42/nr-1) shows a re-add keeps the row
    // and its position, and re-filing writes no second activity row.
    const inbox = new Map<string, boolean>();
    const favorites = new Map<string, string>();
    const rt = {
      notesV2: {
        fileNote: async (a: any) => void inbox.set(a.noteId, a.inInbox),
        setFavorite: async (a: any) =>
          a.value
            ? void favorites.set(a.noteId, favorites.get(a.noteId) ?? a.position ?? "a0")
            : void favorites.delete(a.noteId),
      },
    } as any;
    const file = { ...entry("file", 1, 1), args: { noteId: "n1", inInbox: false } };
    const fav = {
      ...entry("setFavorite", 2, 2),
      args: { noteId: "n1", value: true, position: "b" },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const e of replayOrder([fav, file])) await callMetaOp(rt, e.kind, e.args);
    }
    expect([...inbox]).toEqual([["n1", false]]);
    expect([...favorites]).toEqual([["n1", "b"]]);
  });

  it("keeps a file/favorite queued on a network failure and drops a refusal", () => {
    expect(replayDecision(entry("file", 1), new TypeError("Failed to fetch"))).toBe("retry-later");
    expect(replayDecision(entry("setFavorite", 1), new Error("Note not found"))).toBe("drop");
  });
});
