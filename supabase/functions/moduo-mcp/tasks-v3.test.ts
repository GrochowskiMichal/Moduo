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

type Filter = { op: "eq" | "neq"; column: string; value: unknown };

function fakeDb(tables: Record<string, Row[]>, rpcs: Record<string, (args: Row) => unknown>) {
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  function from(table: string) {
    const filters: Filter[] = [];
    let window: [number, number] | null = null;
    let cap: number | null = null;
    const query = {
      select: () => query,
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
      or: () => query,
      order: () => query,
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
      then<T>(resolve: (result: { data: Row[]; error: null }) => T) {
        const value = (row: Row, column: string): unknown => {
          const json = column.match(/^(\w+)->>(\w+)$/);
          if (json) return ((row[json[1]!] as Row | null) ?? {})[json[2]!] ?? null;
          return row[column] ?? null;
        };
        let all = (tables[table] ?? []).filter((row) =>
          filters.every((f) => (f.op === "eq" ? value(row, f.column) === f.value : value(row, f.column) !== f.value)),
        );
        if (window) all = all.slice(window[0], window[1] + 1);
        if (cap !== null) all = all.slice(0, cap);
        return Promise.resolve({ data: all, error: null }).then(resolve);
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
  return { db: { from, rpc }, rpcCalls };
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

function call(name: string, args: Row, ctx: ToolContext): Promise<any> {
  const t = tasksConnectorModule.tools.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t.handler(args, ctx) as Promise<any>;
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
