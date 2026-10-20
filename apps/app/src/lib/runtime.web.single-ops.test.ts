// One server operation per gesture: saving a preference domain goes through
// prefs_op_set (the server keeps the newer copy), and "Match the new parent"
// rides notes_op_move instead of a second call. Before those migrations are
// deployed, each falls back to the old calls. Runs the real runtime over a
// recording stand-in for the Supabase client.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

type Rpc = { fn: string; args: Record<string, unknown> };
const recorded = rs.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  upserts: [] as Record<string, unknown>[],
  /** What each rpc answers; a function sees the args. */
  answers: {} as Record<
    string,
    (args: Record<string, unknown>) => { data: unknown; error: unknown }
  >,
  user: "00000000-0000-4000-8000-0000000000a1",
}));

rs.mock("@supabase/supabase-js", () => {
  const chain = (payload: Record<string, unknown> | null): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: payload ?? {}, error: null }).then(resolve);
          }
          return (...args: unknown[]) => {
            if (prop === "upsert") {
              const row = args[0] as Record<string, unknown>;
              recorded.upserts.push(row);
              return chain(row);
            }
            return chain(payload);
          };
        },
      },
    );
  const noop = () => ({ data: { subscription: { unsubscribe() {} } } });
  const auth = {
    onAuthStateChange: noop,
    getUser: async () => ({ data: { user: { id: recorded.user } }, error: null }),
  };
  const client = new Proxy(
    {
      from: () => chain(null),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        recorded.rpcs.push({ fn, args });
        const answer = recorded.answers[fn];
        return answer ? answer(args) : { data: null, error: null };
      },
      auth: new Proxy(auth, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

import { webRuntime } from "./runtime.web";

const WS = "00000000-0000-4000-8000-0000000000c3";
const NOTE = "00000000-0000-4000-8000-0000000000d4";
const PARENT = "00000000-0000-4000-8000-0000000000e5";
const AT = "2026-10-20T10:00:00.000Z";
const missing = (fn: string) => () => ({
  data: null,
  error: { code: "PGRST202", message: `Could not find the function public.${fn}(...)` },
});
const noteRow = (over: Record<string, unknown> = {}) => ({
  id: NOTE,
  workspace_id: WS,
  parent_id: PARENT,
  title: "Roadmap",
  position: "a",
  share_mode: "custom",
  workspace_shared: true,
  created_at: AT,
  updated_at: AT,
  ...over,
});
const calls = (): Rpc[] => recorded.rpcs;

beforeEach(() => {
  recorded.rpcs.length = 0;
  recorded.upserts.length = 0;
  recorded.answers = {};
});

describe("preferences.setDomain", () => {
  it("saves through prefs_op_set and answers the row the server kept", async () => {
    recorded.answers.prefs_op_set = () => ({
      data: { appearance: { theme: "dark" }, appearance_updated_at: "2026-10-20T11:00:00+00:00" },
      error: null,
    });
    const saved = await webRuntime.preferences.setDomain("appearance", { theme: "light" }, AT);
    expect(calls()).toEqual([
      {
        fn: "prefs_op_set",
        args: { p_domain: "appearance", p_value: { theme: "light" }, p_updated_at: AT },
      },
    ]);
    expect(recorded.upserts).toHaveLength(0);
    expect(saved?.appearance).toEqual({ theme: "dark" });
    expect(saved?.appearanceUpdatedAt).toBe("2026-10-20T11:00:00+00:00");
  });

  it("before the migration, falls back to the plain upsert of that domain", async () => {
    recorded.answers.prefs_op_set = missing("prefs_op_set");
    await webRuntime.preferences.setDomain("focus", { minutes: 50 }, AT);
    expect(recorded.upserts).toEqual([
      { user_id: recorded.user, focus: { minutes: 50 }, focus_updated_at: AT },
    ]);
  });

  it("any other error is thrown, not hidden", async () => {
    recorded.answers.prefs_op_set = () => ({ data: null, error: { code: "42501", message: "no" } });
    await expect(webRuntime.preferences.setDomain("focus", {}, AT)).rejects.toThrow("no");
  });
});

describe("notesV2.move", () => {
  it("a plain move sends no follow-parent argument (works before the migration)", async () => {
    recorded.answers.notes_op_move = () => ({ data: noteRow(), error: null });
    await webRuntime.notesV2.move({
      workspaceId: WS,
      noteId: NOTE,
      parentId: PARENT,
      position: "a",
    });
    expect(calls()).toEqual([
      {
        fn: "notes_op_move",
        args: { p_workspace_id: WS, p_note_id: NOTE, p_parent_id: PARENT, p_position: "a" },
      },
    ]);
  });

  it("'Match the new parent' is one call: the move carries p_follow_parent", async () => {
    recorded.answers.notes_op_move = () => ({
      data: noteRow({ share_mode: "inherit", workspace_shared: false }),
      error: null,
    });
    const moved = await webRuntime.notesV2.move({
      workspaceId: WS,
      noteId: NOTE,
      parentId: PARENT,
      position: "a",
      followParent: true,
    });
    expect(calls().map((c) => c.fn)).toEqual(["notes_op_move"]);
    expect(calls()[0]?.args.p_follow_parent).toBe(true);
    expect(moved.shareMode).toBe("inherit");
  });

  it("a refused move throws, and no sharing change is sent", async () => {
    recorded.answers.notes_op_move = () => ({
      data: null,
      error: { code: "42501", message: "You can't change who has access to this." },
    });
    await expect(
      webRuntime.notesV2.move({
        workspaceId: WS,
        noteId: NOTE,
        parentId: PARENT,
        position: "a",
        followParent: true,
      }),
    ).rejects.toThrow("You can't change who has access to this.");
    expect(calls().map((c) => c.fn)).toEqual(["notes_op_move"]);
  });

  it("before the migration: the move, then the sharing change, in order", async () => {
    recorded.answers.notes_op_move = (args) =>
      "p_follow_parent" in args ? missing("notes_op_move")() : { data: noteRow(), error: null };
    const moved = await webRuntime.notesV2.move({
      workspaceId: WS,
      noteId: NOTE,
      parentId: PARENT,
      position: "a",
      followParent: true,
    });
    expect(calls().map((c) => c.fn)).toEqual([
      "notes_op_move",
      "notes_op_move",
      "share_op_follow_parent",
    ]);
    expect(moved.shareMode).toBe("inherit");
    expect(moved.workspaceShared).toBe(false);
  });
});
