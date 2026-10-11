// TV-D10 · the structure reads and ops the app runs (runtime.web.structure.ts),
// against a fake Supabase client: what each call sends, how answers map, and
// the fallbacks for a database before the migration.

import { describe, expect, it } from "@rstest/core";

import type { Area, Bucket } from "../features/tasks/model";
import { createTasksStructure, projectFieldsToOp } from "./runtime.web.structure";

type Answer = { data: unknown; error: { code?: string; message?: string } | null };

const NOW = "2026-10-11T10:00:00Z";
const missingFn = (fn: string): Answer => ({
  data: null,
  error: { code: "PGRST202", message: `Could not find the function public.${fn}` },
});

function fakeClient(opts: {
  tables?: Record<string, Answer>;
  rpc?: Record<string, Answer | ((args: Record<string, unknown>) => Answer)>;
}) {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const client = {
    from(table: string) {
      const answer = opts.tables?.[table] ?? { data: [], error: null };
      // A real promise with the builder's chain methods on it.
      const query = Promise.resolve({ ...answer, count: null }) as Promise<unknown> &
        Record<string, unknown>;
      for (const m of ["select", "eq", "is", "not", "gte", "order", "range", "maybeSingle"]) {
        query[m] = () => query;
      }
      return query;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push([fn, args]);
      const a = opts.rpc?.[fn];
      if (!a) return { data: null, error: { message: `unexpected ${fn}` } };
      return typeof a === "function" ? a(args) : a;
    },
  };
  const legacy: {
    upserts: Bucket[];
    blocks: Array<[string, unknown]>;
    deletes: Array<[string, string]>;
  } = {
    upserts: [],
    blocks: [],
    deletes: [],
  };
  const api = createTasksStructure(client as never, {
    userId: async () => "u1",
    upsertBucketLegacy: async (bucket) => {
      legacy.upserts.push(bucket);
      return bucket;
    },
    deleteProjectLegacy: async (ws, id) => {
      legacy.deletes.push([ws, id]);
    },
    getTimeBlocksLegacy: async () => ({ morning: "legacy-project" }),
    setTimeBlocksLegacy: async (ws, blocks) => {
      legacy.blocks.push([ws, blocks]);
      return blocks;
    },
  });
  return { api, rpcCalls, legacy };
}

const project: Bucket = {
  id: "p1",
  workspaceId: "ws",
  ownerId: "u1",
  name: "Acme",
  isSystem: false,
  group: null,
  position: "a1",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};
const bucketRow = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  workspace_id: "ws",
  owner_id: "u1",
  name: "Acme",
  is_system: false,
  group_label: null,
  position: "a1",
  status: "active",
  starts_on: null,
  target_on: null,
  lead_id: null,
  client_contact_id: null,
  area_id: null,
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
  ...over,
});
const areaRow = (id: string, name: string, position: number) => ({
  id,
  workspace_id: "ws",
  name,
  color: null,
  position,
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
});

describe("project fields (AC4.1)", () => {
  it("send only the keys given, in the ops' names", () => {
    expect(
      projectFieldsToOp({ status: "on_hold", targetOn: "2026-12-18", leadId: null, areaId: "a1" }),
    ).toEqual({ status: "on_hold", target_on: "2026-12-18", lead_id: null, area_id: "a1" });
    expect(projectFieldsToOp({})).toEqual({});
  });

  it("map back from the row, status read laxly", async () => {
    const { api } = fakeClient({
      rpc: {
        projects_op_update: {
          data: bucketRow({ status: "paused", target_on: "2026-12-18", area_id: "a1" }),
          error: null,
        },
      },
    });
    const saved = await api.updateProject({
      workspaceId: "ws",
      projectId: "p1",
      patch: { targetOn: "2026-12-18" },
    });
    expect([saved.status, saved.targetOn, saved.areaId]).toEqual(["active", "2026-12-18", "a1"]);
  });

  it("before the migration, a rename still saves the old way", async () => {
    const { api, legacy } = fakeClient({
      rpc: { projects_op_update: missingFn("projects_op_update") },
    });
    await api.updateProject({
      workspaceId: "ws",
      projectId: "p1",
      patch: { name: "Acme rebrand" },
      fallback: project,
    });
    expect(legacy.upserts.map((b) => b.name)).toEqual(["Acme rebrand"]);
  });
});

