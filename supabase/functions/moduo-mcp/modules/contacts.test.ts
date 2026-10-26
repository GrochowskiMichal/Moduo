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
