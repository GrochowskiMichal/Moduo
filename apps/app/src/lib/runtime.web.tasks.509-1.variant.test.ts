// HV-15 variant of benchmarks/escapes/509-1-error-read-as-empty: `liveBucketOrInbox` drops the
// error of its "is this project live?" read, so a failed read reads as "no such project" and a
// move (or a capture) into a real project files the task in the Inbox. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/lib/runtime.web.tasks.509-1.variant.test.ts
import { beforeEach, describe, expect, it, rs } from "@rstest/core";

const h = rs.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  user: "00000000-0000-4000-8000-0000000000a1",
  ws: "00000000-0000-4000-8000-0000000000c3",
  inbox: "00000000-0000-4000-8000-0000000000aa",
  project: "00000000-0000-4000-8000-0000000000d4",
}));

rs.mock("@supabase/supabase-js", () => {
  type Call = [string, unknown[]];
  const answer = (table: string, calls: Call[]) => {
    if (table !== "buckets") return { data: null, error: null };
    const isInboxFind = calls.some(([m, a]) => m === "eq" && a[0] === "is_system");
    if (isInboxFind) {
      return {
        data: {
          id: h.inbox,
          workspace_id: h.ws,
          owner_id: h.user,
          name: "Inbox",
          is_system: true,
          position: "a0",
          created_at: "2026-10-01T00:00:00.000Z",
          updated_at: "2026-10-01T00:00:00.000Z",
          deleted_at: null,
        },
        error: null,
      };
    }
    // The project's "is it live?" read fails (a 5xx / a dropped connection).
    return { data: null, error: { message: "TypeError: Failed to fetch", code: "" } };
  };
  const chain = (table: string, calls: Call[]): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve(answer(table, calls)).then(resolve);
          }
          return (...args: unknown[]) => {
            calls.push([String(prop), args]);
            return chain(table, calls);
          };
        },
      },
    );
  const noop = () => ({ data: { subscription: { unsubscribe() {} } } });
  const auth = {
    onAuthStateChange: noop,
    getUser: async () => ({ data: { user: { id: h.user } }, error: null }),
  };
  const client = new Proxy(
    {
      from: (table: string) => chain(table, []),
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.rpcs.push({ fn, args });
        return Promise.resolve({ data: [], error: null });
      },
      auth: new Proxy(auth, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

import { webRuntime } from "./runtime.web";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 509-1: a failed project read files the task in the Inbox", () => {
  beforeEach(() => {
    h.rpcs.length = 0;
  });

  it("moving a task to a project never sends it to the Inbox because the project read failed", async () => {
    await webRuntime.tasks
      .updateTask({
        workspaceId: h.ws,
        taskId: "00000000-0000-4000-8000-0000000000f6",
        patch: { bucketId: h.project },
      })
      .catch(() => undefined);
    const sentBuckets = h.rpcs
      .filter((r) => r.fn === "tasks_op_update")
      .map((r) => (r.args.p_patch as Record<string, unknown>).bucket_id);
    // Either the project goes through or nothing is sent; never the Inbox.
    expect(sentBuckets).not.toContain(h.inbox);
  });
});
