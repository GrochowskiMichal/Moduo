/**
 * TV-D16 on the connector: the v3 tool surface (specs/tasks-v3.md §12,
 * §Assumptions #14). Runs the real handlers against an in-memory stand-in for
 * supabase-js; the ops behind them have their own SQL tests
 * (supabase/tests/agent_sessions, import, mcp_tools). The rule checked
 * throughout: a tool never returns what the key's person can't see, answers
 * a hidden item exactly like a missing one, and counts nothing hidden.
 */

import { describe, expect, it, rs } from "@rstest/core";

// tasks.ts pulls rrule from esm.sh, which only Deno can load; nothing here uses it.
rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

import { createHeadlessEditor } from "@lexical/headless";
import { $isLinkNode } from "@lexical/link";
import { $getRoot, $isElementNode, type LexicalNode } from "lexical";

// The app's own description reader, to check what a stored description shows.
import {
  $exportDescription,
  $importDescription,
  DESCRIPTION_MARKDOWN_NODES,
} from "../../../src/features/spine/editor/description-markdown";
import { $isReferenceNode } from "../../../src/features/spine/editor/entity-ref-schema";
import { parseToolArgs } from "../_shared/contracts/mcp-tool-args.ts";
import { descriptionReferences, readsAsModuoAddress } from "../_shared/description-markdown.ts";
import { tasksConnectorModule } from "./modules/tasks.ts";
import { toolAllowed, type KeyContext, type ToolContext } from "./registry.ts";

type Row = Record<string, unknown>;

const WS = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const BEA = "33333333-3333-4333-8333-333333333333";
const P_SHARED = "44444444-4444-4444-8444-444444444444";
const P_HIDDEN = "55555555-5555-4555-8555-555555555555";
const INBOX = "66666666-6666-4666-8666-666666666666";
const A_MINE = "77777777-7777-4777-8777-777777777777";
const A_BEAS = "88888888-8888-4888-8888-888888888888";
const A_SHARED = "99999999-9999-4999-8999-999999999999";
const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Filter = { op: "eq" | "neq" | "in" | "notnull"; column: string; value: unknown };

