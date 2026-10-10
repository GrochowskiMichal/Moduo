// tasks-v2 Q1-4 — deleting a bucket is a deferred commit: hidden at once in every
// useTasksModule, sent to the server only when the Undo toast closes, and Undo
// just un-hides it. Runs the real hook over an in-memory runtime.
//
// The hidden-bucket store is module-level (shared by every hook instance, by
// design), so each test uses its own bucket ids.

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

import type { Bucket, Task } from "../model";
import { useTasksModule } from "./use-tasks-module";

const WS = "ws-delete-bucket";
const NOW = "2026-10-01T00:00:00.000Z";

function bucket(id: string, name: string, isSystem = false): Bucket {
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
  };
}

function task(id: string, bucketId: string, status: Task["status"] = "todo"): Task {
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

/** A workspace with Inbox and buckets `<p>x` (two tasks, one done) and `<p>y` (one task). */
function makeServer(p: string) {
  const ids = { inbox: `${p}inbox`, x: `${p}x`, y: `${p}y` };
  const server = {
    buckets: [bucket(ids.inbox, "Inbox", true), bucket(ids.x, "X"), bucket(ids.y, "Y")],
    tasks: [task(`${p}t1`, ids.x), task(`${p}t2`, ids.x, "done"), task(`${p}t3`, ids.y)],
  };
  const runtime = {
    tasks: {
      list: rs.fn(async () => ({
        buckets: server.buckets.filter((b) => !b.deletedAt).map((b) => ({ ...b })),
        tasks: server.tasks.map((t) => ({ ...t })),
        tags: [],
        tagLinks: [],
        taskRelations: [],
        truncated: [],
      })),
      getTimeBlocks: rs.fn(async () => ({})),
      listQueue: rs.fn(async () => []),
      deleteBucket: rs.fn(async ({ bucketId }: { bucketId: string }) => {
        server.tasks = server.tasks.map((t) =>
          t.bucketId === bucketId ? { ...t, bucketId: ids.inbox } : t,
        );
        server.buckets = server.buckets.map((b) =>
          b.id === bucketId ? { ...b, deletedAt: NOW } : b,
        );
      }),
      // TV-D1: an edit sends only the fields it changed.
      updateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => {
        const saved = { ...(server.tasks.find((s) => s.id === taskId) as Task), ...patch };
        server.tasks = server.tasks.map((s) => (s.id === taskId ? saved : s));
        return { ...saved };
      }),
      upsertTask: rs.fn(async (t: Task) => {
        const saved = { ...t, id: t.id || `${p}new-${server.tasks.length}` };
        server.tasks = server.tasks.some((s) => s.id === saved.id)
          ? server.tasks.map((s) => (s.id === saved.id ? saved : s))
          : [...server.tasks, saved];
        return { ...saved };
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

async function mount(runtime: unknown) {
  const hook = renderHook(() => useTasksModule(runtime as never, params));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

afterEach(() => {
  cleanup();
  toastMock.mockClear();
});

describe("deleteBucket (tasks-v2 Q1-4)", () => {
  it("hides the bucket and shows its tasks in Inbox at once, with an Undo toast, and no server call yet", async () => {
    const { ids, runtime } = makeServer("a-");
    const { result } = await mount(runtime);
    expect(bucketIds(result.current)).toEqual([ids.x, ids.y]);

    act(() => result.current.deleteBucket(ids.x));

    expect(bucketIds(result.current)).toEqual([ids.y]);
    expect(bucketOf(result.current, "a-t1")).toBe(ids.inbox);
    expect(bucketOf(result.current, "a-t2")).toBe(ids.inbox);
    const [label, opts] = lastToast();
    expect(label).toBe("“X” deleted");
    expect(opts.description).toBe("Its 2 tasks moved to Inbox.");
    expect(runtime.tasks.deleteBucket).not.toHaveBeenCalled();
  });

  it("commits exactly once when the toast closes", async () => {
    const { ids, server, runtime } = makeServer("b-");
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));
    const [, opts] = lastToast();

    opts.onAutoClose?.();
    opts.onDismiss?.();
    await settle();

    expect(runtime.tasks.deleteBucket).toHaveBeenCalledOnce();
    expect(server.tasks.find((t) => t.id === "b-t1")?.bucketId).toBe(ids.inbox);
    await waitFor(() => expect(runtime.tasks.list).toHaveBeenCalledTimes(2));
    expect(bucketIds(result.current)).toEqual([ids.y]);
  });

  it("Undo puts the bucket and its tasks back, never touches the server, and a later close doesn't commit", async () => {
    const { ids, runtime } = makeServer("c-");
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));
    const [, opts] = lastToast();

    act(() => opts.action.onClick());
    opts.onAutoClose?.();
    await settle();

    expect(bucketIds(result.current)).toEqual([ids.x, ids.y]);
    expect(bucketOf(result.current, "c-t1")).toBe(ids.x);
    expect(runtime.tasks.deleteBucket).not.toHaveBeenCalled();
    expect(runtime.tasks.upsertTask).not.toHaveBeenCalled();
  });

  it("a second pending delete stays hidden when the first one commits and reloads", async () => {
    const { ids, runtime } = makeServer("d-");
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));
    const [, xOpts] = lastToast();
    act(() => result.current.deleteBucket(ids.y));

    xOpts.onAutoClose?.();
    await waitFor(() => expect(runtime.tasks.list).toHaveBeenCalledTimes(2));
    await settle();

    expect(bucketIds(result.current)).toEqual([]);
    expect(bucketOf(result.current, "d-t3")).toBe(ids.inbox);
  });

  it("a page that remounts inside the window keeps the bucket gone, before and after the commit", async () => {
    const { ids, runtime } = makeServer("e-");
    const first = await mount(runtime);
    act(() => first.result.current.deleteBucket(ids.x));
    const [, opts] = lastToast();
    first.unmount();

    const second = await mount(runtime);
    expect(bucketIds(second.result.current)).toEqual([ids.y]);
    opts.onAutoClose?.();
    await settle();
    expect(runtime.tasks.deleteBucket).toHaveBeenCalledOnce();
    expect(bucketIds(second.result.current)).toEqual([ids.y]);
  });

  it("an edit to a moved task inside the window still saves its real bucket, so Undo stays exact", async () => {
    const { ids, server, runtime } = makeServer("f-");
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));
    const [, opts] = lastToast();

    act(() => result.current.patchTask("f-t1", { title: "renamed" }));
    await settle();
    expect(server.tasks.find((t) => t.id === "f-t1")).toMatchObject({
      title: "renamed",
      bucketId: ids.x,
    });

    act(() => opts.action.onClick());
    expect(bucketOf(result.current, "f-t1")).toBe(ids.x);
  });

  it("a subtask added to a moved task inside the window lands in the parent's real bucket", async () => {
    const { ids, runtime } = makeServer("h-");
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));
    const [, opts] = lastToast();

    act(() => result.current.addSubtask("h-t1", "Child"));
    await settle();
    expect(runtime.tasks.upsertTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Child", parentId: "h-t1", bucketId: ids.x }),
    );

    act(() => opts.action.onClick());
    const child = result.current.tasks.find((t) => t.title === "Child");
    expect(child?.bucketId).toBe(ids.x);
  });

  it("a bucket created while another's delete is pending sorts after it", async () => {
    const { ids, runtime } = makeServer("i-");
    // TV-D10: a new project goes through the project op.
    const createProject = rs.fn(
      async (input: { workspaceId: string; fields: { name: string; position?: string } }) =>
        ({
          id: "i-new",
          workspaceId: input.workspaceId,
          ownerId: "",
          name: input.fields.name,
          isSystem: false,
          group: null,
          position: input.fields.position ?? "",
          createdAt: "",
          updatedAt: "",
          deletedAt: null,
        }) satisfies Bucket,
    );
    const { result } = await mount({ tasks: { ...runtime.tasks, createProject } });
    act(() => result.current.deleteBucket(ids.y)); // Y is the last bucket
    const [, opts] = lastToast();

    act(() => result.current.createBucket("Fresh"));
    await settle();
    act(() => opts.action.onClick());

    const [x, y, fresh] = result.current.buckets;
    expect([x?.id, y?.id, fresh?.name]).toEqual([ids.x, ids.y, "Fresh"]);
    expect(fresh!.position > y!.position).toBe(true);
  });

  it("a failed server delete brings the bucket back with an error toast", async () => {
    const { ids, runtime } = makeServer("g-");
    runtime.tasks.deleteBucket.mockImplementationOnce(async () => {
      throw new Error("Network down");
    });
    const { result } = await mount(runtime);
    act(() => result.current.deleteBucket(ids.x));
    const [, opts] = lastToast();

    opts.onAutoClose?.();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Network down"));
    await waitFor(() => expect(bucketIds(result.current)).toEqual([ids.x, ids.y]));
  });
});
