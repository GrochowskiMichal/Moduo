// TV-T1: a hub's tag read (`listEntityTags`) asks for one entity's links and
// nothing else. It used to also run a workspace-wide read filtered on
// `tag_links.deleted_at`, a column the table doesn't have, so the whole read
// failed and every hub tag row (contacts, companies, notes, email) stayed empty.
// Runs the real runtime over a recording stand-in for the Supabase client.

import { describe, expect, it, rs } from "@rstest/core";

type Query = { table: string; calls: Array<[string, unknown[]]> };
const recorded = rs.hoisted(() => ({
  queries: [] as Query[],
  rows: {} as Record<string, unknown[]>,
}));

rs.mock("@supabase/supabase-js", () => {
  const chain = (q: Query): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            const result = { data: recorded.rows[q.table] ?? [], error: null, count: 0 };
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            q.calls.push([String(prop), args]);
            return chain(q);
          };
        },
      },
    );
  const noop = () => ({ data: { subscription: { unsubscribe() {} } } });
  const client = new Proxy(
    {
      from: (table: string) => {
        const q: Query = { table, calls: [] };
        recorded.queries.push(q);
        return chain(q);
      },
      auth: new Proxy({ onAuthStateChange: noop }, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

import { webRuntime } from "./runtime.web";

describe("listEntityTags (TV-T1)", () => {
  it("reads the workspace's tags and only this entity's links, never a deleted_at filter", async () => {
    recorded.rows.tag_links = [
      {
        id: "l1",
        workspace_id: "w1",
        tag_id: "g1",
        entity_type: "note",
        entity_id: "n1",
        created_at: "2026-10-08T12:00:00Z",
      },
    ];
    const res = await webRuntime.tasks.listEntityTags({
      workspaceId: "w1",
      entityType: "note",
      entityId: "n1",
    });

    const linkReads = recorded.queries.filter((q) => q.table === "tag_links");
    expect(linkReads).toHaveLength(1);
    expect(linkReads[0]?.calls).toEqual(
      expect.arrayContaining([
        ["eq", ["workspace_id", "w1"]],
        ["eq", ["entity_type", "note"]],
        ["eq", ["entity_id", "n1"]],
      ]),
    );
    expect(
      linkReads[0]?.calls.some(([method, args]) => method === "is" && args[0] === "deleted_at"),
    ).toBe(false);
    expect(res.links.map((l) => l.id)).toEqual(["l1"]);
  });
});
