// MOD-733 (follow-up to MOD-732): moving a task to another project carries
// its subtasks in the same server call (TV-D8), but a subtask whose capture
// still waits in the outbox isn't on the server to carry. Sent live, the move
// lands first; the capture then lands under its old project, apart from its
// parent (`tasks_op_create` checks only that the parent exists). A single
// Move (the panel, a drop) and a bulk Move say "Still saving" instead.

import { describe, expect, it, rs } from "@rstest/core";
import { act, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { findWorkspaceStore } from "../../../lib/sync/store";
import { makeTask } from "../helpers";
import type { Bucket, Task, TasksModuleBundle } from "../model";

const toastMock = rs.hoisted(() =>
  Object.assign(
    rs.fn(() => "t"),
    { dismiss: rs.fn(), error: rs.fn(), message: rs.fn() },
  ),
);
rs.mock("sonner", () => ({ toast: toastMock }));
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));
const undoToastMock = rs.hoisted(() => rs.fn((..._args: unknown[]) => 1));
rs.mock("@/lib/undo-toast", () => ({
  UNDO_TOAST_MS: 8000,
  undoToast: undoToastMock,
}));

import { renderTasksHook } from "../testing/tasks-hook";

const bucket = (id: string, over: Partial<Bucket> = {}): Bucket => ({
  id,
  workspaceId: "w1",
  ownerId: "u1",
  name: id,
  isSystem: false,
  group: null,
  position: id,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  ...over,
});

const task = (id: string, over: Partial<Task> = {}): Task => ({
  ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
  id,
  creatorId: "u1",
  assigneeId: "u1",
  updatedAt: "2026-10-20T08:00:00.000Z",
  ...over,
});

/**
 * A server that moves a parent's subtasks with it (as `tasks_op_update`
 * does) and creates a task where its capture says (as `tasks_op_create`
 * does); the queued capture's create is held until released.
 */
function fakeServer(tasks: Task[]) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  const buckets = [bucket("inbox", { isSystem: true, name: "Inbox" }), bucket("p1"), bucket("p2")];
  let clock = 0;
  const stamp = () => {
    clock += 1;
    return new Date(Date.parse("2026-10-20T09:00:00.000Z") + clock * 1000).toISOString();
  };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bundle = (): TasksModuleBundle => ({
    buckets,
    tasks: [...rows.values()],
    tags: [],
    tagLinks: [],
    taskRelations: [],
    truncated: [],
  });
  const update = (id: string, patch: Partial<Task>): Task => {
    const prev = rows.get(id);
    if (!prev) throw Object.assign(new Error("Task not found."), { code: "PGRST116" });
    const next = { ...prev, ...patch, updatedAt: stamp() };
    rows.set(id, next);
    return next;
  };
  const api = {
    list: rs.fn(async () => bundle()),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => []),
    opCatchUp: rs.fn(async () => []),
    listTrash: rs.fn(async () => ({ buckets: [], tasks: [] })),
    createTask: rs.fn(async (t: Task) => {
      await gate;
      const saved = { ...t, updatedAt: stamp() };
      rows.set(t.id, saved);
      return saved;
    }),
    updateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) =>
      update(taskId, patch),
    ),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => {
      await new Promise((r) => setTimeout(r, 2));
      const saved = [update(taskId, patch)];
      if (patch.bucketId) {
        for (const child of [...rows.values()]) {
          if (child.parentId === taskId) saved.push(update(child.id, { bucketId: patch.bucketId }));
        }
      }
      return saved;
    }),
    opSetStatus: rs.fn(({ taskId, status }: { taskId: string; status: string }) =>
      update(taskId, { status, statusCategory: status } as Partial<Task>),
    ),
  };
  return {
    runtime: { tasks: api } as unknown as ModuoRuntime,
    rows,
    release,
    api,
  };
}

async function setup() {
  const server = fakeServer([task("a")]);
  const hook = renderTasksHook(server.runtime, {
    userId: "u1",
    workspaceId: "w1",
    modulePermission: "edit",
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  const store = findWorkspaceStore(server.runtime, "w1");
  if (!store) throw new Error("no store");
  // A subtask of "a" captured offline waits in the outbox; the flush is sending it now.
  await act(async () => {
    store.enqueue({
      kind: "create",
      id: "op-sub",
      task: task("s", { parentId: "a" }),
    });
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(store.isQueuedCreate("s")).toBe(true);
  toastMock.error.mockClear();
  return { server, hook };
}

const saidStillSaving = () =>
  toastMock.error.mock.calls.some((c) => JSON.stringify(c).toLowerCase().includes("still saving"));

/** Let the held capture land, then check the parent and its subtask stayed together. */
async function landAndCheck(server: ReturnType<typeof fakeServer>) {
  await act(async () => {
    server.release();
    await new Promise((r) => setTimeout(r, 60));
  });
  expect(server.api.opUpdateTask).not.toHaveBeenCalled();
  expect(server.rows.get("s")?.bucketId).toBe(server.rows.get("a")?.bucketId);
  expect(server.rows.get("a")?.bucketId).toBe("p1");
}

describe("MOD-733: Move while a subtask's capture is still saving", () => {
  it("a single Move (the panel) says Still saving and sends nothing", async () => {
    const { server, hook } = await setup();
    await act(async () => {
      hook.result.current.commands.patchTask("a", { bucketId: "p2" });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(saidStillSaving()).toBe(true);
    await landAndCheck(server);
  });

  it("a drop into another project says Still saving and sends nothing", async () => {
    const { server, hook } = await setup();
    let saved: boolean | undefined;
    await act(async () => {
      saved = await hook.result.current.commands.dropTask({ taskId: "a", bucketId: "p2" }, "Moved");
    });
    expect(saved).toBe(false);
    expect(saidStillSaving()).toBe(true);
    await landAndCheck(server);
  });

  it("a bulk Move says Still saving for that task and sends nothing", async () => {
    const { server, hook } = await setup();
    let changed: string[] | undefined;
    await act(async () => {
      changed = await hook.result.current.commands.bulkWrite([{ taskId: "a", bucketId: "p2" }], {
        label: () => "Moved",
      });
    });
    expect(changed).toEqual([]);
    expect(saidStillSaving()).toBe(true);
    await landAndCheck(server);
  });

  it("a Move with every subtask saved still goes ahead and carries them", async () => {
    const { server, hook } = await setup();
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 60));
    });
    toastMock.error.mockClear();
    await act(async () => {
      hook.result.current.commands.patchTask("a", { bucketId: "p2" });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(saidStillSaving()).toBe(false);
    expect(server.rows.get("a")?.bucketId).toBe("p2");
    expect(server.rows.get("s")?.bucketId).toBe("p2");
  });
});
