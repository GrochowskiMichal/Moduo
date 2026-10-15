/**
 * The connector's key-scope checks (KEYS-1), run for real against an
 * in-memory stand-in for supabase-js: which tools a key lists and may call,
 * whether it can reach one item, and how results that cross into another
 * module are filtered. The SQL side has its own recipe in
 * docs/testing/t-maciej-api-key-module-scopes.md.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it, rs } from "@rstest/core";

import { MCP_TOOL_NEEDS } from "../_shared/contracts/mcp-key-scopes.ts";

// tasks.ts pulls rrule from esm.sh, which only Deno can load; nothing here uses it.
rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

import { calendarConnectorModule } from "./modules/calendar.ts";
import { linksConnectorModule } from "./modules/links.ts";
import {
  type ConnectorModule,
  connectorModules,
  findTool,
  type KeyContext,
  type ToolContext,
  type ToolDef,
  toolAllowed,
  toolRequirement,
  toolsForKey,
} from "./registry.ts";
import { assertLiveLinkInScope, assertReach, canReach, linksInScope } from "./share.ts";

type Row = Record<string, unknown>;
type Filter = { op: "eq" | "is" | "in" | "ilike" | "lt" | "gte"; column: string; value: unknown };

/** Just enough of supabase-js for the connector's reads: from()…filters, and rpc(). */
function fakeDb(tables: Record<string, Row[]>, rpcs: Record<string, (args: Row) => unknown> = {}) {
  const queries: Array<{ table: string; filters: Filter[] }> = [];
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  /** `.or()` filter strings, as sent (the fake doesn't apply them). */
  const ors: string[] = [];
  const matches = (row: Row, f: Filter): boolean => {
    const v = row[f.column];
    switch (f.op) {
      case "eq":
        return v === f.value;
      case "is":
        return (v ?? null) === f.value;
      case "in":
        return (f.value as unknown[]).includes(v);
      case "ilike":
        return String(v ?? "")
          .toLowerCase()
          .includes(String(f.value).replaceAll("%", "").toLowerCase());
      case "lt":
        return String(v) < String(f.value);
      case "gte":
        return String(v) >= String(f.value);
    }
  };
  function from(table: string) {
    const filters: Filter[] = [];
    let orderBy: string | null = null;
    let max = Number.POSITIVE_INFINITY;
    let skip = 0;
    const add = (op: Filter["op"]) => (column: string, value: unknown) => {
      filters.push({ op, column, value });
      return query;
    };
    const query = {
      select: () => query,
      eq: add("eq"),
      is: add("is"),
      in: add("in"),
      ilike: add("ilike"),
      lt: add("lt"),
      gte: add("gte"),
      or: (expr: string) => {
        ors.push(expr);
        return query;
      },
      order: (column: string) => {
        orderBy = column;
        return query;
      },
      limit: (n: number) => {
        max = n;
        return query;
      },
      range: (from: number, to: number) => {
        skip = from;
        max = to - from + 1;
        return query;
      },
      maybeSingle: () =>
        query.then((r: { data: Row[]; error: null }) => ({ data: r.data[0] ?? null, error: r.error })),
      then<T>(resolve: (result: { data: Row[]; error: null }) => T) {
        queries.push({ table, filters });
        let data = (tables[table] ?? []).filter((row) => filters.every((f) => matches(row, f)));
        const by = orderBy;
        if (by) data = [...data].sort((a, b) => String(a[by]).localeCompare(String(b[by])));
        return Promise.resolve({ data: data.slice(skip, skip + max), error: null }).then(resolve);
      },
    };
    return query;
  }
  async function rpc(fn: string, args: Row) {
    rpcCalls.push({ fn, args });
    const impl = rpcs[fn];
    return impl ? { data: impl(args), error: null } : { data: null, error: { message: `unexpected rpc ${fn}` } };
  }
  return { db: { from, rpc }, queries, rpcCalls, ors };
}

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const ME = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const LINK = "55555555-5555-4555-8555-555555555555";

const key = (scopes: Record<string, string>): KeyContext => ({
  id: "key-1",
  workspaceId: WS,
  name: "Agent",
  createdBy: ME,
  scopes,
});
const ctx = (scopes: Record<string, string>, db: ReturnType<typeof fakeDb>["db"]): ToolContext => ({
  key: key(scopes),
  db: db as unknown as ToolContext["db"],
});
const names = (k: KeyContext) => toolsForKey(k).map((t) => t.name);
function tool(module: ConnectorModule, name: string): ToolDef {
  const found = module.tools.find((t) => t.name === name);
  if (!found) throw new Error(`${name} is not registered on ${module.module}`);
  return found;
}