function fakeDb(tables: Record<string, Row[]>, rpcs: Record<string, (args: Row) => unknown>) {
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  const updates: Array<{ table: string; values: Row; ids: unknown[] }> = [];
  function from(table: string) {
    const filters: Filter[] = [];
    let window: [number, number] | null = null;
    let cap: number | null = null;
    let patch: Row | null = null;
    let counted = false;
    const orders: Array<{ column: string; ascending: boolean }> = [];
    const query = {
      select: (_cols?: string, opts?: { count?: string }) => {
        if (opts?.count) counted = true;
        return query;
      },
      not: (column: string, op: string, value: unknown) => {
        if (op !== "is" || value !== null) throw new Error(`fake: not(${column}, ${op})`);
        filters.push({ op: "notnull", column, value });
        return query;
      },
      update: (values: Row) => {
        patch = values;
        return query;
      },
      eq: (column: string, value: unknown) => {
        filters.push({ op: "eq", column, value });
        return query;
      },
      is: (column: string, value: unknown) => {
        filters.push({ op: "eq", column, value });
        return query;
      },
      neq: (column: string, value: unknown) => {
        filters.push({ op: "neq", column, value });
        return query;
      },
      in: (column: string, value: unknown[]) => {
        filters.push({ op: "in", column, value });
        return query;
      },
      or: () => query,
      order: (column: string, opts?: { ascending?: boolean }) => {
        orders.push({ column, ascending: opts?.ascending !== false });
        return query;
      },
      limit: (n: number) => {
        cap = n;
        return query;
      },
      range: (a: number, b: number) => {
        window = [a, b];
        return query;
      },
      maybeSingle: () =>
        query.then((r: { data: Row[] }) => ({ data: r.data[0] ?? null, error: null })),
      then<T>(resolve: (result: { data: Row[]; error: null; count?: number }) => T) {
        const value = (row: Row, column: string): unknown => {
          const json = column.match(/^(\w+)->>(\w+)$/);
          if (json) return ((row[json[1]!] as Row | null) ?? {})[json[2]!] ?? null;
          return row[column] ?? null;
        };
        const holds = (row: Row, f: Filter) =>
          f.op === "eq"
            ? value(row, f.column) === f.value
            : f.op === "in"
              ? (f.value as unknown[]).includes(value(row, f.column))
              : f.op === "notnull"
                ? value(row, f.column) !== null
                : value(row, f.column) !== f.value;
        let all = (tables[table] ?? []).filter((row) => filters.every((f) => holds(row, f)));
        const total = all.length;
        if (orders.length) {
          all = [...all].sort((a, b) => {
            for (const o of orders) {
              const x = String(value(a, o.column) ?? "");
              const y = String(value(b, o.column) ?? "");
              if (x !== y) return (x < y ? -1 : 1) * (o.ascending ? 1 : -1);
            }
            return 0;
          });
        }
        if (window) all = all.slice(window[0], window[1] + 1);
        if (cap !== null) all = all.slice(0, cap);
        if (patch) {
          for (const row of all) Object.assign(row, patch);
          updates.push({ table, values: patch, ids: all.map((r) => r.id) });
        }
        return Promise.resolve({ data: all, error: null, ...(counted ? { count: total } : {}) }).then(resolve);
      },
    };
    return query;
  }
  async function rpc(fn: string, args: Row) {
    rpcCalls.push({ fn, args });
    const impl = rpcs[fn];
    if (!impl) return { data: null, error: { message: `unexpected rpc ${fn}` } };
    try {
      return { data: impl(args), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }
  return { db: { from, rpc }, rpcCalls, updates };
}

const task = (id: string, n: number, extra: Row = {}): Row => ({
  id,
  number: n,
  workspace_id: WS,
  owner_id: ME,
  assignee_id: ME,
  creator_unknown: false,
  bucket_id: P_SHARED,
  title: id,
  status: "todo",
  status_category: "todo",
  position: String(n).padStart(4, "0"),
  deleted_at: null,
  ...extra,
});

function setup(opts: { rpcs?: Record<string, (args: Row) => unknown>; scopes?: Record<string, string> } = {}) {
  const tables: Record<string, Row[]> = {
    workspaces: [{ id: WS, task_key: "MOD", owner_id: BEA }],
    tasks: [
      task("t-open", 1),
      task("t-backlog", 2, { status: "todo", status_category: "backlog" }),
      task("t-done", 3, { status: "done", status_category: "done", completed_at: "2030-01-05T10:00:00Z" }),
      task("t-parent", 4),
      task("t-sub1", 5, { parent_id: "t-parent" }),
      task("t-sub2", 6, { parent_id: "t-parent" }),
      task("t-subdone", 7, { parent_id: "t-parent", status: "done", status_category: "done" }),
      task("t-subhidden", 8, { parent_id: "t-parent" }),
      task("t-secret", 9, { bucket_id: P_HIDDEN, title: "Board secret" }),
      task("t-team", 10, { team_id: TEAM, section_id: "s-1" }),
      task("t-repeat", 11, { recurrence: { rrule: "FREQ=DAILY" } }),
      task("t-repsub", 12, { parent_id: "t-repeat" }),
      task("t-imported", 13, { imported_from: { source: "linear", key: "ENG-123" } }),
    ],
    task_relations: [],
    tags: [{ id: "tag-1", workspace_id: WS, name: "board", color: null, deleted_at: null }],
    tag_links: [
      { id: "l1", workspace_id: WS, tag_id: "tag-1", entity_type: "task", entity_id: "t-open" },
      { id: "l2", workspace_id: WS, tag_id: "tag-1", entity_type: "task", entity_id: "t-secret" },
    ],
    task_queue: [],
    buckets: [
      { id: INBOX, workspace_id: WS, name: "Inbox", is_system: true, owner_id: ME, position: "a0", deleted_at: null },
      { id: P_SHARED, workspace_id: WS, name: "Launch", is_system: false, status: "active", area_id: A_SHARED,
        position: "a1", deleted_at: null, lead_id: BEA },
      { id: P_HIDDEN, workspace_id: WS, name: "Board", is_system: false, area_id: A_BEAS, position: "a2", deleted_at: null },
    ],
    areas: [
      { id: A_MINE, workspace_id: WS, name: "Mine", position: 1, shared: false, created_by: ME, deleted_at: null },
      { id: A_BEAS, workspace_id: WS, name: "Bea's label", position: 2, shared: false, created_by: BEA, deleted_at: null },
      { id: A_SHARED, workspace_id: WS, name: "Clients", position: 3, shared: false, created_by: BEA, deleted_at: null },
    ],
    teams: [
      { id: TEAM, workspace_id: WS, name: "Design", color: "teal", default_project_id: P_HIDDEN, deleted_at: null },
    ],
    team_members: [{ workspace_id: WS, team_id: TEAM, user_id: ME, deleted_at: null }],
    task_templates: [
      { id: "tt-mine", workspace_id: WS, owner_id: ME, name: "Episode", shared: false,
        summary: { tasks: 4, dated: true, title: "Record" }, body: { tasks: [] }, source_ids: ["x"], deleted_at: null },
      { id: "tt-beas", workspace_id: WS, owner_id: BEA, name: "Bea private", shared: false, summary: {}, deleted_at: null },
    ],
    project_templates: [
      { id: "pt-shared", workspace_id: WS, owner_id: BEA, name: "Onboarding", shared: true,
        summary: { tasks: 9, sections: 3 }, deleted_at: null },
    ],
    workspace_members: [
      { workspace_id: WS, user_id: ME, perms: ["tasks.edit"], profiles: { display_name: "Ada" } },
      { workspace_id: WS, user_id: BEA, perms: ["tasks.edit"], profiles: { display_name: "Bea" } },
    ],
    task_sessions: [],
    task_reminders: [
      { id: "r-mine", workspace_id: WS, task_id: "t-open", user_id: ME, kind: "at", at: "2030-01-01T09:00:00Z", deleted_at: null },
      { id: "r-beas", workspace_id: WS, task_id: "t-open", user_id: BEA, kind: "at", at: "2030-01-01T10:00:00Z", deleted_at: null },
    ],
    task_waiting: [],
    module_activity: [
      { workspace_id: WS, module: "tasks", entity_type: "task", entity_id: "t-open", op: "tasks.create",
        actor_type: "api_key", actor_label: "Ada · via Claude", payload: {}, created_at: "2030-01-01" },
      { workspace_id: WS, module: "tasks", entity_type: "task", entity_id: "t-secret", op: "tasks.create",
        actor_type: "user", actor_label: "Bea", payload: { title: "Board secret" }, created_at: "2030-01-02" },
    ],
  };
  const hiddenTasks = new Set(["t-secret", "t-subhidden"]);
  const fake = fakeDb(tables, {
    share_visible_ids: (a) =>
      a.p_resource_type === "bucket"
        ? [INBOX, P_SHARED]
        : tables.tasks!.map((t) => t.id as string).filter((id) => !hiddenTasks.has(id)),
    tasks_agent_sessions: () => [{ id: "s1", agent: "Claude", state: "working", mine: true }],
    ...(opts.rpcs ?? {}),
  });
  const key: KeyContext = {
    id: "key-1",
    workspaceId: WS,
    name: "Claude",
    createdBy: ME,
    scopes: opts.scopes ?? { tasks: "edit" },
  };
  const ctx: ToolContext = { key, db: fake.db as unknown as ToolContext["db"] };
  return { ctx, tables, ...fake };
}

/** A tool call as index.ts makes it: the arguments go through the tool's
 *  parser first, so a field the parser drops never reaches the handler. */
function call(name: string, args: Row, ctx: ToolContext): Promise<any> {
  const t = tasksConnectorModule.tools.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  const parsed = parseToolArgs(name, args);
  if (!parsed.success) return Promise.reject(new Error(parsed.message));
  return t.handler(parsed.data, ctx) as Promise<any>;
}

describe("handles: every task argument takes MOD-142 or a uuid", () => {
  it("reads a task by its handle, in any case", async () => {
    const { ctx } = setup();
    expect((await call("tasks_get", { task_id: "MOD-1" }, ctx)).id).toBe("t-open");
    expect((await call("tasks_get", { task_id: "mod-4" }, ctx)).id).toBe("t-parent");
  });

  it("answers a hidden task's handle exactly like a missing one", async () => {
    const { ctx } = setup();
    const hidden = await call("tasks_get", { task_id: "MOD-9" }, ctx).catch((e: Error) => e.message);
    const missing = await call("tasks_get", { task_id: "MOD-999" }, ctx).catch((e: Error) => e.message);
    const otherKey = await call("tasks_get", { task_id: "XYZ-1" }, ctx).catch((e: Error) => e.message);
    expect(hidden).toBe("Task not found in this workspace.");
    expect(missing).toBe(hidden);
    expect(otherKey).toBe(hidden);
  });

  it("tasks_get lists only the key person's reminders, and the sessions they may see", async () => {
    const { ctx, rpcCalls } = setup();
    const got = await call("tasks_get", { task_id: "t-open" }, ctx);
    expect(got.my_reminders.map((r: Row) => r.id)).toEqual(["r-mine"]);
    expect(got.agent_sessions).toEqual([{ id: "s1", agent: "Claude", state: "working", mine: true }]);
    expect(rpcCalls.find((c) => c.fn === "tasks_agent_sessions")?.args).toEqual({ p_workspace_id: WS, p_task_id: "t-open" });
    expect(got.subtasks).toEqual([]);
  });
});

describe("comments in tasks_get (MOD-94): Links: View reads them", () => {
  const comment = (id: string, at: string, extra: Row = {}): Row => ({
    id,
    workspace_id: WS,
    entity_type: "task",
    entity_id: "t-open",
    body: `body ${id}`,
    created_by: BEA,
    author_kind: "user",
    author_label: null,
    created_at: at,
    edited_at: null,
    deleted_at: null,
    ...extra,
  });
  const withLinks = { tasks: "edit", links: "view" };

  function withComments(scopes: Record<string, string> = withLinks) {
    const s = setup({ scopes });
    s.tables.comments = [
      comment("c-2", "2030-01-02T10:00:00Z", { edited_at: "2030-01-02T11:00:00Z" }),
      comment("c-1", "2030-01-01T10:00:00Z", { created_by: ME, author_kind: "api_key", author_label: "Claude Code" }),
      comment("c-3", "2030-01-03T10:00:00Z", { created_by: "gone-user" }),
      comment("c-deleted", "2030-01-04T10:00:00Z", { deleted_at: "2030-01-05T00:00:00Z" }),
      comment("c-other", "2030-01-04T10:00:00Z", { entity_id: "t-done" }),
      comment("c-note", "2030-01-04T10:00:00Z", { entity_type: "note" }),
    ];
    return s;
  }

  it("carries the task's live comments, the newest last, with who wrote each", async () => {
    const { ctx } = withComments();
    const got = await call("tasks_get", { task_id: "MOD-1" }, ctx);
    expect(got.comments).toEqual([
      { id: "c-1", author: "Claude Code (app)", at: "2030-01-01T10:00:00Z", body: "body c-1" },
      { id: "c-2", author: "Bea", at: "2030-01-02T10:00:00Z", edited: true, body: "body c-2" },
      { id: "c-3", author: "Former member", at: "2030-01-03T10:00:00Z", body: "body c-3" },
    ]);
    expect(got).not.toHaveProperty("earlier_comments");
  });

  it("keeps the latest 20 and counts the earlier ones", async () => {
    const { ctx, tables } = setup({ scopes: withLinks });
    tables.comments = Array.from({ length: 23 }, (_, i) =>
      comment(`c-${String(i).padStart(2, "0")}`, `2030-01-01T10:${String(i).padStart(2, "0")}:00Z`),
    );
    const got = await call("tasks_get", { task_id: "t-open" }, ctx);
    expect(got.comments).toHaveLength(20);
    expect(got.comments[0].id).toBe("c-03");
    expect(got.comments.at(-1).id).toBe("c-22");
    expect(got.earlier_comments).toBe(3);
  });

  it("a key without Links reads the task but none of its comments", async () => {
    const { ctx } = withComments({ tasks: "edit" });
    const got = await call("tasks_get", { task_id: "MOD-1" }, ctx);
    expect(got.handle).toBe("MOD-1");
    expect(got).not.toHaveProperty("comments");
    expect(got).not.toHaveProperty("earlier_comments");
    expect(JSON.stringify(got)).not.toContain("body c-");
  });

  it("a comment read that fails leaves the comments out, never the task", async () => {
    const { ctx } = withComments();
    const db = ctx.db as unknown as { from: (t: string) => Row };
    const from = db.from;
    db.from = (t: string) => {
      if (t !== "comments") return from(t);
      const failing: Row = {};
      for (const m of ["select", "eq", "is", "order", "limit"]) failing[m] = () => failing;
      failing.then = (resolve: (r: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: "column comments.x does not exist" } }).then(resolve);
      return failing;
    };
    const got = await call("tasks_get", { task_id: "MOD-1" }, ctx);
    expect(got.handle).toBe("MOD-1");
    expect(got).not.toHaveProperty("comments");
    expect(got).not.toHaveProperty("earlier_comments");
  });

  it("a task the key's person can't see reads as missing, comments and all", async () => {
    const { ctx, tables } = withComments();
    tables.comments!.push(comment("c-secret", "2030-01-01T00:00:00Z", { entity_id: "t-secret" }));
    await expect(call("tasks_get", { task_id: "t-secret" }, ctx)).rejects.toThrow("Task not found in this workspace.");
  });
});

describe("tasks_set_status: by category or name; finishing cascades (call 87)", () => {
  function statusOps() {
    const statusCalls: Row[] = [];
    return {
      statusCalls,
      rpcs: {
        tasks_op_set_status: (a: Row) => {
          statusCalls.push(a);
          if (a.p_task_id === "t-subhidden") throw new Error("You don't have access to this task.");
          return task(a.p_task_id as string, 4, { status: "done", status_category: "done" });
        },
      },
    };
  }

  it("passes a project's status name through to the op", async () => {
    const ops = statusOps();
    const { ctx } = setup({ rpcs: ops.rpcs });
    await call("tasks_set_status", { task_id: "t-open", status: "In review" }, ctx);
    expect(ops.statusCalls[0]).toMatchObject({ p_task_id: "t-open", p_status: "In review", p_recurrence: null });
  });

  it("finishing a parent finishes its open subtasks the key can edit, and says how many", async () => {
    const ops = statusOps();
    const { ctx } = setup({ rpcs: ops.rpcs });
    const out = await call("tasks_set_status", { task_id: "t-parent", status: "done" }, ctx);
    // t-sub1 and t-sub2 are open; t-subdone is closed; t-subhidden isn't
    // seen at all, so it's never asked for.
    expect(ops.statusCalls.map((c) => c.p_task_id)).toEqual(["t-parent", "t-sub1", "t-sub2"]);
    expect(out.also_finished).toBe(2);
  });

  it("a repeating parent keeps its subtasks open", async () => {
    const ops = statusOps();
    const { ctx } = setup({ rpcs: ops.rpcs });
    const out = await call("tasks_set_status", { task_id: "t-repeat", status: "done" }, ctx);
    expect(ops.statusCalls.map((c) => c.p_task_id)).toEqual(["t-repeat"]);
    expect(out.also_finished).toBeUndefined();
  });
});

describe("reads never show or count what the key's person can't see", () => {
  it("tasks_search: words and imported keys through the gated RPC, plus handles; nothing hidden", async () => {
    // The server reads the import key too ("ENG-123", AC3.6); the connector
    // asks nothing else about it.
    const { ctx, rpcCalls } = setup({
      rpcs: { tasks_search: (args) => (args.p_query === "ENG-123" ? ["t-imported"] : ["t-secret", "t-open"]) },
    });
    const byWords = await call("tasks_search", { q: "board" }, ctx);
    expect(byWords.map((t: Row) => t.id)).toEqual(["t-open"]);
    expect(rpcCalls.find((c) => c.fn === "tasks_search")?.args).toEqual({ p_workspace_id: WS, p_query: "board", p_limit: 25 });
    const byHandle = await call("tasks_search", { q: "MOD-4" }, ctx);
    expect(byHandle[0].id).toBe("t-parent");
    const byKey = await call("tasks_search", { q: "ENG-123" }, ctx);
    expect(byKey[0].id).toBe("t-imported");
    expect(byKey[0].imported_from).toEqual({ source: "linear", key: "ENG-123" });
    expect((await call("tasks_search", { q: "MOD-9" }, ctx)).map((t: Row) => t.id)).not.toContain("t-secret");
  });

  it("tasks_list_tags counts only tasks the key's person can see", async () => {
    const { ctx } = setup();
    expect(await call("tasks_list_tags", {}, ctx)).toEqual([{ id: "tag-1", name: "board", color: null, task_count: 1 }]);
  });

  it("tasks_list: categories, project, section, team, area and completed range", async () => {
    const { ctx } = setup();
    const ids = async (args: Row) => (await call("tasks_list", args, ctx)).map((t: Row) => t.id);
    expect(await ids({ category: "todo" })).not.toContain("t-backlog");
    expect(await ids({ status: "todo" })).not.toContain("t-backlog");
    expect(await ids({ category: "backlog" })).toEqual(["t-backlog"]);
    expect(await ids({ completed_from: "2030-01-01", completed_to: "2030-01-31" })).toEqual(["t-done"]);
    expect(await ids({ team_id: TEAM })).toEqual(["t-team"]);
    expect(await ids({ section_id: "s-1" })).toEqual(["t-team"]);
    expect(await ids({ area_id: A_BEAS })).toEqual([]);
    expect((await ids({ category: "open" })).includes("t-secret")).toBe(false);
  });

  it("tasks_list answers short rows by default, the full shape on asking (MOD-113)", async () => {
    const { ctx, tables } = setup();
    tables.sections = [
      { id: "s-1", workspace_id: WS, project_id: P_SHARED, name: "Design" },
      { id: "s-h", workspace_id: WS, project_id: P_HIDDEN, name: "Bea's plans" },
    ];
    tables.project_statuses = [{ id: "st-1", workspace_id: WS, project_id: P_SHARED, name: "In review" }];
    tables.tasks!.find((t) => t.id === "t-team")!.status_id = "st-1";
    // Shared with me on its own, in a project I can't see: no project or section name.
    tables.tasks!.push(task("t-alone", 14, { bucket_id: P_HIDDEN, section_id: "s-h" }));
    const short: Row[] = await call("tasks_list", {}, ctx);
    const row = (id: string) => short.find((t) => t.id === id)!;
    expect(row("t-team")).toEqual({
      handle: "MOD-10",
      id: "t-team",
      title: "t-team",
      status: "todo",
      status_name: "In review",
      assignee: "Ada",
      project: "Launch",
      section: "Design",
    });
    expect(row("t-open")).toMatchObject({ handle: "MOD-1", project: "Launch", tags: ["board"] });
    expect(row("t-alone")).toEqual({ handle: "MOD-14", id: "t-alone", title: "t-alone", status: "todo", assignee: "Ada" });
    expect(JSON.stringify(short)).not.toContain("Bea's plans");
    // One project asked for: its name isn't repeated on every row.
    const one: Row[] = await call("tasks_list", { project_id: P_SHARED }, ctx);
    expect(one.some((t) => "project" in t)).toBe(false);
    // fields: full is the shape tasks_list used to answer.
    const full: Row[] = await call("tasks_list", { fields: "full" }, ctx);
    expect(full.find((t) => t.id === "t-team")).toMatchObject({
      bucket_id: P_SHARED,
      section_id: "s-1",
      assignee: { id: ME, name: "Ada" },
    });
    await expect(call("tasks_list", { fields: "everything" }, ctx)).rejects.toThrow("fields");
  });

  it("tasks_list's full rows page by 25 unless asked, the short ones by 100", async () => {
    const { ctx, tables } = setup();
    for (let n = 100; n < 160; n += 1) tables.tasks!.push(task(`t-${n}`, n));
    expect((await call("tasks_list", {}, ctx)).length).toBeGreaterThan(25);
    expect(await call("tasks_list", { fields: "full" }, ctx)).toHaveLength(25);
    expect(await call("tasks_list", { fields: "full", limit: 40 }, ctx)).toHaveLength(40);
  });

  it("projects_list: the person's Inbox and shared projects, never a hidden one", async () => {
    const { ctx } = setup();
    expect(await call("projects_list", {}, ctx)).toEqual([
      { id: INBOX, name: "Inbox", is_inbox: true },
      { id: P_SHARED, name: "Launch", status: "active", area_id: A_SHARED, lead: { id: BEA, name: "Bea" } },
    ]);
  });

  it("areas_list: shared, mine, or one a project I see is filed in; not someone's label", async () => {
    const { ctx } = setup();
    expect((await call("areas_list", {}, ctx)).map((a: Row) => a.id)).toEqual([A_MINE, A_SHARED]);
  });

  it("sections_list and statuses_list read a hidden project as missing", async () => {
    const { ctx } = setup();
    for (const name of ["sections_list", "statuses_list"]) {
      const hidden = await call(name, { project_id: P_HIDDEN }, ctx).catch((e: Error) => e.message);
      const missing = await call(name, { project_id: "12345678-1234-4234-8234-123456789012" }, ctx).catch(
        (e: Error) => e.message,
      );
      expect(hidden).toBe("That project isn't in this workspace.");
      expect(missing).toBe(hidden);
    }
  });

  it("teams_list leaves out a default project the person can't see", async () => {
    const { ctx } = setup();
    expect(await call("teams_list", {}, ctx)).toEqual([
      { id: TEAM, name: "Design", color: "teal", members: [{ id: ME, name: "Ada", is_me: true }] },
    ]);
  });

  it("templates_list: mine and shared, never anyone's private one, never a body or its sources", async () => {
    const { ctx } = setup();
    const listed = await call("templates_list", {}, ctx);
    expect(listed).toEqual([
      { id: "tt-mine", kind: "task", name: "Episode", shared: false, mine: true, tasks: 4, dated: true },
      { id: "pt-shared", kind: "project", name: "Onboarding", shared: true, mine: false, tasks: 9, sections: 3, dated: false },
    ]);
    expect(JSON.stringify(listed)).not.toContain("source_ids");
    expect(JSON.stringify(listed)).not.toContain("Record");
  });

  it("tasks_time_report sums the gated rows, by task or by day; a hidden project reads as missing", async () => {
    const report = [
      { entry_id: "e1", task_id: "t-open", task_title: "t-open", project_name: "Launch", entry_day: "2030-01-02", seconds: 600 },
      { entry_id: "e2", task_id: "t-open", task_title: "t-open", project_name: "Launch", entry_day: "2030-01-03", seconds: 300 },
      { entry_id: "e3", task_id: "t-team", task_title: "t-team", project_name: null, entry_day: "2030-01-03", seconds: 60 },
    ];
    const { ctx, rpcCalls } = setup({ rpcs: { tasks_time_report: () => report } });
    const byTask = await call("tasks_time_report", { from: "2030-01-01", to: "2030-01-31" }, ctx);
    expect(byTask).toEqual({
      from: "2030-01-01",
      to: "2030-01-31",
      total_seconds: 960,
      rows: [
        { task_id: "t-open", title: "t-open", project: "Launch", seconds: 900 },
        { task_id: "t-team", title: "t-team", project: null, seconds: 60 },
      ],
    });
    const byDay = await call("tasks_time_report", { from: "2030-01-01", to: "2030-01-31", by: "day" }, ctx);
    expect(byDay.rows).toEqual([
      { day: "2030-01-02", seconds: 600 },
      { day: "2030-01-03", seconds: 360 },
    ]);
    expect(rpcCalls.find((c) => c.fn === "tasks_time_report")?.args).toMatchObject({
      p_project_ids: null,
      p_client_contact_id: null,
    });
    await expect(
      call("tasks_time_report", { from: "2030-01-01", to: "2030-01-31", project_id: P_HIDDEN }, ctx),
    ).rejects.toThrow("That project isn't in this workspace.");
  });

  it("tasks_activity drops rows about tasks the person can't see", async () => {
    const { ctx } = setup();
    const rows = await call("tasks_activity", {}, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_id).toBe("t-open");
    expect(rows[0].actor_label).toBe("Ada · via Claude");
  });
});

describe("writes go through the ops, checked before anything is written", () => {
  it("tasks_create builds one op call with its tags, reminders, sessions and import run", async () => {
    const { ctx, rpcCalls } = setup({
      rpcs: {
        tasks_op_create_with: (a) => ({
          action: "created",
          task: task("t-new", 20, { ...(a.p_task as Row) }),
          reminders_added: 1,
          sessions_added: 0,
        }),
      },
    });
    const out = await call(
      "tasks_create",
      {
        title: "Read ch. 1",
        project_id: P_SHARED,
        section_id: "s-1",
        status: "In review",
        due_on: "2030-01-07",
        repeat: "RRULE:FREQ=WEEKLY;BYDAY=TU",
        tags: ["reading"],
        reminders: [{ kind: "day_before" }],
        imported_from: { source: "todoist", key: "101" },
        import_id: "imp-1",
        parent_id: "MOD-1",
      },
      ctx,
    );
    expect(rpcCalls.find((c) => c.fn === "tasks_op_create_with")?.args).toEqual({
      p_workspace_id: WS,
      p_task: {
        title: "Read ch. 1",
        status: "In review",
        due_on: "2030-01-07",
        section_id: "s-1",
        recurrence: { rrule: "FREQ=WEEKLY;BYDAY=TU" },
        bucket_id: P_SHARED,
        parent_id: "t-open",
        imported_from: { source: "todoist", key: "101" },
      },
      p_with: { tags: ["reading"], reminders: [{ kind: "day_before" }], import_id: "imp-1" },
    });
    expect(out).toMatchObject({ action: "created", handle: "MOD-20", reminders_added: 1 });
  });

  it("tasks_create into a hidden project is refused before any op runs", async () => {
    const { ctx, rpcCalls } = setup();
    await expect(call("tasks_create", { title: "x", project_id: P_HIDDEN }, ctx)).rejects.toThrow(
      "That project isn't in this workspace.",
    );
    expect(rpcCalls.some((c) => c.fn === "tasks_op_create_with")).toBe(false);
  });

  it("tasks_update sends tags with the patch, as one op", async () => {
    const { ctx, rpcCalls } = setup({ rpcs: { tasks_op_update_with: (a) => [task(a.p_task_id as string, 1)] } });
    await call("tasks_update", { task_id: "MOD-1", repeat: null, tags_add: ["x"], tags_remove: ["y"] }, ctx);
    expect(rpcCalls.find((c) => c.fn === "tasks_op_update_with")?.args).toEqual({
      p_workspace_id: WS,
      p_task_id: "t-open",
      p_patch: { recurrence: null },
      p_with: { tags_add: ["x"], tags_remove: ["y"] },
    });
  });

  it("a description is taken as Markdown; HTML an agent sends is read as Markdown, not stored as tags (call #15)", async () => {
    const { ctx, rpcCalls } = setup({ rpcs: { tasks_op_update_with: (a) => [task(a.p_task_id as string, 1)] } });
    await call("tasks_update", { task_id: "MOD-1", description: "<p>Hello <b>bold</b> &amp; more</p><ul><li>one</li></ul>" }, ctx);
    await call("tasks_update", { task_id: "MOD-1", description: "- [ ] **Check** it" }, ctx);
    await call("tasks_update", { task_id: "MOD-1", description: "<https://moduo.app> is a link" }, ctx);
    const patches = rpcCalls.filter((c) => c.fn === "tasks_op_update_with").map((c) => c.args.p_patch);
    expect(patches).toEqual([
      { description: "Hello **bold** & more\n\n- one" },
      { description: "- [ ] **Check** it" },
      { description: "<https://moduo.app> is a link" },
    ]);
  });

  it("a description's references resolve for the key: a handle to its uuid, an unreachable item to its words, and links are made (call #15)", async () => {
    const SEEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const SECRET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const { ctx, rpcCalls, tables } = setup({
      scopes: { tasks: "edit", links: "edit" },
      rpcs: {
        tasks_op_update_with: (a) => [task(a.p_task_id as string, 1)],
        tasks_op_create_with: (a) => ({ action: "created", task: { ...(a.p_task as Row), id: "t-new", number: 99 } }),
        perm_can_see_entity: (a) => a.p_id === SEEN,
        links_op_create: () => [{ id: "link-1" }],
      },
    });
    tables.tasks!.push(task(SEEN, 50), task(SECRET, 51));
    const description =
      "See [Fix login](moduo://task/MOD-50) and [Board secret](moduo://task/MOD-51), " +
      "[x](moduo://note/not-a-uuid) and [Oct 17](moduo://date/2026-10-17).";
    await call("tasks_update", { task_id: "MOD-1", description }, ctx);
    const patch = rpcCalls.find((c) => c.fn === "tasks_op_update_with")?.args.p_patch as Row;
    expect(patch.description).toBe(
      `See [task](moduo://task/${SEEN}) and Board secret, x and [Oct 17](moduo://date/2026-10-17).`,
    );
    expect(patch.description).not.toContain("Fix login");
    const links = rpcCalls.filter((c) => c.fn === "links_op_create").map((c) => c.args);
    expect(links).toEqual([
      expect.objectContaining({
        p_source_type: "task",
        p_source_id: "t-open",
        p_target_type: "task",
        p_target_id: SEEN,
        p_relation_kind: "mentions",
        p_origin: "mention",
      }),
    ]);
    // tasks_create links from the new task the same way.
    await call("tasks_create", { title: "New", description: `Re [it](moduo://task/MOD-50)` }, ctx);
    const created = rpcCalls.find((c) => c.fn === "tasks_op_create_with")?.args.p_task as Row;
    expect(created.description).toBe(`Re [task](moduo://task/${SEEN})`);
    expect(rpcCalls.filter((c) => c.fn === "links_op_create").at(-1)?.args).toEqual(
      expect.objectContaining({ p_source_id: "t-new", p_target_id: SEEN }),
    );
  });

  describe("a description's references through the connector: only what the key reaches is stored as one or linked", () => {
    const SEEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const SECRET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const ELSEWHERE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const NOTE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const TAG = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    function described(scopes: Record<string, string> = { tasks: "edit", links: "edit" }) {
      const made = setup({
        scopes,
        rpcs: {
          tasks_op_update_with: (a) => [task(a.p_task_id as string, 1)],
          tasks_op_create_with: (a) => ({ action: "created", task: { ...(a.p_task as Row), id: "t-new", number: 99 } }),
          // The person can see SEEN, and ELSEWHERE's id too (it's another workspace's).
          perm_can_see_entity: (a) => a.p_id === SEEN || a.p_id === ELSEWHERE || a.p_id === NOTE,
          links_op_create: () => [{ id: "link-1" }],
        },
      });
      made.tables.tasks!.push(task(SEEN, 50), task(SECRET, 51), task(ELSEWHERE, 52, { workspace_id: "other-ws" }));
      made.tables.notes = [{ id: NOTE, workspace_id: WS, deleted_at: null }];
      const write = async (description: string): Promise<string> => {
        await call("tasks_update", { task_id: "MOD-1", description }, made.ctx);
        const patch = made.rpcCalls.filter((c) => c.fn === "tasks_op_update_with").at(-1)?.args.p_patch as Row;
        return patch.description as string;
      };
      const linked = () =>
        made.rpcCalls.filter((c) => c.fn === "links_op_create").map((c) => `${c.args.p_target_type}:${c.args.p_target_id}`);
      return { ...made, write, linked };
    }

    /**
     * Every reference the app's editor shows for a stored description, read
     * and saved three times over (each save read back), and what the readers
     * outside the editor (`descriptionReferences`) find in what was stored
     * and in every save. A moduo: plain link counts, however it's spelled.
     */
    function shownReferences(stored: string): string[] {
      const seen = new Set<string>();
      let value = stored;
      for (let round = 0; round < 3; round++) {
        for (const ref of descriptionReferences(value)) seen.add(`${ref.type}:${ref.id}`);
        const editor = createHeadlessEditor({
          nodes: DESCRIPTION_MARKDOWN_NODES,
          onError: (error) => {
            throw error;
          },
        });
        editor.update(() => $importDescription(value), { discrete: true });
        value = editor.getEditorState().read(() => {
          const walk = (node: LexicalNode) => {
            if ($isReferenceNode(node)) seen.add(`${node.exportJSON().entityType}:${node.exportJSON().entityId}`);
            if ($isLinkNode(node) && readsAsModuoAddress(node.getURL())) seen.add(`link:${node.getURL()}`);
            if ($isElementNode(node)) for (const child of node.getChildren()) walk(child);
          };
          walk($getRoot());
          return $exportDescription();
        });
      }
      for (const ref of descriptionReferences(value)) seen.add(`${ref.type}:${ref.id}`);
      return [...seen];
    }

    it("an item the key's person can't see, another workspace's id, another workspace's handle, a module the key can't open, a tag: words, never linked", async () => {
      const { write, linked } = described();
      const stored = await write(
        `[a](moduo://task/${SECRET}) [b](moduo://task/MOD-51) [c](moduo://task/${ELSEWHERE}) ` +
          `[d](moduo://task/ENG-50) [e](moduo://note/${NOTE}) [f](moduo://tag/${TAG}) ` +
          `[g](moduo://constructor/x) [h](moduo://task/MOD-50)`,
      );
      expect(stored).toBe(`a b c d e f g [task](moduo://task/${SEEN})`);
      expect(shownReferences(stored)).toEqual([`task:${SEEN}`]);
      expect(linked()).toEqual([`task:${SEEN}`]);
    });

    it("a key without Links at Edit stores the references it reaches and makes no link", async () => {
      for (const scopes of [{ tasks: "edit" }, { tasks: "edit", links: "view" }]) {
        const { write, linked } = described(scopes);
        expect(await write(`See [it](moduo://task/MOD-50)`)).toBe(`See [task](moduo://task/${SEEN})`);
        expect(linked()).toEqual([]);
      }
    });

    it("no nesting, join, spelling or HTML makes a reference out of an unchecked id", async () => {
      const crafted = [
        `[[x](moduo://task/MOD-51)](moduo://task/${SECRET})`,
        `[x]([moduo://task/${SECRET}](moduo://task/MOD-51))`,
        `[x](moduo:[//task/${SECRET}](moduo://task/MOD-51))`,
        `[x](moduo:/[/task/${SECRET}](moduo://task/${SECRET}))`,
        `[[task](moduo://task/MOD-50)](moduo://task/${SECRET})`,
        `[[x](moduo://date/2026-10-17)](moduo://task/${SECRET})`,
        `[x](moduo://task/${SECRET} "title")`,
        `[x](MODUO://task/${SECRET})`,
        `[x](<moduo://task/${SECRET}>)`,
        `[x]( moduo://task/${SECRET})`,
        `[x]&#40;moduo://task/${SECRET})`,
        `**[x]&#40;moduo://task/${SECRET})**`,
        `[x]\\(moduo://task/${SECRET})`,
        `[[a]&#40;moduo://task/${SECRET})](https://example.com)`,
        `\`[x](moduo://task/${SECRET})\``,
        `<p>See <span data-lexical-entity-ref="true" data-entity-type="task" data-entity-id="${SECRET}">Board secret</span> ` +
          `and <a href="moduo://task/${SECRET}">x</a> and <a href="moduo://task/${SECRET} &quot;chip&quot;">y</a></p>`,
        `<p>[x]&#40;moduo://task/${SECRET}) <span data-lexical-entity-ref="true" data-entity-type="task" data-entity-id="MOD-50">t</span></p>`,
        // An address spelled so only a decoding reader sees moduo: (validator, call #15).
        `See [task](moduo\\://task/${SECRET}) here`,
        `[task](moduo&#58;//task/${SECRET})`,
        `[task](&#109;oduo://task/${SECRET})`,
        `[task](moduo&#58;&#47;&#47;task&#47;${SECRET})`,
        `[task](moduo&#x3A;//task/${SECRET})`,
        `[task](mo\\duo://task/${SECRET})`,
        `[task](<moduo\\://task/${SECRET}>)`,
        `[task]( moduo\\://task/${SECRET})`,
        `[task](${" ".repeat(300)}moduo\\://task/${SECRET})`,
        `[note](moduo\\://note/${SECRET} "card")`,
        `[task](MoDuO\\://task/${SECRET} (chip))`,
        `<p><a href="moduo&amp;#58;//task/${SECRET}">x</a></p>`,
        `<p><a href="moduo\\://task/${SECRET}">x</a></p>`,
        // Checkbox and card forms, named and double-encoded references (security review).
        `- [ ] [task](moduo\\://task/${SECRET})`,
        `- [x] see [task](&#109;oduo://task/${SECRET})`,
        `[note](moduo&#58;//note/${SECRET} "card")`,
        `[task](moduo&colon;//task/${SECRET})`,
        `[task](moduo&amp;#58;//task/${SECRET})`,
        `<p><a href="moduo&#38;#58;//task/${SECRET}">x</a></p>`,
        `<ul><li><a href="moduo&amp;colon;//task/${SECRET}">x</a></li></ul>`,
        `<p><a href="moduo://task/${SECRET}">x</a></p>`,
      ];
      for (const description of crafted) {
        const { write, linked } = described();
        const stored = await write(description);
        expect(shownReferences(stored).filter((r) => r !== `task:${SEEN}`), `${description} → ${stored}`).toEqual([]);
        expect(linked().filter((r) => r !== `task:${SEEN}`), description).toEqual([]);
      }
    });
  });

  it("a tag the op makes gets the colour the app would pick, oldest bare tag first (MOD-93)", async () => {
    const tagRow = (id: string, name: string, color: string | null, at: string): Row => ({
      id, workspace_id: WS, name, color, created_at: at, deleted_at: null,
    });
    const { ctx, tables, updates } = setup({
      rpcs: {
        perm_can_tag: () => true,
        // As tasks_op_tag: a new name becomes a tag with no colour.
        tasks_op_create_with: (a) => {
          for (const name of (a.p_with as Row).tags as string[]) {
            if (!tables.tags!.some((t) => t.name === name)) {
              tables.tags!.push(tagRow(`tag-${name}`, name, null, "2030-02-01T00:00:00Z"));
            }
          }
          return { action: "created", task: task("t-new", 20, a.p_task as Row) };
        },
        tasks_op_update_with: (a) => {
          for (const name of ((a.p_with as Row).tags_add as string[] | undefined) ?? []) {
            tables.tags!.push(tagRow(`tag-${name}`, name, null, "2030-03-01T00:00:00Z"));
          }
          return [task(a.p_task_id as string, 1)];
        },
      },
    });
    tables.tags = [
      tagRow("tag-1", "board", null, "2030-01-01T00:00:00Z"),
      tagRow("tag-blue", "work", "blue", "2029-01-01T00:00:00Z"),
      tagRow("tag-gone", "old", null, "2029-01-01T00:00:00Z"),
    ];
    tables.tags[2]!.deleted_at = "2029-06-01T00:00:00Z";
    const colour = (id: string) => tables.tags!.find((t) => t.id === id)?.color;

    await call("tasks_create", { title: "x", tags: ["board", "mcp"] }, ctx);
    // blue is taken, so the bare tags get green, then amber, in the order they were made.
    expect(colour("tag-1")).toBe("green");
    expect(colour("tag-mcp")).toBe("amber");
    expect(colour("tag-blue")).toBe("blue");
    expect(colour("tag-gone")).toBeNull();

    await call("tasks_update", { task_id: "MOD-1", tags_add: ["idea"] }, ctx);
    expect(colour("tag-idea")).toBe("red");
    // Only bare tags are written, one at a time, and never a coloured one.
    expect(updates.map((u) => [u.ids, u.values])).toEqual([
      [["tag-1"], { color: "green" }],
      [["tag-mcp"], { color: "amber" }],
      [["tag-idea"], { color: "red" }],
    ]);

    // A call that adds no tags colours nothing.
    await call("tasks_update", { task_id: "MOD-1", title: "y" }, ctx);
    expect(updates).toHaveLength(3);
  });

  it("colours a template's tags too, never over a hue a person just picked, and only for someone who may edit tags (MOD-93)", async () => {
    const bare = (id: string, at: string): Row => ({
      id, workspace_id: WS, name: id, color: null, created_at: at, deleted_at: null,
    });
    let mayTag = true;
    const { ctx, tables, updates } = setup({
      rpcs: {
        perm_can_tag: () => mayTag,
        task_templates_op_apply: () => {
          tables.tags!.push(bare("tag-a", "2030-01-01T00:00:00Z"), bare("tag-b", "2030-01-02T00:00:00Z"));
          return { tasks: [task("t-open", 1)] };
        },
      },
    });
    tables.tags = [];
    // Someone picks teal for tag-a just as the connector colours it.
    const db = ctx.db as unknown as { from: (t: string) => Row };
    const from = db.from;
    db.from = (t: string) => {
      const q = from(t);
      const update = q.update as (v: Row) => Row;
      q.update = (v: Row) => {
        const a = tables.tags!.find((x) => x.id === "tag-a");
        if (a && !a.color) a.color = "teal";
        return update(v);
      };
      return q;
    };
    await call("templates_apply", { template_id: "tt-mine", kind: "task" }, ctx);
    expect(tables.tags!.map((x) => [x.id, x.color])).toEqual([
      ["tag-a", "teal"],
      // blue went to nobody (tag-a was taken), so tag-b still gets blue.
      ["tag-b", "blue"],
    ]);
    expect(updates.map((u) => u.ids)).toEqual([[], ["tag-b"]]);

    // Someone who may not edit tags colours nothing.
    mayTag = false;
    tables.tags!.push(bare("tag-c", "2030-01-03T00:00:00Z"));
    await call("templates_apply", { template_id: "tt-mine", kind: "task" }, ctx);
    expect(tables.tags!.find((x) => x.id === "tag-c")?.color).toBeNull();
  });

  it("with no colourless tag, reads just the (empty) work list, never every tag's hue (MOD-93)", async () => {
    const { ctx, tables } = setup({
      rpcs: {
        perm_can_tag: () => true,
        tasks_op_update_with: (a) => [task(a.p_task_id as string, 1)],
      },
    });
    tables.tags = [{ id: "tag-1", workspace_id: WS, name: "board", color: "blue", created_at: "2030", deleted_at: null }];
    let tagReads = 0;
    const db = ctx.db as unknown as { from: (t: string) => Row };
    const from = db.from;
    db.from = (t: string) => {
      if (t === "tags") tagReads += 1;
      return from(t);
    };
    await call("tasks_update", { task_id: "MOD-1", tags_add: ["board"] }, ctx);
    // loadWorkspace's own read (shaping the answer) plus the work list: no second hue read.
    const shaped = tagReads;
    tables.tags.push({ id: "tag-2", workspace_id: WS, name: "new", color: null, created_at: "2031", deleted_at: null });
    tagReads = 0;
    await call("tasks_update", { task_id: "MOD-1", tags_add: ["new"] }, ctx);
    expect(tagReads).toBe(shaped + 2); // + the hues in use, + the guarded update
    expect(tables.tags.find((x) => x.id === "tag-2")?.color).toBe("green");
  });

  it("tasks_session_status sends only the fields given", async () => {
    const { ctx, rpcCalls } = setup({
      rpcs: { tasks_op_agent_report: () => ({ id: "s1", agent: "Claude", state: "ready", note: "PR up", links: [] }) },
    });
    const out = await call("tasks_session_status", { task_id: "MOD-1", state: "ready", note: "PR up" }, ctx);
    expect(rpcCalls.find((c) => c.fn === "tasks_op_agent_report")?.args).toEqual({
      p_workspace_id: WS,
      p_task_id: "t-open",
      p_report: { state: "ready", note: "PR up" },
    });
    expect(out).toMatchObject({ session_id: "s1", state: "ready" });
  });

  it("projects_duplicate asks templates_can_copy first and copies nothing without Edit", async () => {
    const { ctx, rpcCalls } = setup({ rpcs: { templates_can_copy: () => false } });
    await expect(call("projects_duplicate", { project_id: P_SHARED }, ctx)).rejects.toThrow(
      "You need edit access to this project to copy it.",
    );
    expect(rpcCalls.some((c) => c.fn === "projects_op_duplicate")).toBe(false);
    await expect(call("projects_duplicate", { project_id: P_HIDDEN }, ctx)).rejects.toThrow(
      "That project isn't in this workspace.",
    );
    expect(rpcCalls.filter((c) => c.fn === "templates_can_copy")).toHaveLength(1);
  });

  it("projects_create inside an import run makes and records the project in one op", async () => {
    const { ctx, rpcCalls } = setup({
      rpcs: {
        projects_op_create: (a) => ({ id: "p-plain", name: (a.p_project as Row).name, is_system: false }),
        imports_op_project_create: (a) => ({ id: "p-new", name: (a.p_project as Row).name, is_system: false }),
      },
    });
    const made = await call("projects_create", { name: "Biology", import_id: "imp-1" }, ctx);
    expect(rpcCalls.filter((c) => c.fn.includes("project")).map((c) => c.fn)).toEqual(["imports_op_project_create"]);
    expect(rpcCalls.find((c) => c.fn === "imports_op_project_create")?.args).toEqual({
      p_workspace_id: WS,
      p_import_id: "imp-1",
      p_project: { name: "Biology" },
    });
    expect(made.id).toBe("p-new");
  });

  it("projects carry their description: read when set (never a hidden one's), written through the ops (TV-U13b)", async () => {
    const { ctx, tables, rpcCalls } = setup({
      rpcs: {
        projects_op_update: (a) => ({
          id: P_SHARED,
          name: "Launch",
          is_system: false,
          description: (a.p_patch as Row).description ?? "",
        }),
        projects_op_create: (a) => ({
          id: "p-new",
          name: (a.p_project as Row).name,
          is_system: false,
          description: (a.p_project as Row).description ?? "",
        }),
      },
    });
    const bucket = (id: string) => tables.buckets!.find((b) => b.id === id)!;
    bucket(P_SHARED).description = "Ship the beta.";
    bucket(P_HIDDEN).description = "Bea's private plans";
    bucket(INBOX).description = "";
    const listed: Row[] = await call("projects_list", {}, ctx);
    expect(listed.find((p) => p.id === P_SHARED)?.description).toBe("Ship the beta.");
    expect(listed.find((p) => p.id === INBOX)).not.toHaveProperty("description");
    expect(JSON.stringify(listed)).not.toContain("private plans");

    const updated = await call("projects_update", { project_id: P_SHARED, description: "Ship it." }, ctx);
    expect(rpcCalls.find((c) => c.fn === "projects_op_update")?.args.p_patch).toEqual({ description: "Ship it." });
    expect(updated.description).toBe("Ship it.");
    const cleared = await call("projects_update", { project_id: P_SHARED, description: null }, ctx);
    expect(rpcCalls.filter((c) => c.fn === "projects_op_update")[1]?.args.p_patch).toEqual({ description: null });
    expect(cleared).not.toHaveProperty("description");

    const made = await call("projects_create", { name: "Docs", description: "Write the docs." }, ctx);
    expect(rpcCalls.find((c) => c.fn === "projects_op_create")?.args.p_project).toEqual({
      name: "Docs",
      description: "Write the docs.",
    });
    expect(made.description).toBe("Write the docs.");
    // A project the person can't see reads as missing, and nothing is sent.
    await expect(call("projects_update", { project_id: P_HIDDEN, description: "x" }, ctx)).rejects.toThrow(
      "That project isn't in this workspace.",
    );
    expect(rpcCalls.filter((c) => c.fn === "projects_op_update")).toHaveLength(2);
  });

  it("tasks_update to done finishes the open subtasks too (call 87)", async () => {
    const statusCalls: string[] = [];
    const { ctx } = setup({
      rpcs: {
        tasks_op_update_with: (a) => [task(a.p_task_id as string, 4, { status: "done", status_category: "done" })],
        tasks_op_set_status: (a) => {
          statusCalls.push(a.p_task_id as string);
          return task(a.p_task_id as string, 5, { status: "done", status_category: "done" });
        },
      },
    });
    const out = await call("tasks_update", { task_id: "t-parent", status: "done" }, ctx);
    expect(statusCalls).toEqual(["t-sub1", "t-sub2"]);
    expect(out.also_finished).toBe(2);
  });

  it("the deprecated tasks_list_buckets keeps its group label", async () => {
    const { ctx, tables } = setup();
    (tables.buckets![1] as Row).group_label = "Clients";
    const listed = await call("tasks_list_buckets", {}, ctx);
    expect(listed.find((b: Row) => b.id === P_SHARED)).toMatchObject({ group: "Clients", area_id: A_SHARED });
  });

  it("areas_create answers with the new area only, never the rest of the list", async () => {
    const { ctx } = setup({
      rpcs: {
        areas_op_create: () => [
          { id: "a-x", name: "Bea's", created_by: BEA, created_at: "2030-01-01" },
          { id: "a-new", name: "Studio", created_by: ME, created_at: "2030-01-02", color: "teal" },
        ],
      },
    });
    expect(await call("areas_create", { name: "Studio", color: "teal" }, ctx)).toEqual({
      id: "a-new",
      name: "Studio",
      color: "teal",
    });
  });

  it("imports_begin / finish / undo call their ops for the key's workspace", async () => {
    const { ctx, rpcCalls } = setup({
      rpcs: { imports_op_begin: () => ({ id: "imp-1" }), imports_op_finish: () => ({}), imports_op_undo: () => ({}) },
    });
    await call("imports_begin", { source: "todoist", label: "Syllabus" }, ctx);
    await call("imports_finish", { import_id: "imp-1" }, ctx);
    await call("imports_undo", { import_id: "imp-1" }, ctx);
    expect(rpcCalls.map((c) => [c.fn, c.args.p_workspace_id])).toEqual([
      ["imports_op_begin", WS],
      ["imports_op_finish", WS],
      ["imports_op_undo", WS],
    ]);
  });
});

describe("levels and scopes", () => {
  const tool = (name: string) => tasksConnectorModule.tools.find((t) => t.name === name)!;
  const key = (scopes: Record<string, string>): KeyContext => ({
    id: "k",
    workspaceId: WS,
    name: "K",
    createdBy: ME,
    scopes,
  });

  it("reads at View, writes at Edit", () => {
    for (const name of ["projects_list", "areas_list", "sections_list", "statuses_list", "teams_list", "templates_list", "tasks_history"]) {
      expect(tool(name).access, name).toBe("view");
    }
    for (const name of [
      "projects_create", "projects_update", "projects_duplicate", "sections_create", "areas_create",
      "templates_apply", "tasks_route_team", "tasks_claim", "tasks_handoff", "tasks_comment",
      "tasks_session_status", "tasks_reminder_add", "tasks_work_session_add", "imports_begin", "imports_undo",
    ]) {
      expect(tool(name).access, name).toBe("edit");
    }
  });

  it("tasks_comment needs Links: Edit as well", () => {
    expect(toolAllowed(key({ tasks: "edit" }), "tasks", tool("tasks_comment"))).toBe(false);
    expect(toolAllowed(key({ tasks: "edit", links: "edit" }), "tasks", tool("tasks_comment"))).toBe(true);
  });

  it("marks the older names deprecated", () => {
    for (const name of ["tasks_today", "tasks_commit", "tasks_uncommit", "tasks_skip_today", "tasks_list_buckets"]) {
      expect(tool(name).description.startsWith("Deprecated"), name).toBe(true);
    }
  });
});
