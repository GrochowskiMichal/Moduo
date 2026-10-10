/**
 * TV-D8 on the connector: task lists page past PostgREST's 1,000-row cap
 * (AC1.13), results lead with the handle, and agents create and edit tasks
 * through tasks_op_create / tasks_op_update (AC12.1). Runs the real handlers
 * against an in-memory stand-in for supabase-js that, like PostgREST, answers
 * at most 1,000 rows a request; the SQL behind the ops has its own tests
 * (supabase/tests/tasks_ops.test.sql).
 */

import { describe, expect, it, rs } from "@rstest/core";

// tasks.ts pulls rrule from esm.sh, which only Deno can load; nothing here uses it.
rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

import { readAllPages } from "../_shared/tasks-connector.ts";
import { tasksConnectorModule } from "./modules/tasks.ts";
import type { ToolContext } from "./registry.ts";

type Row = Record<string, unknown>;

const WS = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const BUCKET = "33333333-3333-4333-8333-333333333333";
const MAX_ROWS = 1000;

function fakeDb(tables: Record<string, Row[]>, rpcs: Record<string, (args: Row) => unknown>) {
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  const requests: Array<{ table: string; from: number; to: number }> = [];
  function from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let window: [number, number] = [0, Number.MAX_SAFE_INTEGER];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      is: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      or: () => query,
      order: () => query,
      limit: (n: number) => {
        window = [0, n - 1];
        return query;
      },
      range: (a: number, b: number) => {
        window = [a, b];
        return query;
      },
      maybeSingle: () =>
        query.then((r: { data: Row[]; error: null }) => ({ data: r.data[0] ?? null, error: null })),
      then<T>(resolve: (result: { data: Row[]; error: null }) => T) {
        requests.push({ table, from: window[0], to: window[1] });
        const all = (tables[table] ?? []).filter((row) =>
          filters.every(([c, v]) => (row[c] ?? null) === v),
        );
        // PostgREST's hard cap: never more than MAX_ROWS in one answer.
        const end = Math.min(window[1] + 1, window[0] + MAX_ROWS);
        return Promise.resolve({ data: all.slice(window[0], end), error: null }).then(resolve);
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
  return { db: { from, rpc }, rpcCalls, requests };
}

const pad = (n: number) => String(n).padStart(5, "0");
const task = (n: number, extra: Row = {}): Row => ({
  id: `t${pad(n)}`,
  number: n,
  workspace_id: WS,
  owner_id: ME,
  assignee_id: ME,
  creator_unknown: false,
  bucket_id: BUCKET,
  title: `Task ${n}`,
  status: "todo",
  position: pad(n),
  deleted_at: null,
  ...extra,
});

function setup(count: number) {
  const tables: Record<string, Row[]> = {
    tasks: Array.from({ length: count }, (_, i) => task(i + 1)),
    task_relations: [],
    tags: [],
    tag_links: [],
    task_queue: [],
    buckets: [
      { id: BUCKET, workspace_id: WS, position: "a", is_system: false, deleted_at: null },
    ],
    workspaces: [{ id: WS, task_key: "MOD" }],
    workspace_members: [
      { workspace_id: WS, user_id: ME, perms: ["tasks.edit"], profiles: { display_name: "Ada" } },
    ],
  };
  const fake = fakeDb(tables, {
    share_visible_ids: (a) =>
      a.p_resource_type === "bucket" ? [BUCKET] : tables.tasks!.map((t) => t.id as string),
    perm_can_see_entity: () => true,
    tasks_op_create: (a) => {
      const created = task(count + 1, { ...(a.p_task as Row), id: "tnew" });
      tables.tasks!.push(created);
      return created;
    },
    tasks_op_update: (a) => {
      const t = tables.tasks!.find((x) => x.id === a.p_task_id)!;
      Object.assign(t, a.p_patch as Row);
      return [t];
    },
  });
  const ctx: ToolContext = {
    key: { id: "key-1", workspaceId: WS, name: "Agent", createdBy: ME, scopes: { tasks: "edit" } },
    db: fake.db as unknown as ToolContext["db"],
  };
  return { ctx, tables, ...fake };
}

function call(name: string, args: Row, ctx: ToolContext) {
  const t = tasksConnectorModule.tools.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t.handler(args, ctx);
}

describe("readAllPages", () => {
  it("reads every row past a 1,000-row cap, one page at a time", async () => {
    const all = Array.from({ length: 2_345 }, (_, i) => i);
    const pages: Array<[number, number]> = [];
    const got = await readAllPages<number>(async (from, to) => {
      pages.push([from, to]);
      return { data: all.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null };
    });
    expect(got).toHaveLength(2_345);
    expect(pages).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("throws the read's error", async () => {
    await expect(
      readAllPages(async () => ({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });
});

describe("MCP task lists page past 1,000 (AC1.13)", () => {
  it("tasks_list reaches tasks after the first 1,000", async () => {
    const { ctx } = setup(1_500);
    const page = (await call("tasks_list", { offset: 1_400, limit: 200 }, ctx)) as Row[];
    expect(page).toHaveLength(100);
    expect(page[0]?.title).toBe("Task 1401");
    expect(page.at(-1)?.title).toBe("Task 1500");
  });

  it("leads each task with its handle", async () => {
    const { ctx } = setup(3);
    const page = (await call("tasks_list", {}, ctx)) as Row[];
    expect(Object.keys(page[0]!)[0]).toBe("handle");
    expect(page.map((t) => t.handle)).toEqual(["MOD-1", "MOD-2", "MOD-3"]);
  });
});

describe("agents create and edit through the ops (AC12.1)", () => {
  it("tasks_create calls tasks_op_create with the fields given", async () => {
    const { ctx, rpcCalls } = setup(2);
    const created = (await call(
      "tasks_create",
      { title: "From the agent", bucket_id: BUCKET, due_date: "2026-10-20T00:00:00Z", priority: "high" },
      ctx,
    )) as Row;
    const op = rpcCalls.find((c) => c.fn === "tasks_op_create");
    expect(op?.args).toEqual({
      p_workspace_id: WS,
      p_task: {
        title: "From the agent",
        bucket_id: BUCKET,
        due_date: "2026-10-20T00:00:00.000Z",
        priority: "high",
      },
    });
    expect(created.handle).toBe("MOD-3");
  });

  it("tasks_update sends only what changes, and null clears", async () => {
    const { ctx, rpcCalls } = setup(2);
    await call("tasks_update", { task_id: "t00001", title: "Renamed", due_date: null }, ctx);
    const op = rpcCalls.find((c) => c.fn === "tasks_op_update");
    expect(op?.args).toEqual({
      p_workspace_id: WS,
      p_task_id: "t00001",
      p_patch: { title: "Renamed", due_date: null },
    });
  });

  it("tasks_update refuses a call with nothing to change", async () => {
    const { ctx } = setup(1);
    await expect(call("tasks_update", { task_id: "t00001" }, ctx)).rejects.toThrow("Nothing to change");
  });
});