describe("which tools a key lists and may call", () => {
  it("lists only its modules' tools at its level, and nothing for none or an unknown level", () => {
    const viewTasks = toolsForKey(key({ tasks: "view" }));
    expect(viewTasks.length).toBeGreaterThan(0);
    // The Tasks module's tools (TV-D16: projects, sections, areas, statuses,
    // teams, templates and imports are Tasks' too).
    const tasksPrefix = /^(tasks|projects|sections|areas|statuses|teams|templates|imports)_/;
    for (const t of viewTasks) {
      expect(tasksPrefix.test(t.name), t.name).toBe(true);
      expect(t.access, t.name).toBe("view");
    }
    expect(toolsForKey(key({}))).toEqual([]);
    expect(toolsForKey(key({ tasks: "admin", notes: "write" }))).toEqual([]);
  });

  it("gives an Edit-everywhere key every tool", () => {
    const everything = Object.fromEntries(connectorModules.map((m) => [m.module, "edit"]));
    expect(names(key(everything))).toEqual(connectorModules.flatMap((m) => m.tools.map((t) => t.name)));
  });

  it("keeps Links tools from a key without Links, and suggestions behind Links: Edit", () => {
    const linkTools = linksConnectorModule.tools.map((t) => t.name);
    const noLinks = names(key({ tasks: "edit", notes: "edit", contacts: "edit" }));
    for (const t of linkTools) expect(noLinks).not.toContain(t);
    const view = names(key({ links: "view" }));
    expect(view).toEqual(expect.arrayContaining(["links_search_entities", "links_list"]));
    expect(view).not.toContain("links_suggest");
    expect(view).not.toContain("links_create");
    expect(names(key({ links: "edit" }))).toContain("links_suggest");
  });

  it("needs Tasks: Edit as well for the four task-block tools", () => {
    const blockTools = MCP_TOOL_NEEDS.filter((n) => n.needs === "tasks").map((n) => n.tool);
    expect(blockTools).toHaveLength(4);
    const calendarOnly = names(key({ calendar: "edit", tasks: "view" }));
    expect(calendarOnly).toContain("calendar_create_event");
    for (const t of blockTools) expect(calendarOnly).not.toContain(t);
    const both = names(key({ calendar: "edit", tasks: "edit" }));
    for (const t of blockTools) expect(both).toContain(t);
  });

  it("needs Links: Edit as well for notes_link", () => {
    expect(names(key({ notes: "edit" }))).not.toContain("notes_link");
    expect(names(key({ notes: "edit", links: "edit" }))).toContain("notes_link");
  });

  it("refuses the same tools when called, and says everything they need", () => {
    const move = findTool("calendar_move_block");
    if (!move) throw new Error("calendar_move_block is not registered");
    expect(toolAllowed(key({ calendar: "edit", tasks: "view" }), move.module, move.tool)).toBe(false);
    expect(toolAllowed(key({ calendar: "edit", tasks: "edit" }), move.module, move.tool)).toBe(true);
    expect(toolRequirement(move.module, move.tool)).toBe("Calendar: Edit and Tasks: Edit");
    const list = findTool("tasks_list");
    if (!list) throw new Error("tasks_list is not registered");
    expect(toolRequirement(list.module, list.tool)).toBe("Tasks: View");
  });

  it("registers every tool a cross-module need names, on that module and level", () => {
    for (const need of MCP_TOOL_NEEDS) {
      const found = findTool(need.tool);
      expect(found?.module, need.tool).toBe(need.module);
      expect(found?.tool.access, need.tool).toBe(need.access);
    }
  });
});

