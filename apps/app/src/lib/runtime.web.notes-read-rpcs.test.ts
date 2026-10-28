// NS-7 (specs/notes-schema-hardening.md AC8, Assumption 7): opening a note's
// document is one notes_pull call, and the notes list is notes_list_meta, each
// checking access once on the server. Until the migration is deployed the
// functions are missing (PGRST202), and the app reads the tables as before.
// Runs the real runtime over a recording stand-in for the Supabase client.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

type Call = {
  kind: "rpc" | "from";
  name: string;
  args?: unknown;
  chain: Array<[string, unknown[]]>;
};
type Answer = { data: unknown; error: unknown };
const recorded = rs.hoisted(() => ({
  calls: [] as Call[],
  /** The answer to each call, by rpc or table name; a function sees the call. */
  answers: {} as Record<string, Answer | ((call: Call) => Answer)>,
}));

rs.mock("@supabase/supabase-js", () => {
  const chain = (call: Call): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            const a = recorded.answers[call.name];
            const result = (typeof a === "function" ? a(call) : a) ?? { data: [], error: null };
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve({ count: 0, ...result }).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            call.chain.push([String(prop), args]);
            return chain(call);
          };
        },
      },
    );
  const noop = () => ({ data: { subscription: { unsubscribe() {} } } });
  const client = new Proxy(
    {
      from: (name: string) => {
        const call: Call = { kind: "from", name, chain: [] };
        recorded.calls.push(call);
        return chain(call);
      },
      rpc: (name: string, args: unknown) => {
        const call: Call = { kind: "rpc", name, args, chain: [] };
        recorded.calls.push(call);
        return chain(call);
      },
      auth: new Proxy({ onAuthStateChange: noop }, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

import { webRuntime } from "./runtime.web";

const WS = "00000000-0000-4000-8000-0000000000c3";
const NOTE = "00000000-0000-4000-8000-0000000000d4";

const missing = (fn: string): Answer => ({
  data: null,
  error: {
    code: "PGRST202",
    message: `Could not find the function public.${fn} in the schema cache`,
  },
});

const update = (id: number) => ({
  id,
  client_id: "c1",
  client_seq: id,
  update_b64: "AAE=",
  origin: "user",
  actor_key_id: null,
});

const meta = (i: number) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  workspace_id: WS,
  created_by: "00000000-0000-4000-8000-0000000000a1",
  parent_id: null,
  title: `Note ${i}`,
  icon: null,
  is_pinned: false,
  position: `a${i}`,
  is_archived: false,
  published_at: null,
  publish_token: null,
  doc_version: 0,
  share_mode: "custom",
  workspace_shared: false,
  in_inbox: false,
  full_width: false,
  edited_by: null,
  edited_at: null,
  created_at: "2026-10-01T08:00:00+00:00",
  updated_at: "2026-10-28T09:01:00+00:00",
  deleted_at: null,
});

const rpcCalls = (name: string) =>
  recorded.calls.filter((c) => c.kind === "rpc" && c.name === name);
const tableReads = () => recorded.calls.filter((c) => c.kind === "from").map((c) => c.name);

beforeEach(() => {
  recorded.calls = [];
  recorded.answers = {};
});

describe("pullDoc on notes_pull", () => {
  it("is one call that brings the log page and the snapshot, reading no table", async () => {
    recorded.answers.notes_pull = {
      data: {
        updates: [update(11), update(12)],
        has_more: false,
        doc_version: 3,
        snapshot: "U05BUA==",
      },
      error: null,
    };
    const res = await webRuntime.notesV2.pullDoc({
      workspaceId: WS,
      noteId: NOTE,
      sinceUpdateId: 10,
    });
    expect(rpcCalls("notes_pull")).toHaveLength(1);
    expect(rpcCalls("notes_pull")[0]!.args).toEqual({
      p_workspace_id: WS,
      p_note_id: NOTE,
      p_after_id: 10,
      p_known_version: null,
    });
    expect(tableReads()).toEqual([]);
    expect(res.snapshotB64).toBe("U05BUA==");
    expect(res.docVersion).toBe(3);
    expect(res.updates.map((u) => u.id)).toEqual([11, 12]);
    expect(res.updates[0]).toMatchObject({ clientId: "c1", clientSeq: 11, updateB64: "AAE=" });
  });

  it("starts from 0 and sends the version this session holds", async () => {
    recorded.answers.notes_pull = {
      data: { updates: [], has_more: false, doc_version: 7 },
      error: null,
    };
    const res = await webRuntime.notesV2.pullDoc({
      workspaceId: WS,
      noteId: NOTE,
      knownDocVersion: 7,
    });
    expect(rpcCalls("notes_pull")[0]!.args).toMatchObject({ p_after_id: 0, p_known_version: 7 });
    // No snapshot key: the version didn't move, so there is nothing to download.
    expect(res.snapshotB64).toBeNull();
    expect(res.docVersion).toBe(7);
  });

  it("a null snapshot (a note never compacted) reads as none", async () => {
    recorded.answers.notes_pull = {
      data: { updates: [update(1)], has_more: false, doc_version: 0, snapshot: null },
      error: null,
    };
    const res = await webRuntime.notesV2.pullDoc({ workspaceId: WS, noteId: NOTE });
    expect(res.snapshotB64).toBeNull();
    expect(res.updates).toHaveLength(1);
  });

  it("follows has_more from the last id, holding the version it was given", async () => {
    recorded.answers.notes_pull = (call) => {
      const { p_after_id } = call.args as { p_after_id: number };
      return p_after_id === 0
        ? {
            data: {
              updates: [update(1), update(2)],
              has_more: true,
              doc_version: 4,
              snapshot: "U05BUA==",
            },
            error: null,
          }
        : { data: { updates: [update(3)], has_more: false, doc_version: 4 }, error: null };
    };
    const res = await webRuntime.notesV2.pullDoc({ workspaceId: WS, noteId: NOTE });
    const calls = rpcCalls("notes_pull");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.args).toMatchObject({ p_after_id: 2, p_known_version: 4 });
    expect(res.updates.map((u) => u.id)).toEqual([1, 2, 3]);
    expect(res.snapshotB64).toBe("U05BUA==");
    expect(res.docVersion).toBe(4);
  });

  it("a snapshot that moved between pages wins (a compaction ran mid-read)", async () => {
    recorded.answers.notes_pull = (call) => {
      const { p_after_id } = call.args as { p_after_id: number };
      return p_after_id === 0
        ? {
            data: { updates: [update(1)], has_more: true, doc_version: 4, snapshot: "T0xE" },
            error: null,
          }
        : {
            data: { updates: [update(2)], has_more: false, doc_version: 5, snapshot: "TkVX" },
            error: null,
          };
    };
    const res = await webRuntime.notesV2.pullDoc({ workspaceId: WS, noteId: NOTE });
    expect(res.snapshotB64).toBe("TkVX");
    expect(res.docVersion).toBe(5);
    expect(res.updates.map((u) => u.id)).toEqual([1, 2]);
  });

  it("an error is the pull's error (no fallback, no partial log)", async () => {
    recorded.answers.notes_pull = {
      data: null,
      error: { code: "P0002", message: "Note not found in this workspace." },
    };
    await expect(webRuntime.notesV2.pullDoc({ workspaceId: WS, noteId: NOTE })).rejects.toThrow(
      /Note not found/,
    );
    expect(tableReads()).toEqual([]);
  });

  it("falls back to the table reads while notes_pull is missing", async () => {
    recorded.answers.notes_pull = missing("notes_pull");
    recorded.answers.note_updates = { data: [update(5)], error: null };
    recorded.answers.notes = { data: { doc_state: "U05BUA==", doc_version: 2 }, error: null };
    const res = await webRuntime.notesV2.pullDoc({ workspaceId: WS, noteId: NOTE });
    expect(tableReads()).toContain("note_updates");
    expect(tableReads()).toContain("notes");
    expect(res.snapshotB64).toBe("U05BUA==");
    expect(res.docVersion).toBe(2);
    expect(res.updates.map((u) => u.id)).toEqual([5]);
  });
});

