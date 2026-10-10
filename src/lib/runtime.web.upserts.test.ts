// Saving a project (bucket) or a tag that already exists writes its editable
// fields only: the server keeps a saved row's owner, workspace and Inbox flag
// fixed and refuses a write that changes them. A new row is an insert that
// carries them. Runs the real runtime over a recording stand-in for the
// Supabase client.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

type Call = [string, unknown[]];
type Query = { table: string; calls: Call[] };
const recorded = rs.hoisted(() => ({
  queries: [] as Query[],
  /** What a `.maybeSingle()` read of each table returns (the "does it exist" check). */
  existing: {} as Record<string, unknown>,
  user: "00000000-0000-4000-8000-0000000000a1",
}));

rs.mock("@supabase/supabase-js", () => {
  const terminal = (q: Query) => {
    const write = q.calls.find(([m]) => m === "insert" || m === "update" || m === "upsert");
    if (write) {
      const payload = write[1][0] as Record<string, unknown>;
      const base = (recorded.existing[q.table] ?? {}) as Record<string, unknown>;
      return { data: { ...base, ...payload }, error: null };
    }
    if (q.calls.some(([m]) => m === "maybeSingle")) {
      return { data: recorded.existing[q.table] ?? null, error: null };
    }
    return { data: [], error: null, count: 0 };
  };
  const chain = (q: Query): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(terminal(q)).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            q.calls.push([String(prop), args]);
            return chain(q);
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
      from: (table: string) => {
        const q: Query = { table, calls: [] };
        recorded.queries.push(q);
        return chain(q);
      },
      auth: new Proxy(auth, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

const USER = recorded.user;
const OWNER = "00000000-0000-4000-8000-0000000000b2";
const WS = "00000000-0000-4000-8000-0000000000c3";
const BUCKET = "00000000-0000-4000-8000-0000000000d4";
const TAG = "00000000-0000-4000-8000-0000000000e5";
const AT = "2026-10-01T00:00:00.000Z";

import { webRuntime } from "./runtime.web";

const writesTo = (table: string) =>
  recorded.queries
    .filter((q) => q.table === table)
    .flatMap((q) => q.calls.filter(([m]) => m === "insert" || m === "update" || m === "upsert"));

beforeEach(() => {
  recorded.queries.length = 0;
  recorded.existing = {};
});

describe("upsertBucket", () => {
  const bucket = {
    id: BUCKET,
    workspaceId: WS,
    ownerId: "",
    name: "Renamed",
    isSystem: false,
    group: "Work",
    position: "b2",
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
  };

  it("re-saves an existing project with an update of its editable fields only", async () => {
    recorded.existing.buckets = {
      id: BUCKET,
      workspace_id: WS,
      owner_id: null,
      name: "Old",
      is_system: false,
      created_at: AT,
      updated_at: AT,
    };
    const saved = await webRuntime.tasks.upsertBucket(bucket);

    const writes = writesTo("buckets");
    expect(writes.map(([m]) => m)).toEqual(["update"]);
    const payload = writes[0]?.[1][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ["deleted_at", "group_label", "name", "position", "updated_at"].sort(),
    );
    expect(saved.name).toBe("Renamed");
    expect(saved.ownerId).toBe("");
  });

  it("creates a new project with an insert that carries its owner and workspace", async () => {
    await webRuntime.tasks.upsertBucket({ ...bucket, id: "" });

    const writes = writesTo("buckets");
    expect(writes.map(([m]) => m)).toEqual(["insert"]);
    expect(writes[0]?.[1][0]).toMatchObject({
      workspace_id: WS,
      owner_id: USER,
      is_system: false,
      name: "Renamed",
    });
  });
});

describe("upsertTag", () => {
  const tag = {
    id: TAG,
    workspaceId: WS,
    ownerId: OWNER,
    name: "urgent",
    color: "red",
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
  };

  it("re-saves an existing tag with an update of its editable fields only", async () => {
    recorded.existing.tags = {
      id: TAG,
      workspace_id: WS,
      owner_id: OWNER,
      name: "old",
      created_at: AT,
      updated_at: AT,
    };
    await webRuntime.tasks.upsertTag(tag);

    const writes = writesTo("tags");
    expect(writes.map(([m]) => m)).toEqual(["update"]);
    const payload = writes[0]?.[1][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ["color", "deleted_at", "name", "updated_at"].sort(),
    );
  });

  it("creates a new tag with an insert that carries its owner and workspace", async () => {
    await webRuntime.tasks.upsertTag({ ...tag, ownerId: "" });

    const writes = writesTo("tags");
    expect(writes.map(([m]) => m)).toEqual(["insert"]);
    expect(writes[0]?.[1][0]).toMatchObject({ workspace_id: WS, owner_id: USER, name: "urgent" });
  });
});
