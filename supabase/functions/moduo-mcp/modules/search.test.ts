/**
 * GS-7 (specs/global-search.md AC11, AC3): one MCP `search` tool over
 * `search_all`, run as the key's actor.
 *
 * `search_all` resolves the key itself (perm_actor_id() through the
 * x-moduo-key-id header, the module functions' key scopes); the database is an
 * in-memory stand-in here, so these tests pin what the connector adds: the one
 * call it makes, the 50 cap, the row shape an agent reads, and a second check
 * that drops any row whose module the key can't view (a chat row reaching a
 * key without Chat never leaves the connector).
 */

import { describe, expect, it, rs } from "@rstest/core";

// The registry loads Calendar, which imports rrule from esm.sh (Deno only).
rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

import { entityOpenTarget } from "../../../../apps/app/src/lib/entity-open";
import { MCP_ENTITY_TYPE_MODULES } from "../../_shared/contracts/mcp-key-scopes.ts";
import { parseToolArgs } from "../../_shared/contracts/mcp-tool-args.ts";
import { type KeyContext, type ToolContext, toolAllowed, toolsForKey } from "../registry.ts";
import { openPath, searchConnectorModule } from "./search.ts";

type Row = Record<string, any>;

const WS = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

const key = (scopes: Record<string, string>): KeyContext => ({
  id: "key-1",
  workspaceId: WS,
  name: "Reader",
  createdBy: ACTOR,
  scopes,
});

const tool = searchConnectorModule.tools.find((t) => t.name === "search")!;

/** A search_all row (SearchAllRow), as PostgREST sends it. */
const hit = (type: string, id: string, over: Row = {}): Row => ({
  entity_type: type,
  entity_id: id,
  title: `A ${type}`,
  context: null,
  snippet: null,
  icon: null,
  match: "title",
  rank: 0.8,
  updated_at: "2026-10-28T09:00:00Z",
  archived: false,
  score: 0.7,
  type_total: 1,
  top: false,
  ...over,
});

function searchDb(rows: Row[], error: { message: string } | null = null) {
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  const tableReads: string[] = [];
  async function rpc(fn: string, args: Row) {
    rpcCalls.push({ fn, args });
    if (fn === "search_all") return error ? { data: null, error } : { data: rows, error: null };
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  }
  const from = (table: string) => {
    tableReads.push(table);
    throw new Error(`unexpected table read ${table}`);
  };
  return { db: { rpc, from } as any, rpcCalls, tableReads };
}

/** Call the tool the way the server does: arguments parsed first. */
async function call(scopes: Record<string, string>, args: Row, rows: Row[]) {
  const { db, rpcCalls, tableReads } = searchDb(rows);
  const parsed = parseToolArgs("search", args);
  if (!parsed.success) throw new Error(parsed.message);
  const ctx: ToolContext = { key: key(scopes), db };
  const out = (await tool.handler(parsed.data, ctx)) as Row[];
  return { out, rpcCalls, tableReads };
}

const ALL_VIEW = { tasks: "view", notes: "view", calendar: "view", email: "view", contacts: "view", chat: "view" };