describe("listMeta on notes_list_meta", () => {
  it("is one call for a workspace under 1,000 notes, with the trash window's start", async () => {
    recorded.answers.notes_list_meta = { data: [meta(1), meta(2)], error: null };
    const before = Date.now();
    const res = await webRuntime.notesV2.listMeta(WS);
    const calls = rpcCalls("notes_list_meta");
    expect(calls).toHaveLength(1);
    const args = calls[0]!.args as { p_workspace_id: string; p_trash_since: string };
    expect(args.p_workspace_id).toBe(WS);
    const days = (before - Date.parse(args.p_trash_since)) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
    expect(tableReads()).toEqual([]);
    expect(res.notes.map((n) => n.title)).toEqual(["Note 1", "Note 2"]);
    expect(res.degraded).toBe(false);
    expect(res.truncated).toEqual([]);
  });

  it("pages past PostgREST's 1,000-row ceiling and reports the 5,000 cap", async () => {
    const all = Array.from({ length: 5000 }, (_, i) => meta(i + 1));
    recorded.answers.notes_list_meta = (call) => {
      const range = call.chain.find(([m]) => m === "range")?.[1] as [number, number] | undefined;
      const [from, to] = range ?? [0, 999];
      return { data: all.slice(from, Math.min(to + 1, from + 1000)), error: null };
    };
    const res = await webRuntime.notesV2.listMeta(WS);
    expect(res.notes).toHaveLength(5000);
    expect(new Set(res.notes.map((n) => n.id)).size).toBe(5000);
    expect(res.truncated).toEqual([{ scope: "notes", shown: 5000, total: null }]);
  });

  it("an error is the list's error", async () => {
    recorded.answers.notes_list_meta = {
      data: null,
      error: { code: "42501", message: "permission denied" },
    };
    await expect(webRuntime.notesV2.listMeta(WS)).rejects.toThrow(/permission denied/);
    expect(tableReads()).toEqual([]);
  });

  it("falls back to the notes table while notes_list_meta is missing", async () => {
    recorded.answers.notes_list_meta = missing("notes_list_meta");
    recorded.answers.notes = { data: [meta(9)], error: null };
    const res = await webRuntime.notesV2.listMeta(WS);
    expect(tableReads()).toEqual(["notes"]);
    expect(res.notes.map((n) => n.title)).toEqual(["Note 9"]);
    expect(res.degraded).toBe(false);
  });
});
