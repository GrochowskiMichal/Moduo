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
      for (const m of ["select", "eq", "is", "order", "range", "maybeSingle"]) {
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
  const legacy: { upserts: Bucket[]; blocks: Array<[string, unknown]> } = {
    upserts: [],
    blocks: [],
  };
  const api = createTasksStructure(client as never, {
    userId: async () => "u1",
    upsertBucketLegacy: async (bucket) => {
      legacy.upserts.push(bucket);
      return bucket;
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
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];

  it("moves it into the area of that name", async () => {
    const { api, rpcCalls } = fakeClient({
      rpc: {
        projects_op_move: {
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
      [
        "projects_op_move",
        { p_workspace_id: "ws", p_project_id: "p1", p_area_id: "a1", p_position: null },
      ],
    ]);
    expect([moved.areaId, moved.group, made]).toEqual(["a1", "Clients", null]);
  });

  it("makes the area first when it's new, and answers with the areas", async () => {
    const { api, rpcCalls } = fakeClient({
      rpc: {
        areas_op_create: {
          data: [areaRow("a1", "Clients", 1), areaRow("a2", "School", 2)],
          error: null,
        },
        projects_op_move: {
          data: bucketRow({ area_id: "a2", group_label: "School" }),
          error: null,
        },
      },
    });
    const { areas: made } = await api.setProjectArea({
      workspaceId: "ws",
      project,
      areaName: "School",
      areas,
    });
    expect(rpcCalls.map(([fn]) => fn)).toEqual(["areas_op_create", "projects_op_move"]);
    expect(rpcCalls[1]?.[1].p_area_id).toBe("a2");
    expect(made?.map((a) => a.name)).toEqual(["Clients", "School"]);
  });

  it("takes it out of its area with no name", async () => {
    const { api, rpcCalls } = fakeClient({
      rpc: { projects_op_move: { data: bucketRow(), error: null } },
    });
    await api.setProjectArea({ workspaceId: "ws", project, areaName: null, areas });
    expect(rpcCalls[0]?.[1].p_area_id).toBeNull();
  });

  it("before the migration, writes the old label", async () => {
    const { api, legacy } = fakeClient({ rpc: { areas_op_create: missingFn("areas_op_create") } });
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
