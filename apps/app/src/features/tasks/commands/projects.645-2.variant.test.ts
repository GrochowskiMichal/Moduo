// HV-15 variant of benchmarks/escapes/645-2-queue-bypass: Archive (or Done)
// with "Move the open tasks" sends each open task's move straight to the
// server, including a task whose capture still waits in the outbox (being
// flushed). The server doesn't have it yet, refuses the move, and the archive
// is called off half-done. Fixed in MOD-732 (Archive and Done say "Still saving"
// first); kept as the regression test.

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
rs.mock("@/lib/undo-toast", () => ({ UNDO_TOAST_MS: 8000, undoToast: undoToastMock }));

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

const task = (id: string, title = id): Task => ({
  ...makeTask({ workspaceId: "w1", bucketId: "p1", title, position: id }),
  id,
  creatorId: "u1",
  assigneeId: "u1",
  updatedAt: "2026-10-20T08:00:00.000Z",
});

/** A server whose first create (the queued capture being flushed) is held until released. */
function fakeServer(tasks: Task[]) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  const buckets = new Map<string, Bucket>([
    ["inbox", bucket("inbox", { isSystem: true, name: "Inbox" })],
    ["p1", bucket("p1")],
    ["p2", bucket("p2")],
  ]);
  let clock = 0;
  const refusals: string[] = [];
  const stamp = () => {
    clock += 1;
    return new Date(Date.parse("2026-10-20T09:00:00.000Z") + clock * 1000).toISOString();
  };
  const write = async (id: string, patch: Partial<Task>, what = "update") => {
    if (!rows.has(id)) {
      refusals.push(`${what} ${id}`);
      throw Object.assign(new Error("Task not found."), { code: "PGRST116" });
    }
    await new Promise((r) => setTimeout(r, 2));
    const next = { ...(rows.get(id) as Task), ...patch, updatedAt: stamp() };
    rows.set(id, next);
    return next;
  };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bundle = (): TasksModuleBundle => ({
    buckets: [...buckets.values()],
    tasks: [...rows.values()],
    tags: [],
    tagLinks: [],
    taskRelations: [],
    truncated: [],
  });
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
      write(taskId, patch),
    ),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => [
      await write(taskId, patch, "move"),
    ]),
    opSetStatus: rs.fn(({ taskId, status }: { taskId: string; status: string }) =>
      write(taskId, { status, statusCategory: status } as Partial<Task>, "status"),
    ),
    updateProject: rs.fn(
      async ({ projectId, patch }: { projectId: string; patch: { archived?: boolean } }) => {
        const prev = buckets.get(projectId) as Bucket;
        const saved: Bucket = {
          ...prev,
          ...(patch.archived !== undefined
            ? { archivedAt: patch.archived ? "2026-10-20T10:00:00.000Z" : null }
            : {}),
          updatedAt: stamp(),
        };
        buckets.set(projectId, saved);
        return saved;
      },
    ),
  };
  return {
    runtime: { tasks: api } as unknown as ModuoRuntime,
    rows,
    buckets,
    release,
    refusals,
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
  // A task captured offline into p1 waits in the outbox; the flush is sending it now.
  await act(async () => {
    store.enqueue({ kind: "create", id: "op-cap", task: task("n", "Call Ana") });
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(store.isQueuedCreate("n")).toBe(true);
  toastMock.error.mockClear();
  return { server, hook };
}

const saidStillSaving = () =>
  toastMock.error.mock.calls.some((c) => JSON.stringify(c).toLowerCase().includes("still saving"));

describe("MOD-732: closing a project with Move while one of its tasks is still saving", () => {
  it("Archive with Move says Still saving and sends nothing", async () => {
    const { server, hook } = await setup();
    await act(async () => {
      hook.result.current.commands.archiveBucket("p1", { kind: "move", projectId: "p2" });
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(saidStillSaving()).toBe(true);
    expect(server.refusals).toEqual([]);
    expect(server.api.opUpdateTask).not.toHaveBeenCalled();
    expect(server.api.updateProject).not.toHaveBeenCalled();
    expect(server.buckets.get("p1")?.archivedAt ?? null).toBeNull();
    expect([...server.rows.values()].filter((t) => t.bucketId === "p2")).toEqual([]);
  });

  it("Done with Move says Still saving and sends nothing", async () => {
    const { server, hook } = await setup();
    await act(async () => {
      hook.result.current.commands.setProjectState("p1", "done", { kind: "move", projectId: "p2" });
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(saidStillSaving()).toBe(true);
    expect(server.api.opUpdateTask).not.toHaveBeenCalled();
    expect(server.api.updateProject).not.toHaveBeenCalled();
  });

  it("Archive with Keep still goes ahead", async () => {
    const { server, hook } = await setup();
    await act(async () => {
      hook.result.current.commands.archiveBucket("p1", { kind: "keep" });
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(saidStillSaving()).toBe(false);
    expect(server.buckets.get("p1")?.archivedAt).toBeTruthy();
  });
});