describe("reaching one item", () => {
  const live = { id: TASK, workspace_id: WS, deleted_at: null };
  const seen = (answer: boolean) => ({ perm_can_see_entity: () => answer });

  it("reaches a live item in its workspace that its creator can open", async () => {
    const { db, queries, rpcCalls } = fakeDb({ tasks: [live] }, seen(true));
    expect(await canReach(ctx({ tasks: "view" }, db), "task", TASK)).toBe(true);
    expect(queries[0]?.table).toBe("tasks");
    expect(queries[0]?.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "workspace_id", value: WS },
        { op: "is", column: "deleted_at", value: null },
      ]),
    );
    expect(rpcCalls).toEqual([
      { fn: "perm_can_see_entity", args: { p_workspace_id: WS, p_type: "task", p_id: TASK } },
    ]);
  });

  it("doesn't reach, or ask the database, without the module, for an unknown type, or for a non-canonical id", async () => {
    const { db, queries, rpcCalls } = fakeDb({ tasks: [live] }, seen(true));
    expect(await canReach(ctx({ notes: "edit" }, db), "task", TASK)).toBe(false);
    expect(await canReach(ctx({ tasks: "edit" }, db), "payment", TASK)).toBe(false);
    expect(await canReach(ctx({ tasks: "edit" }, db), "task", TASK.replaceAll("-", ""))).toBe(false);
    expect(queries).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("doesn't reach an item in another workspace, a deleted one, or one its creator can't open", async () => {
    const other = fakeDb({ tasks: [{ ...live, workspace_id: OTHER_WS }] }, seen(true));
    expect(await canReach(ctx({ tasks: "view" }, other.db), "task", TASK)).toBe(false);
    const deleted = fakeDb({ tasks: [{ ...live, deleted_at: "2026-10-01T00:00:00Z" }] }, seen(true));
    expect(await canReach(ctx({ tasks: "view" }, deleted.db), "task", TASK)).toBe(false);
    const hidden = fakeDb({ tasks: [live] }, seen(false));
    expect(await canReach(ctx({ tasks: "view" }, hidden.db), "task", TASK)).toBe(false);
  });

  it("says why, without confirming that a private item exists", async () => {
    const { db } = fakeDb({ tasks: [live] }, seen(false));
    await expect(assertReach(ctx({ tasks: "edit" }, db), "payment", TASK)).rejects.toThrow(
      'Agents can\'t work with "payment" items.',
    );
    await expect(assertReach(ctx({ chat: "edit" }, db), "chat_channel", TASK)).rejects.toThrow(
      'Agents can\'t work with "chat_channel" items.',
    );
    await expect(assertReach(ctx({ notes: "edit" }, db), "task", TASK)).rejects.toThrow(
      "This API key has no access to Tasks.",
    );
    await expect(assertReach(ctx({ tasks: "edit" }, db), "task", TASK)).rejects.toThrow(
      "No task with that id in this workspace.",
    );
    await expect(assertReach(ctx({ email: "view" }, db), "email_thread", TASK)).rejects.toThrow(
      "No email thread with that id in this workspace.",
    );
  });

  it("takes a task's handle as well as its uuid, and answers the uuid (MOD-112)", async () => {
    const tables = { workspaces: [{ id: WS, task_key: "MOD" }], tasks: [{ ...live, number: 142 }] };
    const { db } = fakeDb(tables, seen(true));
    const reach = (ref: string) => assertReach(ctx({ tasks: "view" }, db), "task", ref);
    expect(await reach("MOD-142")).toBe(TASK);
    expect(await reach("mod-142")).toBe(TASK);
    expect(await reach(TASK)).toBe(TASK);
    const missing = "No task with that id in this workspace.";
    await expect(reach("MOD-9")).rejects.toThrow(missing);
    await expect(reach("ENG-142")).rejects.toThrow(missing);
    // A hidden task's handle reads exactly like a missing one.
    const hidden = fakeDb(tables, seen(false));
    await expect(assertReach(ctx({ tasks: "view" }, hidden.db), "task", "MOD-142")).rejects.toThrow(missing);
    // Without Tasks on the key, the handle isn't looked up at all.
    const none = fakeDb(tables, seen(true));
    await expect(assertReach(ctx({ links: "edit" }, none.db), "task", "MOD-142")).rejects.toThrow(
      "This API key has no access to Tasks.",
    );
    expect(none.queries).toEqual([]);
  });

  it("links and comments name a task by its handle; the ops get its uuid (MOD-112)", async () => {
    const NOTE = "66666666-6666-4666-8666-666666666666";
    const tables = {
      workspaces: [{ id: WS, task_key: "MOD" }],
      tasks: [{ ...live, number: 142 }],
      notes: [{ id: NOTE, workspace_id: WS, deleted_at: null }],
      entity_links: [],
    };
    const { db, rpcCalls, ors } = fakeDb(tables, {
      ...seen(true),
      links_op_create: (a) => ({ id: LINK, ...a }),
      comments_op_add: () => ({ id: "c-1", created_at: "2030-01-01T00:00:00Z" }),
      links_suggest: () => [],
    });
    const c = ctx({ tasks: "edit", notes: "edit", links: "edit" }, db);
    await tool(linksConnectorModule, "links_create").handler(
      { source_type: "task", source_id: "MOD-142", target_type: "note", target_id: NOTE },
      c,
    );
    await tool(linksConnectorModule, "comments_add").handler(
      { entity_type: "task", entity_id: "MOD-142", body: "Done?" },
      c,
    );
    await tool(linksConnectorModule, "links_list").handler({ entity_type: "task", entity_id: "MOD-142" }, c);
    await tool(linksConnectorModule, "links_suggest").handler({ entity_type: "task", entity_id: "MOD-142" }, c);
    const sent = (fn: string) => rpcCalls.find((call) => call.fn === fn)?.args;
    expect(sent("links_op_create")).toMatchObject({ p_source_id: TASK, p_target_id: NOTE });
    expect(sent("comments_op_add")).toMatchObject({ p_entity_type: "task", p_entity_id: TASK });
    expect(sent("links_suggest")).toMatchObject({ p_entity_id: TASK });
    expect(ors).toEqual([
      `and(source_type.eq.task,source_id.eq.${TASK}),and(target_type.eq.task,target_id.eq.${TASK})`,
    ]);
  });
});

