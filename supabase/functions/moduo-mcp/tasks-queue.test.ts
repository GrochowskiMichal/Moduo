/**
 * The connector's queue tools (TV-D2, D2-6): they read and edit the queue of
 * the key's creator, and the older tools (tasks_today / tasks_commit /
 * tasks_uncommit / tasks_skip_today) still answer as aliases. Runs the real
 * handlers against an in-memory stand-in for supabase-js; the SQL behind the
 * ops has its own probe (supabase/probes/tasks-queue.probe.sql).
 */

import { describe, expect, it, rs } from "@rstest/core";

// tasks.ts pulls rrule from esm.sh, which only Deno can load; nothing here uses it.
rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

import { tasksConnectorModule } from "./modules/tasks.ts";
import type { ToolContext } from "./registry.ts";

type Row = Record<string, unknown>;

const WS = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const BEA = "33333333-3333-4333-8333-333333333333";

/** Just enough of supabase-js for these tools: from()…eq/is, and rpc(). */
function fakeDb(
  tables: Record<string, Row[]>,
  rpcs: Record<string, (args: Row) => unknown>,
  missing: string[] = [],
) {
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  function from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let window: [number, number] | null = null;
    const query = {
      select: () => query,
      range: (from: number, to: number) => {
        window = [from, to];
        return query;
      },
      maybeSingle: () =>
        query.then((r: { data: Row[] | null; error: { code?: string; message: string } | null }) => ({
          data: r.data?.[0] ?? null,
          error: r.error,
        })),
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      is: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      order: () => query,
      limit: () => query,
      then<T>(
        resolve: (result: { data: Row[] | null; error: { code?: string; message: string } | null }) => T,
      ) {
        if (missing.includes(table)) {
          return Promise.resolve({
            data: null,
            error: {
              code: "PGRST205",
              message: `Could not find the table 'public.${table}' in the schema cache`,
            },
          }).then(resolve);
        }
        const all = (tables[table] ?? []).filter((row) =>
          filters.every(([c, v]) => (row[c] ?? null) === v),
        );
        const data = window ? all.slice(window[0], window[1] + 1) : all;
        return Promise.resolve({ data, error: null }).then(resolve);
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

const task = (id: string, extra: Row = {}): Row => ({
  id,
  workspace_id: WS,
  owner_id: ME,
  assignee_id: ME,
  creator_unknown: false,
  bucket_id: "b1",
  title: id,
  status: "todo",
  position: id,
  deleted_at: null,
  ...extra,
});
const queued = (userId: string, taskId: string, position: string): Row => ({
  id: `q-${userId.slice(0, 2)}-${taskId}`,
  workspace_id: WS,
  user_id: userId,
  task_id: taskId,
  position,
});

function setup(opts: { missingQueue?: boolean; hidden?: string[]; buckets?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    buckets: opts.buckets ?? [],
    tasks: [task("t1"), task("t2"), task("t3"), task("secret"), task("old", { committed_for: "2026-10-08" })],
    task_relations: [],
    tags: [],
    tag_links: [],
    workspace_members: [
      { workspace_id: WS, user_id: ME, perms: ["tasks.edit"], profiles: { display_name: "Ada" } },
      { workspace_id: WS, user_id: BEA, perms: ["tasks.edit"], profiles: { display_name: "Bea" } },
    ],
    task_queue: [
      queued(ME, "t2", "0000018y68"),
      queued(ME, "t1", "000000mh34"),
      // Ada queued a task the key's creator can no longer see: left out.
      queued(ME, "secret", "000000a000"),
      // Bea's queue is hers.
      queued(BEA, "t3", "000000mh34"),
    ],
  };
  const hidden = new Set(opts.hidden ?? ["secret"]);
  const visible = () => tables.tasks!.map((t) => t.id as string).filter((id) => !hidden.has(id));
  const mine = () => tables.task_queue!.filter((r) => r.user_id === ME);
  const fake = fakeDb(
    tables,
    {
      share_visible_ids: () => [...visible(), ...tables.buckets!.map((b) => b.id as string)],
      // The ops act for the key's creator (perm_actor_id); here: append / drop.
      tasks_op_queue_add: (a) => {
        if (!mine().some((r) => r.task_id === a.p_task_id)) {
          tables.task_queue!.push(queued(ME, a.p_task_id as string, a.p_at === "top" ? "0000000001" : "zzzzzzzzzz"));
        }
        return mine();
      },
      tasks_op_queue_remove: (a) => {
        tables.task_queue = tables.task_queue!.filter((r) => !(r.user_id === ME && r.task_id === a.p_task_id));
        return mine();
      },
      tasks_op_queue_reorder: () => mine(),
      tasks_op_queue_move_to_end: () => mine(),
      tasks_op_commit: (a) => tables.tasks!.find((t) => t.id === a.p_task_id),
      tasks_op_uncommit: (a) => tables.tasks!.find((t) => t.id === a.p_task_id),
      tasks_op_skip_today: (a) => tables.tasks!.find((t) => t.id === a.p_task_id),
    },
    opts.missingQueue ? ["task_queue"] : [],
  );
  const ctx: ToolContext = {
    key: { id: "key-1", workspaceId: WS, name: "Agent", createdBy: ME, scopes: { tasks: "edit" } },
    db: fake.db as unknown as ToolContext["db"],
  };
  return { ctx, rpcCalls: fake.rpcCalls };
}

function call(name: string, args: Row, ctx: ToolContext): Promise<any> {
  const tool = tasksConnectorModule.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return tool.handler(args, ctx) as Promise<any>;
}
const ids = (queue: Row[]) => queue.map((t) => t.id);

describe("archived projects stay out of lists and queues; search finds them (TV-U6)", () => {
  const bucket = (id: string, extra: Row = {}): Row => ({
    id,
    workspace_id: WS,
    name: id,
    is_system: false,
    group_label: null,
    position: id,
    deleted_at: null,
    ...extra,
  });

  it("leaves an archived bucket and its tasks out of lists, queues and search", async () => {
    const { ctx } = setup({
      buckets: [bucket("b1", { archived_at: "2026-10-09T00:00:00Z" }), bucket("b2", { color: "teal" })],
    });
    expect(await call("tasks_list_buckets", {}, ctx)).toEqual([
      { id: "b2", name: "b2", is_system: false, color: "teal" },
    ]);
    // Every task in the fixture lives in b1.
    expect(await call("tasks_list", {}, ctx)).toEqual([]);
    expect((await call("tasks_queue", {}, ctx)).queue).toEqual([]);
  });

  it("lists them on request, and search finds them, labelled (REPLAN 78)", async () => {
    const { ctx } = setup({
      buckets: [bucket("b1", { archived_at: "2026-10-09T00:00:00Z" }), bucket("b2")],
    });
    expect(await call("tasks_list_buckets", { include_archived: true }, ctx)).toEqual([
      { id: "b1", name: "b1", is_system: false, archived: true },
      { id: "b2", name: "b2", is_system: false },
    ]);
    const listed = await call("tasks_list", { include_archived: true }, ctx);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((t: Row) => t.project_archived === true)).toBe(true);
  });

  it("reads a database from before the migration (no archived_at) as nothing archived", async () => {
    const { ctx } = setup({ buckets: [bucket("b1")] });
    expect(ids(await call("tasks_list", {}, ctx)).sort()).toEqual(["old", "t1", "t2", "t3"]);
  });
});

describe("the queue tools act on the key creator's queue (TV-D2)", () => {
  it("tasks_queue: the creator's own queue in order, only tasks they can see", async () => {
    const { ctx } = setup();
    const { queue } = await call("tasks_queue", {}, ctx);
    expect(ids(queue)).toEqual(["t1", "t2"]);
    expect(queue.every((t: Row) => t.queued_by_me === true)).toBe(true);
  });

  it("tasks_today is the same queue under its old name; the date is echoed, not a filter", async () => {
    const { ctx } = setup();
    const today = await call("tasks_today", {}, ctx);
    expect(ids(today.queue)).toEqual(["t1", "t2"]);
    expect(today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const other = await call("tasks_today", { date: "2026-01-01" }, ctx);
    expect(other).toEqual({ date: "2026-01-01", queue: today.queue });
  });

  it("marks queued_by_me in other reads too, never for Bea's queue", async () => {
    const { ctx } = setup();
    const list = await call("tasks_list", {}, ctx);
    const byId = new Map(list.map((t: Row) => [t.id, t]));
    expect((byId.get("t1") as Row).queued_by_me).toBe(true);
    expect("queued_by_me" in (byId.get("t3") as Row)).toBe(false);
    // The old shared day column is still shown, apart from the queue (until TV-D7).
    expect((byId.get("old") as Row).committed_for).toBe("2026-10-08");
    expect("queued_by_me" in (byId.get("old") as Row)).toBe(false);
  });

  it("tasks_queue_add / remove call the ops for the task and return the queue", async () => {
    const { ctx, rpcCalls } = setup();
    const added = await call("tasks_queue_add", { task_id: "t3" }, ctx);
    expect(rpcCalls.find((c) => c.fn === "tasks_op_queue_add")?.args).toEqual({
      p_workspace_id: WS,
      p_task_id: "t3",
      p_at: "end",
    });
    expect(ids(added.queue)).toEqual(["t1", "t2", "t3"]);
    await call("tasks_queue_add", { task_id: "t3", at: "top" }, ctx);
    expect(rpcCalls.filter((c) => c.fn === "tasks_op_queue_add").at(-1)?.args.p_at).toBe("top");
    const removed = await call("tasks_queue_remove", { task_id: "t1" }, ctx);
    expect(ids(removed.queue)).toEqual(["t2", "t3"]);
  });

  it("refuses a task the creator can't see before calling any op", async () => {
    const { ctx, rpcCalls } = setup();
    await expect(call("tasks_queue_add", { task_id: "secret" }, ctx)).rejects.toThrow(
      "Task not found in this workspace.",
    );
    expect(rpcCalls.some((c) => c.fn.startsWith("tasks_op_"))).toBe(false);
  });

  it("tasks_queue_reorder: top, end, or after another task", async () => {
    const { ctx, rpcCalls } = setup();
    await call("tasks_queue_reorder", { task_id: "t2", position: "top" }, ctx);
    await call("tasks_queue_reorder", { task_id: "t1", position: "end" }, ctx);
    await call("tasks_queue_reorder", { task_id: "t1", position: "after", after_task_id: "t2" }, ctx);
    const ops = rpcCalls.filter((c) => c.fn.startsWith("tasks_op_"));
    expect(ops).toEqual([
      { fn: "tasks_op_queue_reorder", args: { p_workspace_id: WS, p_task_id: "t2", p_after_task_id: null } },
      { fn: "tasks_op_queue_move_to_end", args: { p_workspace_id: WS, p_task_id: "t1" } },
      { fn: "tasks_op_queue_reorder", args: { p_workspace_id: WS, p_task_id: "t1", p_after_task_id: "t2" } },
    ]);
    await expect(
      call("tasks_queue_reorder", { task_id: "t1", position: "after", after_task_id: "secret" }, ctx),
    ).rejects.toThrow("Task not found in this workspace.");
  });

  it("the old write tools still call their ops (which now act on the creator's queue)", async () => {
    const { ctx, rpcCalls } = setup();
    const committed = await call("tasks_commit", { task_id: "t3", for_date: "2026-10-08" }, ctx);
    expect(committed.id).toBe("t3");
    await call("tasks_uncommit", { task_id: "t3" }, ctx);
    await call("tasks_skip_today", { task_id: "t2" }, ctx);
    expect(rpcCalls.filter((c) => c.fn.startsWith("tasks_op_"))).toEqual([
      { fn: "tasks_op_commit", args: { p_workspace_id: WS, p_task_id: "t3", p_for: "2026-10-08" } },
      { fn: "tasks_op_uncommit", args: { p_workspace_id: WS, p_task_id: "t3" } },
      { fn: "tasks_op_skip_today", args: { p_workspace_id: WS, p_task_id: "t2" } },
    ]);
  });

  it("an empty queue until the migration reaches the database", async () => {
    const { ctx } = setup({ missingQueue: true });
    expect(await call("tasks_queue", {}, ctx)).toEqual({ queue: [] });
    const list = await call("tasks_list", {}, ctx);
    expect(list.length).toBeGreaterThan(0);
  });

  it("doesn't mistake another failure on the queue for a missing table", async () => {
    const { ctx } = setup();
    const db = ctx.db as unknown as { from: (t: string) => unknown };
    const real = db.from.bind(db);
    db.from = (table: string) =>
      table === "task_queue"
        ? {
            select: () => ({
              eq: () => ({
                eq: () =>
                  Promise.resolve({
                    data: null,
                    error: { code: "57014", message: "canceling statement due to statement timeout on task_queue" },
                  }),
              }),
            }),
          }
        : real(table);
    await expect(call("tasks_queue", {}, ctx)).rejects.toThrow("statement timeout");
  });

  it("registers the queue tools at the right levels", () => {
    const level = (name: string) => tasksConnectorModule.tools.find((t) => t.name === name)?.access;
    expect(level("tasks_queue")).toBe("view");
    expect(level("tasks_today")).toBe("view");
    for (const name of ["tasks_queue_add", "tasks_queue_remove", "tasks_queue_reorder", "tasks_commit"]) {
      expect(level(name), name).toBe("edit");
    }
  });
});
