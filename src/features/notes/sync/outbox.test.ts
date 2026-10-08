import { describe, expect, it } from "@rstest/core";
import type { DocOutboxEntry } from "./idb";
import {
  ackedKeys,
  advanceCursor,
  assignSeq,
  emptyNoteState,
  planPushBatch,
  shouldCompact,
  toPushPayload,
} from "./outbox";

function entry(clientSeq: number, key?: number): DocOutboxEntry {
  return {
    key,
    workspaceId: "ws1",
    noteId: "n1",
    clientSeq,
    updateB64: `u${clientSeq}`,
    queuedAt: 1000 + clientSeq,
  };
}

describe("doc outbox (AC6 — idempotent replay)", () => {
  it("replaying the same queue produces a byte-identical push payload", () => {
    const queue = [entry(3, 30), entry(1, 10), entry(2, 20)];
    const first = toPushPayload(planPushBatch(queue));
    const second = toPushPayload(planPushBatch([...queue].reverse()));
    expect(first).toEqual(second);
    expect(first).toEqual([
      { clientSeq: 1, updateB64: "u1" },
      { clientSeq: 2, updateB64: "u2" },
      { clientSeq: 3, updateB64: "u3" },
    ]);
    // A replay after a failed push never re-assigns seqs — the server's
    // (note_id, client_id, client_seq) unique key dedupes content.
  });

  it("caps the batch but keeps strict seq order", () => {
    const queue = Array.from({ length: 100 }, (_, i) => entry(100 - i, i));
    const batch = planPushBatch(queue, 64);
    expect(batch).toHaveLength(64);
    expect(batch[0]!.clientSeq).toBe(1);
    expect(batch[63]!.clientSeq).toBe(64);
  });

  it("acks only persisted entries (with IDB keys)", () => {
    expect(ackedKeys([entry(1, 11), entry(2), entry(3, 13)])).toEqual([11, 13]);
  });

  it("assigns strictly monotonic seqs across a simulated reload", () => {
    let state = emptyNoteState("n1");
    const a = assignSeq(state);
    state = a.next;
    const b = assignSeq(state);
    state = b.next;
    // "reload": state round-trips through persistence unchanged
    const reloaded = { ...state };
    const c = assignSeq(reloaded);
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
  });
});

describe("pull cursor", () => {
  it("advances only from pulled ids, never backwards", () => {
    let state = { ...emptyNoteState("n1"), lastPulledUpdateId: 50 };
    state = advanceCursor(state, [48, 49]); // stale ids can't rewind
    expect(state.lastPulledUpdateId).toBe(50);
    state = advanceCursor(state, [51, 53, 52]);
    expect(state.lastPulledUpdateId).toBe(53);
  });

  it("no pulled ids → untouched state (a push response must not move it)", () => {
    const state = { ...emptyNoteState("n1"), lastPulledUpdateId: 7 };
    expect(advanceCursor(state, [])).toBe(state);
  });

  it("compaction triggers once the log grows past the threshold", () => {
    const state = emptyNoteState("n1");
    expect(shouldCompact({ ...state, updatesSinceCompact: 39 })).toBe(false);
    expect(shouldCompact({ ...state, updatesSinceCompact: 40 })).toBe(true);
  });
});