describe("links an agent can touch", () => {
  const taskNote = { id: LINK, workspace_id: WS, deleted_at: null, source_type: "task", target_type: "note" };
  const everything = { tasks: "edit", notes: "edit", links: "edit" };

  it("refuses a link id that Postgres would read but the lookup would miss", async () => {
    const { db, queries } = fakeDb({ entity_links: [taskNote] });
    for (const id of [LINK.replaceAll("-", ""), `{${LINK}}`]) {
      await expect(assertLiveLinkInScope(ctx(everything, db), id)).rejects.toThrow(
        "No link with that id in this workspace.",
      );
    }
    expect(queries).toEqual([]);
  });

  it("refuses a live link with an end the key can't see, and leaves a gone one to the op", async () => {
    const { db } = fakeDb({ entity_links: [taskNote] });
    await expect(assertLiveLinkInScope(ctx({ tasks: "edit", links: "edit" }, db), LINK)).rejects.toThrow(
      "This API key has no access to Notes, which this link touches.",
    );
    await expect(
      assertLiveLinkInScope(ctx({ tasks: "edit", notes: "view", links: "edit" }, db), LINK),
    ).resolves.toBeUndefined();
    const gone = fakeDb({ entity_links: [{ ...taskNote, deleted_at: "2026-10-01T00:00:00Z" }] });
    await expect(assertLiveLinkInScope(ctx({ links: "edit" }, gone.db), LINK)).resolves.toBeUndefined();
  });

  it("drops listed links with an end the key can't see", () => {
    const links = [
      { id: "a", source_type: "task", target_type: "note" },
      { id: "b", source_type: "task", target_type: "contact" },
      { id: "c", source_type: "task", target_type: "payment" },
    ];
    const kept = linksInScope(ctx({ tasks: "view", notes: "view" }, fakeDb({}).db), links);
    expect(kept.map((l) => l.id)).toEqual(["a"]);
  });
});

