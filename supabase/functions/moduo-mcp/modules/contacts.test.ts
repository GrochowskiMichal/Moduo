/**
 * MOD-572, the connector half: the contact write tools ask whether the key's
 * person can reach the contact before they call the op, so a private contact
 * reads as not found and the op never runs. (The op's own guard is the SQL
 * half: supabase/tests/contacts_guard_access.test.sql.)
 */

import { describe, expect, it, rs } from "@rstest/core";

const PRIVATE = "55555555-5555-4555-8555-555555555555";
const MINE = "66666666-6666-4666-8666-666666666666";

const reached: Array<{ type: string; ref: string }> = [];
rs.mock("../share.ts", () => ({
  assertReach: async (_ctx: unknown, type: string, ref: string) => {
    reached.push({ type, ref });
    if (ref === PRIVATE) throw new Error("No contact with that id in this workspace.");
    return ref;
  },
  assertLiveLinkInScope: async () => {},
  linksInScope: (_ctx: unknown, links: unknown[]) => links,
  visibleIds: async () => new Set<string>(),
}));

import type { ToolContext } from "../registry.ts";
import { contactsConnectorModule } from "./contacts.ts";

type Row = Record<string, any>;

function fakeCtx() {
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  const db = {
    rpc: async (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      return { data: { id: args.p_contact_id, name: "Jane", status: "lead" }, error: null };
    },
  };
  const ctx: ToolContext = {
    key: { id: "key-1", workspaceId: "ws-1", name: "Research bot", createdBy: "u-1", scopes: {} } as any,
    db: db as any,
  };
  return { ctx, rpcCalls };
}

function tool(name: string) {
  const t = contactsConnectorModule.tools.find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
}

const CASES: Array<[string, Row]> = [
  ["contacts_update", { name: "Janet" }],
  ["contacts_set_status", { status: "lead" }],
  ["contacts_delete", {}],
];

describe("contact write tools check reach first", () => {
  for (const [name, extra] of CASES) {
    it(`${name} refuses a contact the key's person can't see, without calling the op`, async () => {
      const { ctx, rpcCalls } = fakeCtx();
      reached.length = 0;
      await expect(tool(name).handler({ contact_id: PRIVATE, ...extra }, ctx)).rejects.toThrow(
        "No contact with that id",
      );
      expect(reached).toEqual([{ type: "contact", ref: PRIVATE }]);
      expect(rpcCalls).toEqual([]);
    });

    it(`${name} passes the reached id to the op`, async () => {
      const { ctx, rpcCalls } = fakeCtx();
      await tool(name).handler({ contact_id: ` ${MINE} `, ...extra }, ctx);
      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0].args.p_contact_id).toBe(MINE);
    });
  }
});

/**
 * GS-5 (specs/global-search.md AC3, AC4): the agent's contacts search is the
 * server's contacts__search and companies__search, the same rows ⌘K gets. The
 * key's scope and its person's access are applied there, before the limit, so
 * the tool filters nothing after the fact (the old limit-then-filter).
 */
describe("contacts_search uses contacts__search and companies__search", () => {
  const WS = "ws-1";
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const CO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const HIDDEN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  const hit = (type: string, id: string, over: Row = {}): Row => ({
    entity_type: type,
    entity_id: id,
    title: "Quince",
    context: null,
    snippet: null,
    icon: null,
    match: "title",
    rank: 0.75,
    updated_at: "2026-10-28T09:00:00Z",
    archived: false,
    ...over,
  });

  function searchDb(opts: { people?: Row[]; companies?: Row[]; tables?: Record<string, Row[]> }) {
    const rpcCalls: Array<{ fn: string; args: Row }> = [];
    function from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const query: any = {
        select: () => query,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), query),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), query),
        then<T>(resolve: (res: { data: Row[]; error: null }) => T) {
          const data = (opts.tables?.[table] ?? []).filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    }
    async function rpc(fn: string, args: Row) {
      rpcCalls.push({ fn, args });
      if (fn === "contacts__search") return { data: opts.people ?? [], error: null };
      if (fn === "companies__search") return { data: opts.companies ?? [], error: null };
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    }
    const ctx: ToolContext = {
      key: { id: "key-1", workspaceId: WS, name: "Reader", createdBy: "u-1", scopes: { contacts: "view" } } as any,
      db: { from, rpc } as any,
    };
    return { ctx, rpcCalls };
  }

  it("returns exactly the rows the server functions return, in their order, with context and snippet", async () => {
    const { ctx, rpcCalls } = searchDb({
      people: [
        hit("contact", B, { title: "Wanda Quince", context: "Acme" }),
        hit("contact", A, {
          title: "Edith Body",
          match: "body",
          snippet: "edith@\uE000quincefarm\uE001.example",
        }),
      ],
      companies: [hit("company", CO, { title: "Quince Ltd", context: "quince.example" })],
      tables: {
        contacts: [
          { id: A, workspace_id: WS, name: "Edith Body", email: "edith@quincefarm.example", status: "lead" },
          { id: B, workspace_id: WS, name: "Wanda Quince", company_id: CO, title: "CEO", status: "client" },
          // A row the server didn't return never comes back, whatever the table holds.
          { id: HIDDEN, workspace_id: WS, name: "Quince hidden", status: "lead" },
        ],
        companies: [{ id: CO, workspace_id: WS, name: "Quince Ltd", domains: ["quince.example"], website: null }],
      },
    });
    const out = (await tool("contacts_search").handler({ query: " quince ", limit: 5 }, ctx)) as Row;
    expect(rpcCalls).toEqual([
      { fn: "contacts__search", args: { p_workspace_id: WS, p_query: "quince", p_limit: 5 } },
      { fn: "companies__search", args: { p_workspace_id: WS, p_query: "quince", p_limit: 5 } },
    ]);
    expect(out.contacts.map((c: Row) => c.id)).toEqual([B, A]);
    expect(out.contacts[0]).toMatchObject({
      id: B,
      name: "Wanda Quince",
      title: "CEO",
      company_id: CO,
      company: "Acme",
      status: "client",
      match: "title",
      snippet: null,
    });
    expect(out.contacts[1]).toMatchObject({
      email: "edith@quincefarm.example",
      match: "body",
      snippet: "edith@**quincefarm**.example",
    });
    expect(out.companies).toEqual([
      { id: CO, name: "Quince Ltd", domains: ["quince.example"], website: null, match: "title" },
    ]);
  });

  it("caps the limit at 50 and defaults it to 20", async () => {
    const { ctx, rpcCalls } = searchDb({});
    await tool("contacts_search").handler({ query: "acme", limit: 500 }, ctx);
    await tool("contacts_search").handler({ query: "acme" }, ctx);
    expect(rpcCalls.map((c) => c.args.p_limit)).toEqual([50, 50, 20, 20]);
  });
});
