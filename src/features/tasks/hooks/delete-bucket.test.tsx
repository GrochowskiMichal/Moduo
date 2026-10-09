// tasks-v2 Q1-4, TV-U6 (U6-2, U6-3, U6-4) — deleting, archiving and restoring a
// bucket through the real hook over an in-memory runtime.
//
// A delete goes to the server at once (one batch for a bucket deleted with its
// tasks); the bucket leaves every hook instance right away through the shared
// store in hidden-buckets.ts; Undo and Recently deleted restore the batch.
//
// The store is module-level (shared by every hook instance, by design), so
// each test uses its own bucket ids.

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

import { splitArchived } from "../../../lib/bucket-rows";
import type { Bucket, Task, TaskQueueEntry, TasksTrash } from "../model";
import { useTasksModule } from "./use-tasks-module";

const WS = "ws-delete-bucket";
const NOW = "2026-10-01T00:00:00.000Z";

type ServerBucket = Bucket & { batchId?: string | null; moved?: string[] };
type ServerTask = Task & { batchId?: string | null };

function bucket(id: string, name: string, isSystem = false): ServerBucket {
  return {
    id,
    workspaceId: WS,
    ownerId: "u1",
    name,
    isSystem,
    group: null,
    position: isSystem ? "a" : `b-${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    color: null,
    archivedAt: null,
  };
}

function task(id: string, bucketId: string, status: Task["status"] = "todo"): ServerTask {
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
    status,
    committedFor: null,
    commitOrder: null,
    rescheduleCount: 0,
    position: id,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

const strip = <T extends { batchId?: unknown; moved?: unknown }>({
  batchId: _b,
  moved: _m,
  ...rest
}: T) => rest;

/**
 * A workspace with Inbox and buckets `<p>x` (two tasks, one done; t1 queued)
 * and `<p>y` (one task). The runtime does what tasks_op_bucket_delete /
 * _trash_restore / _trash_purge do on the server.
 */
function makeServer(p: string) {
  const ids = { inbox: `${p}inbox`, x: `${p}x`, y: `${p}y` };
  const server = {
    buckets: [bucket(ids.inbox, "Inbox", true), bucket(ids.x, "X"), bucket(ids.y, "Y")],
    tasks: [task(`${p}t1`, ids.x), task(`${p}t2`, ids.x, "done"), task(`${p}t3`, ids.y)],
    queue: [
      {
        id: `${p}q1`,
        workspaceId: WS,
        userId: "u1",
        taskId: `${p}t1`,
        position: "0000000001",
        queuedAt: NOW,
        updatedAt: NOW,
      },
    ] as TaskQueueEntry[],
  };
  let batches = 0;
  const runtime = {
    tasks: {
      list: rs.fn(async () => {
        const live = splitArchived(
          server.buckets.filter((b) => !b.deletedAt).map((b) => strip({ ...b })),
          server.tasks.filter((t) => !t.deletedAt).map((t) => strip({ ...t })),
        );
        return { ...live, tags: [], tagLinks: [], taskRelations: [], truncated: [] };
      }),
      getTimeBlocks: rs.fn(async () => ({})),
      listQueue: rs.fn(async () => server.queue.map((e) => ({ ...e }))),
      listTrash: rs.fn(
        async (): Promise<TasksTrash> => ({
          buckets: server.buckets
            .filter((b) => b.deletedAt)
            .map((b) => ({
              bucket: strip({ ...b }),
              batchId: b.batchId ?? null,
              movedTaskIds: b.moved ?? [],
            })),
          tasks: server.tasks
            .filter((t) => t.deletedAt)
            .map((t) => ({ task: strip({ ...t }), batchId: t.batchId ?? null })),
        }),
      ),
      deleteBucket: rs.fn(
        async ({ bucketId, withTasks }: { bucketId: string; withTasks?: boolean }) => {
          const batchId = `${p}batch-${++batches}`;
          const inBucket = server.tasks.filter((t) => t.bucketId === bucketId && !t.deletedAt);
          if (withTasks) {
            server.tasks = server.tasks.map((t) =>
              inBucket.includes(t) ? { ...t, deletedAt: NOW, batchId } : t,
            );
            server.queue = server.queue.filter((e) => !inBucket.some((t) => t.id === e.taskId));
          } else {
            server.tasks = server.tasks.map((t) =>
              inBucket.includes(t) ? { ...t, bucketId: ids.inbox } : t,
            );
          }
          server.buckets = server.buckets.map((b) =>
            b.id === bucketId
              ? { ...b, deletedAt: NOW, batchId, moved: withTasks ? [] : inBucket.map((t) => t.id) }
              : b,
          );
        },
      ),
      restoreTrash: rs.fn(
        async ({ entityType, entityId }: { entityType: string; entityId: string }) => {
          if (entityType === "task") {
            server.tasks = server.tasks.map((t) =>
              t.id === entityId ? { ...t, deletedAt: null, batchId: null } : t,
            );
            return;
          }
          const b = server.buckets.find((x) => x.id === entityId) as ServerBucket;
          server.tasks = server.tasks.map((t) =>
            b.batchId && t.batchId === b.batchId
              ? { ...t, deletedAt: null, batchId: null }
              : (b.moved ?? []).includes(t.id) && t.bucketId === ids.inbox
                ? { ...t, bucketId: b.id }
                : t,
          );
          server.buckets = server.buckets.map((x) =>
            x.id === entityId ? { ...x, deletedAt: null, batchId: null, moved: [] } : x,
          );
        },
      ),
      purgeTrash: rs.fn(
        async ({ entityType, entityId }: { entityType: string; entityId: string }) => {
          if (entityType === "task") {
            server.tasks = server.tasks.filter((t) => t.id !== entityId);
            return;
          }
          const b = server.buckets.find((x) => x.id === entityId) as ServerBucket;
          server.tasks = server.tasks.filter((t) => !(b.batchId && t.batchId === b.batchId));
          server.buckets = server.buckets.filter((x) => x.id !== entityId);
        },
      ),
      updateBucket: rs.fn(
        async ({ bucketId, patch }: { bucketId: string; patch: Partial<Bucket> }) => {
          server.buckets = server.buckets.map((b) => (b.id === bucketId ? { ...b, ...patch } : b));
          if (patch.archivedAt) {
            const inBucket = new Set(
              server.tasks.filter((t) => t.bucketId === bucketId).map((t) => t.id),
            );
            server.queue = server.queue.filter((e) => !inBucket.has(e.taskId));
          }
          return strip({ ...(server.buckets.find((b) => b.id === bucketId) as ServerBucket) });
        },
      ),
      // TV-D1: an edit sends only the fields it changed.
      updateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => {
        const saved = { ...(server.tasks.find((s) => s.id === taskId) as ServerTask), ...patch };
        server.tasks = server.tasks.map((s) => (s.id === taskId ? saved : s));
        return strip({ ...saved });
      }),
    },
  };
  return { ids, server, runtime };
}

const params = { userId: "u1", workspaceId: WS, modulePermission: "edit" as const };
const lastToast = () => toastMock.mock.calls.at(-1) as unknown as [string, ToastOpts];
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const bucketIds = (api: { buckets: Bucket[] }) => api.buckets.map((b) => b.id);
const bucketOf = (api: { tasks: Task[] }, id: string) =>
  api.tasks.find((t) => t.id === id)?.bucketId;

async function mount(runtime: unknown, extra: { includeTrash?: boolean } = {}) {
  const hook = renderHook(() => useTasksModule(runtime as never, { ...params, ...extra }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

afterEach(() => {
  cleanup();
  toastMock.mockClear();
});

describe("deleteBucket (tasks-v2 Q1-4, U6-2)", () => {
  it("moves the tasks to Inbox by default: hidden at once, sent at once, with an Undo toast", async () => {
    const { ids, server, runtime } = makeServer("a-");
    const { result } = await mount(runtime);
    expect(bucketIds(result.current)).toEqual([ids.x, ids.y]);

    act(() => result.current.deleteBucket(ids.x));

    expect(bucketIds(result.current)).toEqual([ids.y]);
    expect(bucketOf(result.current, "a-t1")).toBe(ids.inbox);
    expect(bucketOf(result.current, "a-t2")).toBe(ids.inbox);
    const [label, opts] = lastToast();
    expect(label).toBe("“X” deleted");
    expect(opts.description).toBe("Its 2 tasks moved to Inbox.");
    await waitFor(() =>
      expect(runtime.tasks.deleteBucket).toHaveBeenCalledWith({
        workspaceId: WS,
        bucketId: ids.x,
        withTasks: false,
      }),
    );
    await waitFor(() => expect(runtime.tasks.list).toHaveBeenCalledTimes(2));
    await settle();
    expect(server.tasks.find((t) => t.id === "a-t1")?.bucketId).toBe(ids.inbox);
    expect(bucketIds(result.current)).toEqual([ids.y]);
    expect(bucketOf(result.current, "a-t1")).toBe(ids.inbox);
    // Moving never touches queues.
    expect(result.current.queuedTaskIds.has("a-t1")).toBe(true);
  });

  it("deletes the tasks too when asked: they leave every list and queue, and the toast says so", async () => {
    const { ids, runtime } = makeServer("b-");
    const { result } = await mount(runtime);

    act(() => result.current.deleteBucket(ids.x, { withTasks: true }));

    expect(bucketIds(result.current)).toEqual([ids.y]);
    expect(result.current.tasks.map((t) => t.id)).toEqual(["b-t3"]);
    expect(result.current.queuedTaskIds.has("b-t1")).toBe(false);
    const [, opts] = lastToast();
    expect(opts.description).toBe("Its 2 tasks were deleted too.");
    await waitFor(() =>
      expect(runtime.tasks.deleteBucket).toHaveBeenCalledWith({
        workspaceId: WS,
        bucketId: ids.x,
        withTasks: true,
      }),
    );
    await settle();
    expect(result.current.tasks.map((t) => t.id)).toEqual(["b-t3"]);
  });

  it("one Undo brings back the bucket and every task deleted with it", async () => {
    const { ids, runtime } = makeServer("c-");
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x, { withTasks: true }));
    const [, opts] = lastToast();
    await settle();

    act(() => opts.action.onClick());

    await waitFor(() =>
      expect(runtime.tasks.restoreTrash).toHaveBeenCalledWith({
        workspaceId: WS,
        entityType: "bucket",
        entityId: ids.x,
      }),
    );
    await waitFor(() => expect(bucketIds(result.current)).toEqual([ids.x, ids.y]));
    expect(bucketOf(result.current, "c-t1")).toBe(ids.x);
    expect(bucketOf(result.current, "c-t2")).toBe(ids.x);
    // Undo restores, never re-queues (TV-D2).
    expect(result.current.queuedTaskIds.has("c-t1")).toBe(false);
  });

  it("an Undo pressed before the delete has answered waits for it, then restores", async () => {
    const { ids, runtime } = makeServer("d-");
    let land: () => void = () => {};
    const real = runtime.tasks.deleteBucket.getMockImplementation() as (a: {
      bucketId: string;
      withTasks?: boolean;
    }) => Promise<void>;
    runtime.tasks.deleteBucket.mockImplementationOnce(
      (args: { bucketId: string; withTasks?: boolean }) =>
        new Promise<void>((resolve) => {
          land = () => void real(args).then(resolve);
        }),
    );
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));
    const [, opts] = lastToast();

    act(() => opts.action.onClick());
    await settle();
    expect(runtime.tasks.restoreTrash).not.toHaveBeenCalled();

    land();
    await waitFor(() => expect(runtime.tasks.restoreTrash).toHaveBeenCalledOnce());
    await waitFor(() => expect(bucketIds(result.current)).toEqual([ids.x, ids.y]));
    expect(bucketOf(result.current, "d-t1")).toBe(ids.x);
  });

  it("another surface that loaded before the delete hides the bucket too, and a restore brings it back there", async () => {
    const { ids, runtime } = makeServer("e-");
    const tasks = await mount(runtime);
    const calendar = await mount(runtime);

    act(() => tasks.result.current.deleteBucket(ids.x));
    expect(bucketIds(calendar.result.current)).toEqual([ids.y]);
    expect(bucketOf(calendar.result.current, "e-t1")).toBe(ids.inbox);
    await settle();
    // The other surface's bundle is still from before the delete: still hidden.
    expect(bucketIds(calendar.result.current)).toEqual([ids.y]);

    await act(() => tasks.result.current.restoreFromTrash({ kind: "bucket", id: ids.x }));
    expect(bucketIds(calendar.result.current)).toEqual([ids.x, ids.y]);
    expect(bucketOf(calendar.result.current, "e-t1")).toBe(ids.x);
  });

  it("a bundle loaded after the delete shows the server, including a teammate's restore since", async () => {
    const { ids, server, runtime } = makeServer("f-");
    const first = await mount(runtime);
    act(() => first.result.current.deleteBucket(ids.x));
    await settle();

    // Someone else restores it; a surface that loads later shows it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    server.buckets = server.buckets.map((b) => (b.id === ids.x ? { ...b, deletedAt: null } : b));
    const later = await mount(runtime);
    expect(bucketIds(later.result.current)).toEqual([ids.x, ids.y]);
  });

  it("an edit to a moved task sends only the field it changed", async () => {
    const { ids, runtime } = makeServer("g-");
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));

    act(() => result.current.patchTask("g-t1", { title: "renamed" }));
    await settle();
    expect(runtime.tasks.updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "g-t1", patch: { title: "renamed" } }),
    );
  });

  it("a failed delete brings the bucket back with an error toast", async () => {
    const { ids, runtime } = makeServer("h-");
    runtime.tasks.deleteBucket.mockImplementationOnce(async () => {
      throw new Error("Network down");
    });
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Network down"));
    await waitFor(() => expect(bucketIds(result.current)).toEqual([ids.x, ids.y]));
  });

  it("the Inbox can't be deleted", async () => {
    const { ids, runtime } = makeServer("i-");
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.inbox));
    expect(runtime.tasks.deleteBucket).not.toHaveBeenCalled();
  });
});

describe("archive (U6-4)", () => {
  it("hides the bucket and its tasks everywhere, takes them out of queues, and lists it under Archived", async () => {
    const { ids, runtime } = makeServer("j-");
    const { result } = await mount(runtime);
    act(() => result.current.archiveBucket(ids.x));

    expect(bucketIds(result.current)).toEqual([ids.y]);
    expect(result.current.archivedBuckets.map((b) => b.id)).toEqual([ids.x]);
    expect(result.current.tasks.map((t) => t.id)).toEqual(["j-t3"]);
    expect(result.current.archivedTasks.map((t) => t.id)).toEqual(["j-t1", "j-t2"]);
    expect(result.current.queuedTaskIds.has("j-t1")).toBe(false);
    expect(result.current.openTaskCountByBucket.get(ids.x)).toBe(1); // for the delete confirm
    expect(lastToast()[0]).toBe("“X” archived");
    await waitFor(() =>
      expect(runtime.tasks.updateBucket).toHaveBeenCalledWith(
        expect.objectContaining({ bucketId: ids.x, patch: { archivedAt: expect.any(String) } }),
      ),
    );

    // A fresh load reads it archived from the server.
    await act(() => result.current.reload());
    expect(result.current.archivedBuckets.map((b) => b.id)).toEqual([ids.x]);
    expect(result.current.tasks.map((t) => t.id)).toEqual(["j-t3"]);
  });

  it("Unarchive (or the toast's Undo) brings it back without re-queuing", async () => {
    const { ids, runtime } = makeServer("k-");
    const { result } = await mount(runtime);
    act(() => result.current.archiveBucket(ids.x));
    const [, opts] = lastToast();
    await settle();

    act(() => opts.action.onClick());
    expect(bucketIds(result.current)).toEqual([ids.x, ids.y]);
    expect(result.current.archivedBuckets).toEqual([]);
    expect(bucketOf(result.current, "k-t1")).toBe(ids.x);
    await settle();
    await act(() => result.current.reload());
    expect(bucketIds(result.current)).toEqual([ids.x, ids.y]);
    expect(result.current.queuedTaskIds.has("k-t1")).toBe(false);
  });
});

describe("Recently deleted (U6-3)", () => {
  it("is read with the list on the Tasks page, and Delete forever drops an entry at once", async () => {
    const { ids, runtime } = makeServer("l-");
    const { result } = await mount(runtime, { includeTrash: true });
    expect(result.current.trash).toEqual({ buckets: [], tasks: [] });

    act(() => result.current.deleteBucket(ids.x, { withTasks: true }));
    await waitFor(() =>
      expect(result.current.trash?.buckets.map((b) => b.bucket.id)).toEqual([ids.x]),
    );
    expect(result.current.trash?.tasks.map((t) => t.task.id).sort()).toEqual(["l-t1", "l-t2"]);

    act(() => result.current.deleteForever({ kind: "bucket", id: ids.x }));
    expect(result.current.trash?.buckets).toEqual([]);
    await waitFor(() => expect(runtime.tasks.purgeTrash).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.trash?.tasks).toEqual([]));
  });

  it("other surfaces don't read it", async () => {
    const { runtime } = makeServer("m-");
    const { result } = await mount(runtime);
    expect(runtime.tasks.listTrash).not.toHaveBeenCalled();
    expect(result.current.trash).toBeNull();
  });
});