describe("the rail's Section menu files a project into an area", () => {
  const areas: Area[] = [
    {
      id: "a1",
      workspaceId: "ws",
      name: "Clients",
      color: null,
      position: 1,
      shared: true,
      createdBy: "u1",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];

  it("files it on the server by name, in one op", async () => {
    const { api, rpcCalls } = fakeClient({
      rpc: {
        projects_op_file: {
          data: bucketRow({ area_id: "a1", group_label: "Clients" }),
          error: null,
        },
      },
    });
    const { project: moved, areas: made } = await api.setProjectArea({
      workspaceId: "ws",
      project,
      areaName: " Clients ",
      areas,
    });
    expect(rpcCalls).toEqual([
      ["projects_op_file", { p_workspace_id: "ws", p_project_id: "p1", p_area_name: "Clients" }],
    ]);
    // The area was already in the app's list: nothing to reload.
    expect([moved.areaId, moved.group, made]).toEqual(["a1", "Clients", null]);
  });

  it("reloads the areas you can see when the server made a new one", async () => {
    const { api } = fakeClient({
      rpc: {
        projects_op_file: {
          data: bucketRow({ area_id: "a2", group_label: "School" }),
          error: null,
        },
      },
      tables: {
        areas: { data: [areaRow("a1", "Clients", 1), areaRow("a2", "School", 2)], error: null },
      },
    });
    const { project: moved, areas: made } = await api.setProjectArea({
      workspaceId: "ws",
      project,
      areaName: "School",
      areas,
    });
    expect(moved.areaId).toBe("a2");
    expect(made?.map((a) => a.name)).toEqual(["Clients", "School"]);
  });

  it("takes it out of its area with no name", async () => {
    const { api, rpcCalls } = fakeClient({
      rpc: { projects_op_file: { data: bucketRow(), error: null } },
    });
    const { areas: made } = await api.setProjectArea({
      workspaceId: "ws",
      project,
      areaName: null,
      areas,
    });
    expect(rpcCalls[0]?.[1].p_area_name).toBeNull();
    expect(made).toBeNull();
  });

  it("before the migration, writes the old label", async () => {
    const { api, legacy } = fakeClient({
      rpc: { projects_op_file: missingFn("projects_op_file") },
    });
    await api.setProjectArea({ workspaceId: "ws", project, areaName: "School", areas });
    expect(legacy.upserts.map((b) => b.group)).toEqual(["School"]);
  });
});

describe("reads", () => {
  it("carry the structure with the bundle, and an older database reads as empty", async () => {
    const missing = (t: string): Answer => ({
      data: null,
      error: { code: "PGRST205", message: `Could not find the table 'public.${t}'` },
    });
    const { api } = fakeClient({
      tables: {
        areas: { data: [areaRow("a1", "Clients", 1)], error: null },
        sections: missing("sections"),
        teams: missing("teams"),
        team_members: missing("team_members"),
      },
    });
    const structure = await api.listStructure("ws");
    expect(structure.areas.map((a) => a.name)).toEqual(["Clients"]);
    expect([
      structure.sections,
      structure.teams,
      structure.teamMembers,
      structure.truncated,
    ]).toEqual([[], [], [], []]);
  });

  it("drop rows this build can't read instead of failing", async () => {
    const { api } = fakeClient({
      tables: {
        task_waiting: {
          data: [
            {
              id: "w1",
              workspace_id: "ws",
              task_id: "t1",
              kind: "carrier_pigeon",
              ref: null,
              label: "?",
              since: NOW,
              created_by: null,
              created_at: NOW,
              updated_at: NOW,
              deleted_at: null,
            },
            { id: "w2", workspace_id: "ws", task_id: "t1" },
          ],
          error: null,
        },
      },
    });
    const { waiting } = await api.listWaiting("ws");
    expect(waiting.map((w) => [w.id, w.kind])).toEqual([["w1", "text"]]);
  });
});

describe("time blocks are each person's own", () => {
  it("read your map for the workspace from your preferences", async () => {
    const { api } = fakeClient({
      tables: {
        user_preferences: {
          data: {
            task_time_blocks: { ws: { morning: "p1", noon: "p2" }, other: { evening: "p9" } },
          },
          error: null,
        },
      },
    });
    expect(await api.getTimeBlocks("ws")).toEqual({ morning: "p1" });
  });

  it("fall back to the workspace table before the migration", async () => {
    const { api, legacy } = fakeClient({
      tables: {
        user_preferences: {
          data: null,
          error: {
            code: "42703",
            message: "column user_preferences.task_time_blocks does not exist",
          },
        },
      },
      rpc: { tasks_op_set_time_blocks: missingFn("tasks_op_set_time_blocks") },
    });
    expect(await api.getTimeBlocks("ws")).toEqual({ morning: "legacy-project" });
    await api.setTimeBlocks("ws", { evening: "p1" });
    expect(legacy.blocks).toEqual([["ws", { evening: "p1" }]]);
  });
});

describe("TV-U6: colours, archiving, deleting, Recently deleted", () => {
  it("colour and archive go to the op; the server stamps the time, never an owner", () => {
    expect(projectFieldsToOp({ color: "teal" })).toEqual({ color: "teal" });
    expect(projectFieldsToOp({ color: null, archived: true })).toEqual({
      color: null,
      archived_at: "now",
    });
    expect(projectFieldsToOp({ archived: false })).toEqual({ archived_at: null });
    const sent = projectFieldsToOp({ name: "Acme", color: "red", archived: true });
    for (const key of ["owner_id", "is_system", "workspace_id"]) expect(sent).not.toHaveProperty(key);
  });

  it("deletes through projects_op_delete and reads what it did", async () => {
    const { api, rpcCalls } = fakeClient({
      rpc: {
        projects_op_delete: {
          data: { batch_id: "b", moved: 4, deleted: 12, notified: 2 },
          error: null,
        },
      },
    });
    const done = await api.deleteProject({ workspaceId: "ws", projectId: "p1" });
    expect(done).toEqual({ moved: 4, deleted: 12, notified: 2, restorable: true });
    expect(rpcCalls).toEqual([["projects_op_delete", { p_workspace_id: "ws", p_project_id: "p1" }]]);
  });

  it("before the migration, the old delete runs and says it can't be restored", async () => {
    const { api, legacy } = fakeClient({
      rpc: { projects_op_delete: missingFn("projects_op_delete") },
    });
    const done = await api.deleteProject({ workspaceId: "ws", projectId: "p1" });
    expect(done.restorable).toBe(false);
    expect(legacy.deletes).toEqual([["ws", "p1"]]);
  });

  it("a refused delete fails with the server's words", async () => {
    const { api, legacy } = fakeClient({
      rpc: {
        projects_op_delete: {
          data: null,
          error: { code: "42501", message: "Only people with full access to this project can delete or restore it." },
        },
      },
    });
    await expect(api.deleteProject({ workspaceId: "ws", projectId: "p1" })).rejects.toThrow(
      /full access/,
    );
    expect(legacy.deletes).toEqual([]);
  });

  it("Restore and Delete forever name what they act on", async () => {
    const { api, rpcCalls } = fakeClient({
      rpc: {
        tasks_op_trash_restore: { data: { projects: 1, tasks: 2, moved: 3 }, error: null },
        tasks_op_trash_purge: { data: { projects: 1, tasks: 2 }, error: null },
      },
    });
    await api.restoreTrash({ workspaceId: "ws", entityType: "bucket", entityId: "p1" });
    await api.purgeTrash({ workspaceId: "ws", entityType: "task", entityId: "t1" });
    expect(rpcCalls).toEqual([
      ["tasks_op_trash_restore", { p_workspace_id: "ws", p_entity_type: "bucket", p_entity_id: "p1" }],
      ["tasks_op_trash_purge", { p_workspace_id: "ws", p_entity_type: "task", p_entity_id: "t1" }],
    ]);
  });

  it("Recently deleted reads deleted projects and tasks, never an Inbox", async () => {
    const { api } = fakeClient({
      tables: {
        buckets: {
          data: [
            bucketRow({ deleted_at: NOW, deleted_batch_id: "batch", trash_moved_task_ids: ["t9"] }),
            bucketRow({ id: "in", is_system: true, deleted_at: NOW }),
          ],
          error: null,
        },
        tasks: { data: [], error: null },
      },
    });
    const trash = await api.listTrash("ws");
    expect(trash.buckets.map((b) => [b.bucket.id, b.batchId, b.movedTaskIds])).toEqual([
      ["p1", "batch", ["t9"]],
    ]);
  });

  it("asks whether you have Full access to a project", async () => {
    const { api, rpcCalls } = fakeClient({
      rpc: { share_op_state: { data: { visible: true, canManage: false }, error: null } },
    });
    expect(await api.projectAccess({ projectId: "p1" })).toEqual({ canManage: false });
    expect(rpcCalls[0]).toEqual(["share_op_state", { p_type: "bucket", p_id: "p1" }]);
  });
});
