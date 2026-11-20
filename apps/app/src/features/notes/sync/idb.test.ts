// Notes' caches are one person's (Track C4): the per-note documents and the
// notes list are keyed `<person>:<workspace>`, the pull cursor belongs to a
// person's document cache, and the client_seq counter stays the device's
// (the server dedupes on client id + seq, and the client id is the device's).

import { describe, expect, it } from "@rstest/core";

import { docDbName, parseDocDbName, stateFor, stripLegacy, withState } from "./idb";
import { isNetworkError, replayDecision } from "./meta-outbox";

const A = "user-a:ws-1";
const B = "user-b:ws-1";

describe("per-note document databases", () => {
  it("are named per person and workspace, and read back", () => {
    expect(docDbName(A, "note-1")).toBe("moduo:notes-v2:doc:user-a:ws-1:note-1");
    expect(parseDocDbName(docDbName(A, "note-1"))).toEqual({ owner: A, noteId: "note-1" });
  });

  it("tell a database from before Track C4 (nobody's) from a person's", () => {
    expect(parseDocDbName("moduo:notes-v2:doc:ws-1:note-1")).toEqual({
      legacyWorkspace: "ws-1",
      noteId: "note-1",
    });
    expect(parseDocDbName("moduo-notes-v2")).toBeNull();
    expect(parseDocDbName("moduo:notes-v2:doc:")).toBeNull();
  });
});

describe("a note's sync state", () => {
  it("keeps one seq counter per note and a cursor per person", () => {
    const afterA = withState(
      null,
      { noteId: "n", nextClientSeq: 4, lastPulledUpdateId: 90, updatesSinceCompact: 3 },
      A,
    );
    const afterB = withState(
      afterA,
      { noteId: "n", nextClientSeq: 6, lastPulledUpdateId: 0, updatesSinceCompact: 0 },
      B,
    );
    expect(afterB.nextClientSeq).toBe(6);
    expect(stateFor(afterB, "n", A)).toEqual({
      noteId: "n",
      nextClientSeq: 6,
      lastPulledUpdateId: 90,
      updatesSinceCompact: 3,
    });
    // Someone with no cursor of their own reads the note whole.
    expect(stateFor(afterB, "n", "user-c:ws-1")?.lastPulledUpdateId).toBe(0);
  });

  it("never moves the seq counter backwards (another engine may have taken seqs since)", () => {
    const stored = { noteId: "n", nextClientSeq: 12, cursors: {} };
    const written = withState(
      stored,
      { noteId: "n", nextClientSeq: 7, lastPulledUpdateId: 1, updatesSinceCompact: 0 },
      A,
    );
    expect(written.nextClientSeq).toBe(12);
  });

  it("never lends the device-wide cursor from before Track C4 to anyone", () => {
    const legacy = {
      noteId: "n",
      nextClientSeq: 9,
      lastPulledUpdateId: 500,
      updatesSinceCompact: 7,
    };
    expect(stateFor(legacy, "n", A)).toEqual({
      noteId: "n",
      nextClientSeq: 9,
      lastPulledUpdateId: 0,
      updatesSinceCompact: 0,
    });
    expect(stripLegacy(legacy)).toEqual({ noteId: "n", nextClientSeq: 9 });
    const written = withState(
      legacy,
      { noteId: "n", nextClientSeq: 10, lastPulledUpdateId: 3, updatesSinceCompact: 0 },
      A,
    );
    expect(written).toEqual({
      noteId: "n",
      nextClientSeq: 10,
      cursors: { [A]: { lastPulledUpdateId: 3, updatesSinceCompact: 0 } },
    });
  });
});

describe("Notes' network check", () => {
  it("is the shared one plus Notes' own words: a timeout keeps a queued op", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("The network connection was lost."))).toBe(true);
    expect(isNetworkError(new Error("canceling statement due to statement timeout"))).toBe(true);
    expect(isNetworkError(new Error("Network error"))).toBe(true);
    expect(isNetworkError(new Error("permission denied for table notes"))).toBe(false);
    const op = { workspaceId: "w", kind: "rename" as const, args: {}, queuedAt: 0 };
    expect(replayDecision(op, new Error("request timed out"))).toBe("retry-later");
    expect(replayDecision(op, new Error("permission denied"))).toBe("drop");
  });
});
