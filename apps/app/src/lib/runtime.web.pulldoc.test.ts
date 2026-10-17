// NR-7: every save now reaches open editors as "pull", so a live pull must
// not download the note's snapshot again when it hasn't changed. Runs the real
// runtime over a recording stand-in for the Supabase client.

import { describe, expect, it, rs } from "@rstest/core";

type Query = { table: string; calls: Array<[string, unknown[]]> };
const recorded = rs.hoisted(() => ({
  queries: [] as Query[],
  rows: {} as Record<string, unknown>,
}));

rs.mock("@supabase/supabase-js", () => {
  const chain = (q: Query): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            const result = { data: recorded.rows[q.table] ?? [], error: null, count: 0 };
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            q.calls.push([String(prop), args]);
            return chain(q);
          };
        },
      },
    );
  const noop = () => ({ data: { subscription: { unsubscribe() {} } } });
  const client = new Proxy(
    {
      from: (table: string) => {
        const q: Query = { table, calls: [] };
        recorded.queries.push(q);
        return chain(q);
      },
      auth: new Proxy({ onAuthStateChange: noop }, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

import { webRuntime } from "./runtime.web";

const selects = () =>
  recorded.queries
    .filter((q) => q.table === "notes")
    .map((q) => q.calls.find(([m]) => m === "select")?.[1][0]);

describe("pullDoc({ knownDocVersion }) (NR-7)", () => {
  it("skips the snapshot when the version is the one this session holds", async () => {
    recorded.queries = [];
    recorded.rows = { note_updates: [], notes: { doc_state: "U05BUA==", doc_version: 7 } };
    const res = await webRuntime.notesV2.pullDoc({
      workspaceId: "w1",
      noteId: "n1",
      sinceUpdateId: 10,
      knownDocVersion: 7,
    });
    expect(res.snapshotB64).toBeNull();
    expect(res.docVersion).toBe(7);
    expect(selects()).toEqual(["doc_version"]);
  });

  it("downloads it when the version moved (another client compacted)", async () => {
    recorded.queries = [];
    recorded.rows = { note_updates: [], notes: { doc_state: "U05BUA==", doc_version: 8 } };
    const res = await webRuntime.notesV2.pullDoc({
      workspaceId: "w1",
      noteId: "n1",
      sinceUpdateId: 10,
      knownDocVersion: 7,
    });
    expect(res.snapshotB64).toBe("U05BUA==");
    expect(res.docVersion).toBe(8);
  });

  it("always downloads it on a session's first pull", async () => {
    recorded.queries = [];
    recorded.rows = { note_updates: [], notes: { doc_state: "U05BUA==", doc_version: 7 } };
    const res = await webRuntime.notesV2.pullDoc({ workspaceId: "w1", noteId: "n1" });
    expect(res.snapshotB64).toBe("U05BUA==");
    expect(selects()).toEqual(["doc_state, doc_version"]);
  });
});
