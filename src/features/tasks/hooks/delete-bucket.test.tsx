// TV-U6 — deleting, archiving and editing projects in the real hook over an
// in-memory runtime (REPLAN 78): a delete leaves every surface at once, sends
// the op right away, puts only your own open work in your Inbox meanwhile, and
// its Undo restores the batch; an archive asks the server for Full access
// (through the op), takes the project out of lists and counts, and with "Won't
// do" or "Move" acts on the open tasks first; colours, areas and moves go
// through `projects_op_update` with only the changed fields.
//
// The pending-change store is module-level (shared by every hook instance, by
// design), so each test uses its own project ids.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

type ToastOpts = {
  action: { onClick: () => void };
  onAutoClose?: () => void;
  onDismiss?: () => void;
  description?: unknown;
};
const toastMock = rs.hoisted(() => {
  let n = 0;
  const fn = rs.fn((..._args: unknown[]) => `toast-${++n}`);
  return Object.assign(fn, { dismiss: rs.fn(), error: rs.fn(), message: rs.fn() });
});
rs.mock("sonner", () => ({ toast: toastMock }));

// Live updates (TV-D5) need a socket; these tests drive the hook without one.
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

import type { Area, Bucket, Task } from "../model";
import { useTasksModule } from "./use-tasks-module";

const WS = "ws-projects";
const NOW = "2026-10-01T00:00:00.000Z";

