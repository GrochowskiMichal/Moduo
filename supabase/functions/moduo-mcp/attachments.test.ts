/**
 * The connector's tasks_attachments_list tool (AT-1, AT1-7): a task's ready
 * files with 5-minute links, only for tasks the key's creator can see. Runs the
 * real handler against an in-memory stand-in for supabase-js; the SQL behind
 * the rows (and who can read the objects) has its own probe
 * (supabase/probes/attachments.probe.sql).
 */

import { describe, expect, it, rs } from "@rstest/core";

// tasks.ts pulls rrule from esm.sh, which only Deno can load; nothing here uses it.
rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

import { mcpToolNeeds } from "../_shared/contracts/mcp-key-scopes.ts";
import { tasksConnectorModule } from "./modules/tasks.ts";
import { type KeyContext, toolAllowed, type ToolContext } from "./registry.ts";

type Row = Record<string, unknown>;

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "44444444-4444-4444-8444-444444444444";
const ME = "22222222-2222-4222-8222-222222222222";

function fakeDb(tables: Record<string, Row[]>, visible: string[]) {
  const signed: Array<{ bucket: string; paths: string[]; ttl: number }> = [];
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
        query.then((r: { data: Row[]; error: null }) => ({ data: r.data[0] ?? null, error: r.error })),
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      is: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      order: () => query,
      then<T>(resolve: (result: { data: Row[]; error: null }) => T) {
        const all = (tables[table] ?? []).filter((row) =>
          filters.every(([c, v]) => (row[c] ?? null) === v),
        );
        const data = window ? all.slice(window[0], window[1] + 1) : all;
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return query;
  }
  const rpc = async (fn: string) =>
    fn === "share_visible_ids"
      ? { data: visible, error: null }
      : { data: null, error: { message: `unexpected rpc ${fn}` } };
  const storage = {
    from: (bucket: string) => ({
      createSignedUrls: async (paths: string[], ttl: number) => {
        signed.push({ bucket, paths, ttl });
        return {
          data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}?ttl=${ttl}`, error: null })),
          error: null,
        };
      },
    }),
  };
  return { db: { from, rpc, storage }, signed };
}

const task = (id: string, extra: Row = {}): Row => ({
  id,
  workspace_id: WS,
  owner_id: ME,
  assignee_id: ME,
  bucket_id: "b1",
  title: id,
  status: "todo",
  position: id,
  deleted_at: null,
  ...extra,
});

const file = (id: string, taskId: string, extra: Row = {}): Row => ({
  id,
  workspace_id: WS,
  entity_type: "task",
  entity_id: taskId,
  file_name: `${id}.png`,
  mime: "image/png",
  size_bytes: 1234,
  width: 800,
  height: 600,
  created_at: "2026-10-08T10:00:00Z",
  object_path: `${WS}/${id}/original.png`,
  status: "ready",
  deleted_at: null,
  ...extra,
});

function setup(visible = ["t1", "t2"]) {
  const tables: Record<string, Row[]> = {
    tasks: [task("t1"), task("t2"), task("secret")],
    attachments: [
      file("a1", "t1"),
      file("a2", "t1"),
      file("pending", "t1", { status: "pending" }),
      file("failed", "t1", { status: "failed" }),
      file("trashed", "t1", { deleted_at: "2026-10-08T11:00:00Z" }),
      file("elsewhere", "t1", { workspace_id: OTHER_WS }),
      file("s1", "secret"),
    ],
  };
  const fake = fakeDb(tables, visible);
  const ctx = {
    key: { id: "k1", workspaceId: WS, name: "Agent", createdBy: ME, scopes: { tasks: "view" } },
    db: fake.db,
  } as unknown as ToolContext;
  return { ctx, signed: fake.signed };
}

const tool = tasksConnectorModule.tools.find((t) => t.name === "tasks_attachments_list");

describe("tasks_attachments_list", () => {
  it("is a read tool any key with Tasks View can use", () => {
    const key = (tasks: string): KeyContext => ({
      id: "k1",
      workspaceId: WS,
      name: "Agent",
      createdBy: ME,
      scopes: { tasks },
    });
    expect(tool?.access).toBe("view");
    expect(mcpToolNeeds("tasks_attachments_list")).toEqual([]);
    expect(toolAllowed(key("view"), "tasks", tool!)).toBe(true);
    expect(toolAllowed(key("none"), "tasks", tool!)).toBe(false);
  });

  it("lists the task's ready files with 5-minute links from the attachments bucket", async () => {
    const { ctx, signed } = setup();

    const result = (await tool!.handler({ task_id: "t1" }, ctx)) as {
      link_lifetime_seconds: number;
      attachments: Array<Record<string, unknown>>;
    };

    expect(result.link_lifetime_seconds).toBe(300);
    expect(result.attachments.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(result.attachments[0]).toEqual({
      id: "a1",
      name: "a1.png",
      mime: "image/png",
      size_bytes: 1234,
      width: 800,
      height: 600,
      added_at: "2026-10-08T10:00:00Z",
      url: `https://signed.example/${WS}/a1/original.png?ttl=300`,
    });
    expect(signed).toEqual([
      { bucket: "attachments", paths: [`${WS}/a1/original.png`, `${WS}/a2/original.png`], ttl: 300 },
    ]);
  });

  it("answers not found for a task the key's creator can't see, and signs nothing", async () => {
    const { ctx, signed } = setup(["t1"]);

    await expect(tool!.handler({ task_id: "secret" }, ctx)).rejects.toThrow(
      "Task not found in this workspace.",
    );
    expect(signed).toEqual([]);
  });

  it("returns an empty list without asking Storage when the task has no files", async () => {
    const { ctx, signed } = setup();

    const result = (await tool!.handler({ task_id: "t2" }, ctx)) as { attachments: unknown[] };

    expect(result.attachments).toEqual([]);
    expect(signed).toEqual([]);
  });
});