describe("links_search_entities", () => {
  const search = tool(linksConnectorModule, "links_search_entities");
  const notes = Array.from({ length: 100 }, (_, i) => ({
    workspace_id: WS,
    deleted_at: null,
    entity_type: "note",
    entity_id: `note-${i}`,
    label: `a note ${String(i).padStart(3, "0")}`,
    icon: null,
  }));
  const task = {
    workspace_id: WS,
    deleted_at: null,
    entity_type: "task",
    entity_id: TASK,
    label: "zz the task",
    icon: null,
  };
  const shared = (ids: Record<string, string[]>) => ({
    share_visible_ids: (args: Row) => ids[String(args.p_resource_type)] ?? [],
  });

  it("filters by the key's modules in the query, so another module's rows can't fill the page", async () => {
    const { db, queries } = fakeDb({ entities: [...notes, task] }, shared({ task: [TASK] }));
    const found = await search.handler({}, ctx({ tasks: "view", links: "view" }, db));
    expect(found).toEqual([{ type: "task", id: TASK, label: "zz the task", icon: null }]);
    expect(queries[0]?.filters).toContainEqual({
      op: "in",
      column: "entity_type",
      value: ["task", "bucket", "task_project"],
    });
  });

  it("keeps only the asked-for types the key can see, and skips the query when none are left", async () => {
    const both = fakeDb({ entities: [...notes, task] }, shared({ task: [TASK], note: ["note-1"] }));
    const found = await search.handler({ types: ["note", "task"] }, ctx({ tasks: "view", links: "view" }, both.db));
    expect(found).toEqual([{ type: "task", id: TASK, label: "zz the task", icon: null }]);
    const notesOnly = fakeDb({ entities: [...notes, task] }, shared({ note: ["note-1"] }));
    expect(await search.handler({ types: ["note"] }, ctx({ tasks: "view", links: "view" }, notesOnly.db))).toEqual([]);
    expect(notesOnly.queries).toEqual([]);
  });

  it("still drops items the key's creator can't open", async () => {
    const { db } = fakeDb({ entities: [...notes, task] }, shared({}));
    expect(await search.handler({}, ctx({ tasks: "view", links: "view" }, db))).toEqual([]);
  });

  it("never returns a conversation, even with Chat on the key: apps read chat through the chat tools", async () => {
    const channel = {
      workspace_id: WS,
      deleted_at: null,
      entity_type: "chat_channel",
      entity_id: "channel-1",
      label: "secret-plans",
      icon: null,
    };
    const { db, queries } = fakeDb({ entities: [channel, task] }, shared({ task: [TASK] }));
    const found = await search.handler({}, ctx({ chat: "view", tasks: "view", links: "view" }, db));
    expect(found).toEqual([{ type: "task", id: TASK, label: "zz the task", icon: null }]);
    const typesAsked = queries[0]?.filters.find((f) => f.column === "entity_type")?.value;
    expect(typesAsked).not.toContain("chat_channel");
    expect(typesAsked).not.toContain("chat_message");
    const chatOnly = fakeDb({ entities: [channel] }, shared({}));
    expect(await search.handler({ types: ["chat_channel"] }, ctx({ chat: "edit", links: "view" }, chatOnly.db))).toEqual([]);
    expect(chatOnly.queries).toEqual([]);
  });
});

describe("calendar_day", () => {
  const day = tool(calendarConnectorModule, "calendar_day");
  const event = {
    id: "event-1",
    workspace_id: WS,
    deleted_at: null,
    owner_id: ME,
    calendar_ref: null,
    title: "Standup",
    start_time: "2020-01-15T10:00:00.000Z",
    end_time: "2020-01-15T10:15:00.000Z",
    source_account_id: null,
  };
  const block = {
    id: TASK,
    workspace_id: WS,
    deleted_at: null,
    title: "Write the brief",
    scheduled_at: "2020-01-15T09:00:00.000Z",
    duration_minutes: 30,
    status: "todo",
  };
  const shared = (tasks: string[]) => ({
    share_visible_ids: (args: Row) => (args.p_resource_type === "task" ? tasks : []),
  });

  it("leaves task blocks out, and says so, for a key without Tasks", async () => {
    const { db, queries, rpcCalls } = fakeDb({ calendar_events: [event], tasks: [block] }, shared([TASK]));
    const result = (await day.handler({ date: "2020-01-15" }, ctx({ calendar: "view" }, db))) as Row;
    expect((result.events as Row[]).map((e) => e.id)).toEqual(["event-1"]);
    expect(result.blocks).toEqual([]);
    expect(result.strip).toEqual([]);
    expect(result.note).toBe("Task blocks are left out: this API key has no access to Tasks.");
    expect(queries.some((q) => q.table === "tasks")).toBe(false);
    expect(rpcCalls.map((c) => c.args.p_resource_type)).toEqual(["calendar"]);
  });

  it("shows a Tasks key the blocks its creator can open, and no others", async () => {
    const open = fakeDb({ calendar_events: [event], tasks: [block] }, shared([TASK]));
    const result = (await day.handler(
      { date: "2020-01-15" },
      ctx({ calendar: "view", tasks: "view" }, open.db),
    )) as Row;
    expect((result.blocks as Row[]).map((b) => b.task_id)).toEqual([TASK]);
    expect(result.note).toBeUndefined();
    const hidden = fakeDb({ calendar_events: [event], tasks: [block] }, shared([]));
    const none = (await day.handler(
      { date: "2020-01-15" },
      ctx({ calendar: "view", tasks: "view" }, hidden.db),
    )) as Row;
    expect(none.blocks).toEqual([]);
    expect(none.strip).toEqual([]);
  });
});

describe("connector wiring", () => {
  it("refuses an expired key in authenticate()", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).toContain("apiKeyExpired(data.expires_at)");
  });
});