function bucket(id: string, name: string, extra: Partial<Bucket> = {}): Bucket {
  return {
    id,
    workspaceId: WS,
    ownerId: "u1",
    name,
    isSystem: false,
    group: null,
    position: `b-${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  };
}

function task(id: string, bucketId: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    workspaceId: WS,
    creatorId: "u1",
    creatorUnknown: false,
    assigneeId: "u1",
    bucketId,
    parentId: null,
    title: id,
    description: "",
    dueDate: null,
    scheduledAt: null,
    durationMinutes: null,
    timeSpentSeconds: 0,
    recurrence: null,
    energyLevel: null,
    priority: null,
    status: "todo",
    committedFor: null,
    commitOrder: null,
    rescheduleCount: 0,
    position: id,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  };
}

/**
 * A workspace with the Inbox, project `<p>x` (mine, Anna's and a done task)
 * and project `<p>y`, an area `<p>a`; the server applies REPLAN 78 like
 * `projects_op_delete` (open work to its assignee's Inbox, the rest trashed).
 */
function makeServer(p: string) {
  const ids = { inbox: `${p}inbox`, x: `${p}x`, y: `${p}y`, area: `${p}a` };
  const server = {
    buckets: [
      bucket(ids.inbox, "Inbox", { isSystem: true, position: "a" }),
      bucket(ids.x, "X"),
      bucket(ids.y, "Y"),
    ],
    tasks: [
      task(`${p}mine`, ids.x),
      task(`${p}annas`, ids.x, { assigneeId: "anna" }),
      task(`${p}done`, ids.x, { status: "done" }),
      task(`${p}other`, ids.y),
    ],
    areas: [] as Area[],
  };
  const list = () => ({
    buckets: server.buckets.filter((b) => !b.deletedAt).map((b) => ({ ...b })),
    // Anna's Inbox is hers: its tasks aren't readable here.
    tasks: server.tasks
      .filter((t) => !t.deletedAt && t.bucketId !== "annas-inbox")
      .map((t) => ({ ...t })),
    tags: [],
    tagLinks: [],
    taskRelations: [],
    areas: server.areas.map((a) => ({ ...a })),
    truncated: [],
  });
  const runtime = {
    tasks: {
      list: rs.fn(async () => list()),
      getTimeBlocks: rs.fn(async () => ({})),
      listQueue: rs.fn(async () => []),
      listTrash: rs.fn(async () => ({
        buckets: server.buckets
          .filter((b) => b.deletedAt)
          .map((b) => ({ bucket: { ...b }, batchId: "batch", movedTaskIds: [] })),
        tasks: [],
      })),
      deleteProject: rs.fn(async ({ projectId }: { projectId: string }) => {
        server.tasks = server.tasks.map((t) =>
          t.bucketId !== projectId
            ? t
            : t.status === "done"
              ? { ...t, deletedAt: NOW }
              : { ...t, bucketId: t.assigneeId === "u1" ? ids.inbox : "annas-inbox" },
        );
        server.buckets = server.buckets.map((b) =>
          b.id === projectId ? { ...b, deletedAt: NOW } : b,
        );
        return { moved: 2, deleted: 1, notified: 1, restorable: true };
      }),
      restoreTrash: rs.fn(async ({ entityId }: { entityId: string }) => {
        server.buckets = server.buckets.map((b) =>
          b.id === entityId ? { ...b, deletedAt: null } : b,
        );
      }),
      updateProject: rs.fn(
        async ({
          projectId,
          patch,
        }: {
          projectId: string;
          patch: {
            color?: string | null;
            archived?: boolean;
            areaId?: string | null;
            position?: string;
          };
        }) => {
          const prev = server.buckets.find((b) => b.id === projectId) as Bucket;
          const saved: Bucket = {
            ...prev,
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            ...(patch.areaId !== undefined ? { areaId: patch.areaId } : {}),
            ...(patch.position !== undefined ? { position: patch.position } : {}),
            ...(patch.archived !== undefined ? { archivedAt: patch.archived ? NOW : null } : {}),
            updatedAt: "2026-10-01T00:00:01.000Z",
          };
          server.buckets = server.buckets.map((b) => (b.id === projectId ? saved : b));
          return { ...saved };
        },
      ),
      updateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => {
        const saved = { ...(server.tasks.find((s) => s.id === taskId) as Task), ...patch };
        server.tasks = server.tasks.map((s) => (s.id === taskId ? saved : s));
        return { ...saved };
      }),
      opSetStatus: rs.fn(async ({ taskId, status }: { taskId: string; status: string }) => {
        const legacy = status === "wont_do" ? "archived" : status;
        const saved = {
          ...(server.tasks.find((s) => s.id === taskId) as Task),
          status: legacy as Task["status"],
        };
        server.tasks = server.tasks.map((s) => (s.id === taskId ? saved : s));
        return { ...saved };
      }),
      opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => {
        const saved = { ...(server.tasks.find((s) => s.id === taskId) as Task), ...patch };
        server.tasks = server.tasks.map((s) => (s.id === taskId ? saved : s));
        return [{ ...saved }];
      }),
      createArea: rs.fn(async ({ name }: { name: string }) => {
        server.areas = [
          ...server.areas,
          {
            id: ids.area,
            workspaceId: WS,
            name,
            color: null,
            position: 1,
            shared: true,
            createdBy: "u1",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ];
        return server.areas.map((a) => ({ ...a }));
      }),
      updateArea: rs.fn(async () => server.areas.map((a) => ({ ...a }))),
    },
  };
  return { ids, server, runtime };
}

const params = {
  userId: "u1",
  workspaceId: WS,
  modulePermission: "edit" as const,
  includeTrash: true,
};
const lastToast = () => toastMock.mock.calls.at(-1) as unknown as [string, ToastOpts];
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const bucketIds = (api: { buckets: Bucket[] }) => api.buckets.map((b) => b.id);

async function mount(runtime: unknown) {
  const hook = renderHook(() => useTasksModule(runtime as never, params));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

afterEach(() => {
  cleanup();
  toastMock.mockClear();
});

describe("deleting a project (REPLAN 78, AC5.5)", () => {
  it("leaves at once, shows only your own open work in your Inbox meanwhile, and sends the op", async () => {
    const { ids, runtime } = makeServer("d1-");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = runtime.tasks.deleteProject;
    runtime.tasks.deleteProject = rs.fn(async (input: { projectId: string }) => {
      await gate;
      return real(input);
    });
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));
    expect(bucketIds(result.current)).toEqual([ids.y]);
    const placed = (id: string) => result.current.tasks.find((t) => t.id === id)?.bucketId;
    expect(placed("d1-mine")).toBe(ids.inbox);
    expect(placed("d1-annas")).toBeUndefined();
    expect(placed("d1-done")).toBeUndefined();
    await waitFor(() =>
      expect(runtime.tasks.deleteProject).toHaveBeenCalledWith({
        workspaceId: WS,
        projectId: ids.x,
      }),
    );
    const [label, opts] = lastToast();
    expect(label).toBe("“X” deleted");
    expect(String(opts.description ?? "")).not.toMatch(/bucket/i);
    release();
    await settle();
    await waitFor(() => expect(placed("d1-mine")).toBe(ids.inbox));
    expect(placed("d1-annas")).toBeUndefined();
  });

  it("Undo restores the project through Recently deleted's op", async () => {
    const { ids, runtime } = makeServer("d2-");
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));
    await settle();
    const [, opts] = lastToast();
    act(() => opts.action.onClick());
    await waitFor(() =>
      expect(runtime.tasks.restoreTrash).toHaveBeenCalledWith({
        workspaceId: WS,
        entityType: "bucket",
        entityId: ids.x,
      }),
    );
    await waitFor(() => expect(bucketIds(result.current)).toEqual([ids.x, ids.y]));
  });

  it("a refused delete brings the project back with the server's words", async () => {
    const { ids, runtime } = makeServer("d3-");
    runtime.tasks.deleteProject = rs.fn(async () => {
      throw new Error("Only people with full access to this project can delete or restore it.");
    });
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));
    await settle();
    await waitFor(() => expect(bucketIds(result.current)).toEqual([ids.x, ids.y]));
    expect(toastMock.error).toHaveBeenCalledWith(
      "Only people with full access to this project can delete or restore it.",
    );
  });
});

describe("archiving a project (REPLAN 16, 78)", () => {
  it("Keep: out of the sidebar, lists and counts, into Archived projects; Undo unarchives", async () => {
    const { ids, runtime } = makeServer("a1-");
    const { result } = await mount(runtime);
    act(() => result.current.archiveBucket(ids.x, { kind: "keep" }));
    expect(bucketIds(result.current)).toEqual([ids.y]);
    expect(result.current.archivedBuckets.map((b) => b.id)).toEqual([ids.x]);
    expect(result.current.tasks.some((t) => t.bucketId === ids.x)).toBe(false);
    expect(result.current.archivedTasks.map((t) => t.id).sort()).toEqual(
      ["a1-annas", "a1-done", "a1-mine"].sort(),
    );
    expect(result.current.openTaskCountByBucket.get(ids.x)).toBeUndefined();
    await settle();
    expect(runtime.tasks.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: ids.x, patch: { archived: true } }),
    );
    const [label, opts] = lastToast();
    expect(label).toBe("“X” archived");
    act(() => opts.action.onClick());
    await waitFor(() => expect(bucketIds(result.current)).toEqual([ids.x, ids.y]));
  });

  it("Won't do marks each open task before archiving", async () => {
    const { ids, runtime } = makeServer("a2-");
    const { result } = await mount(runtime);
    act(() => result.current.archiveBucket(ids.x, { kind: "wont_do" }));
    await settle();
    const statuses = result.current.archivedTasks
      .filter((t) => t.id !== "a2-done")
      .map((t) => t.status);
    expect(statuses).toEqual(["archived", "archived"]);
    expect(String(lastToast()[1].description)).toMatch(/2 open tasks are marked Won’t do/);
  });

  it("Move sends the open tasks to another project first", async () => {
    const { ids, runtime } = makeServer("a3-");
    const { result } = await mount(runtime);
    act(() => result.current.archiveBucket(ids.x, { kind: "move", projectId: ids.y }));
    await settle();
    const inY = result.current.tasks.filter((t) => t.bucketId === ids.y).map((t) => t.id);
    expect(inY.sort()).toEqual(["a3-annas", "a3-mine", "a3-other"].sort());
    expect(result.current.archivedTasks.map((t) => t.id)).toEqual(["a3-done"]);
  });
});

describe("colours and areas (TV-D10's ops)", () => {
  it("colours a project with only that field, neutral stored as none", async () => {
    const { ids, runtime } = makeServer("c1-");
    const { result } = await mount(runtime);
    act(() => result.current.setBucketColor(ids.y, "teal"));
    expect(result.current.buckets.find((b) => b.id === ids.y)?.color).toBe("teal");
    await settle();
    expect(runtime.tasks.updateProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: ids.y, patch: { color: "teal" } }),
    );
    act(() => result.current.setBucketColor(ids.y, "gray"));
    await settle();
    expect(runtime.tasks.updateProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ patch: { color: null } }),
    );
  });

  it("makes an area and moves a project into it, last", async () => {
    const { ids, runtime } = makeServer("c2-");
    const { result } = await mount(runtime);
    let made: string | null = null;
    await act(async () => {
      made = await result.current.createArea("Clients");
    });
    expect(made).toBe(ids.area);
    expect(result.current.areas.map((a) => a.name)).toEqual(["Clients"]);
    act(() => result.current.moveBucketToArea(ids.x, ids.area));
    await settle();
    const call = runtime.tasks.updateProject.mock.calls.at(-1)?.[0] as {
      patch: { areaId: string; position: string };
    };
    expect(call.patch.areaId).toBe(ids.area);
    expect(call.patch.position > `b-${ids.y}`).toBe(true);
  });
});