describe("one search tool", () => {
  it("calls search_all once, as the key, with no item open", async () => {
    const { rpcCalls, tableReads } = await call(ALL_VIEW, { query: "  kumquat " }, []);
    expect(tableReads).toEqual([]);
    expect(rpcCalls).toEqual([
      {
        fn: "search_all",
        args: {
          p_workspace_id: WS,
          p_query: "kumquat",
          p_types: null,
          p_limit_per_type: 20,
          p_context_type: null,
          p_context_id: null,
        },
      },
    ]);
  });

  it("returns search_all's rows in its order, each with what an agent needs to open it", async () => {
    const rows = [
      hit("note", "n1", {
        title: "Retro",
        context: "Planning",
        snippet: "We tasted a kumquat at lunch",
        match: "body",
        top: true,
      }),
      hit("task", "t1", { title: "Buy kumquats", archived: true }),
      hit("contact", "c1", { title: "Kumquat Ltd" }),
    ];
    const { out } = await call(ALL_VIEW, { query: "kumquat" }, rows);
    expect(out.map((r) => [r.type, r.id])).toEqual([
      ["note", "n1"],
      ["task", "t1"],
      ["contact", "c1"],
    ]);
    expect(out[0]).toMatchObject({
      type: "note",
      id: "n1",
      title: "Retro",
      context: "Planning",
      snippet: "We tasted a **kumquat** at lunch",
      archived: false,
    });
    expect(out[1]!.archived).toBe(true);
    for (const r of out) {
      expect(Object.keys(r)).toEqual(expect.arrayContaining(["type", "id", "title", "context", "snippet", "archived", "url"]));
      // Plain text: no private-use match marks survive.
      expect(String(r.snippet ?? "")).not.toMatch(/[]/);
    }
  });

  it("links each row to where it opens in the app", async () => {
    const { out } = await call(
      ALL_VIEW,
      { query: "kumquat" },
      [hit("note", "n1"), hit("task", "t1"), hit("bucket", "b1"), hit("contact", "c1"), hit("company", "co1"), hit("event", "e1")],
    );
    const url = Object.fromEntries(out.map((r) => [r.id, r.url]));
    expect(url.n1).toMatch(/^https:\/\/[^/]+\/notes\?id=n1$/);
    expect(url.t1).toMatch(/\/tasks\?id=t1$/);
    expect(url.b1).toMatch(/\/tasks\?id=b1$/);
    expect(url.c1).toMatch(/\/contacts\?type=contact&id=c1$/);
    expect(url.co1).toMatch(/\/contacts\?type=company&id=co1$/);
    expect(url.e1).toMatch(/\/calendar\?event=e1$/);
  });

  it("names an untitled item 'Untitled'", async () => {
    const { out } = await call(ALL_VIEW, { query: "kumquat" }, [hit("note", "n1", { title: "  " })]);
    expect(out[0]!.title).toBe("Untitled");
  });

  it("passes the types filter through, without knowing the types", async () => {
    const { rpcCalls } = await call(ALL_VIEW, { query: "plan", types: ["note", "task"] }, []);
    expect(rpcCalls[0]!.args.p_types).toEqual(["note", "task"]);
  });

  it("caps the limit at 50 and defaults it to 20", async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      hit(["note", "task", "contact"][i % 3]!, `id-${i}`),
    );
    const capped = await call(ALL_VIEW, { query: "plan", limit: 500 }, many);
    expect(capped.rpcCalls[0]!.args.p_limit_per_type).toBe(50);
    expect(capped.out).toHaveLength(50);
    expect(capped.out.map((r) => r.id)).toEqual(many.slice(0, 50).map((r) => r.entity_id));
    const byDefault = await call(ALL_VIEW, { query: "plan" }, many);
    expect(byDefault.out).toHaveLength(20);
    const small = await call(ALL_VIEW, { query: "plan", limit: 3 }, many);
    expect(small.rpcCalls[0]!.args.p_limit_per_type).toBe(3);
    expect(small.out).toHaveLength(3);
  });

  it("a key without Chat gets no chat rows, even if one reaches the connector", async () => {
    const rows = [hit("chat_message", "m1"), hit("chat_channel", "ch1"), hit("note", "n1"), hit("task", "t1")];
    const { out } = await call({ notes: "view", tasks: "edit" }, { query: "launch" }, rows);
    expect(out.map((r) => r.type)).toEqual(["note", "task"]);
    const asked = await call({ notes: "view" }, { query: "launch", types: ["chat_message"] }, rows);
    expect(asked.out.some((r) => String(r.type).startsWith("chat"))).toBe(false);
  });

  it("a notes-only key gets only notes", async () => {
    const rows = [hit("task", "t1"), hit("note", "n1"), hit("contact", "c1"), hit("event", "e1"), hit("note", "n2")];
    const { out } = await call({ notes: "view" }, { query: "launch" }, rows);
    expect(out.map((r) => r.id)).toEqual(["n1", "n2"]);
  });

  it("keeps chat rows for a key with Chat", async () => {
    const { out } = await call({ chat: "view" }, { query: "launch" }, [hit("chat_message", "m1"), hit("note", "n1")]);
    expect(out.map((r) => r.id)).toEqual(["m1"]);
  });

  it("drops a row no module owns: no key may see it", async () => {
    const { out } = await call(ALL_VIEW, { query: "launch" }, [hit("payment", "p1"), hit("note", "n1")]);
    expect(out.map((r) => r.id)).toEqual(["n1"]);
  });

  it("says what went wrong when search_all fails", async () => {
    const { db } = searchDb([], { message: "canceling statement due to statement timeout" });
    const parsed = parseToolArgs("search", { query: "plan" });
    if (!parsed.success) throw new Error(parsed.message);
    await expect(tool.handler(parsed.data, { key: key(ALL_VIEW), db })).rejects.toThrow(/statement timeout/);
  });

  it("refuses a call without a query", () => {
    expect(parseToolArgs("search", {}).success).toBe(false);
    expect(parseToolArgs("search", { query: "  " }).success).toBe(false);
  });
});

describe("which keys list search", () => {
  it("is a read every key with View on a searchable module lists", () => {
    expect(tool.access).toBe("view");
    expect(tool.hints).toBe("read");
    for (const scopes of [{ notes: "view" }, { tasks: "edit" }, { chat: "view" }, { contacts: "view" }, ALL_VIEW]) {
      expect(toolsForKey(key(scopes)).map((t) => t.name), JSON.stringify(scopes)).toContain("search");
      expect(toolAllowed(key(scopes), searchConnectorModule.module, tool)).toBe(true);
    }
  });

  it("is hidden from a key that can search nothing", () => {
    for (const scopes of [{}, { links: "edit" }, { tasks: "none", notes: "none" }, { tasks: "admin" }]) {
      expect(toolsForKey(key(scopes)).map((t) => t.name), JSON.stringify(scopes)).not.toContain("search");
      expect(toolAllowed(key(scopes), searchConnectorModule.module, tool)).toBe(false);
    }
  });
});

describe("the open link matches the app's entity-open map", () => {
  it("routes every searchable type where the app opens it, or nowhere when the app can't", () => {
    for (const type of Object.keys(MCP_ENTITY_TYPE_MODULES)) {
      const target = entityOpenTarget(type, "x-1");
      const expected = target ? `${target.to}?${new URLSearchParams(target.search).toString()}` : null;
      expect(openPath(type, "x-1"), type).toBe(expected);
    }
  });
});
