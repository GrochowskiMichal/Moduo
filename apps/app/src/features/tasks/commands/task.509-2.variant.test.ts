// HV-15 variant of benchmarks/escapes/509-2-outbox-overtaken: a field edit
// (`writeTask`'s field-level save) or a delete of a task whose capture still
// waits in the outbox (or is being flushed) goes straight to the server, which
// doesn't have the task yet: the write is refused and rolled back, and the
// capture lands afterwards with the old fields. `applyOp` guards the same case
// (`isQueuedCreate` → "Still saving"); these two paths don't. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/tasks/commands/task.509-2.variant.test.ts

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

import { renderTasksHook } from "../testing/tasks-hook";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

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
  let clock = 0;
  const refusals: string[] = [];
  const stamp = () => {
    clock += 1;
    return new Date(Date.parse("2026-10-20T09:00:00.000Z") + clock * 1000).toISOString();
  };
  const write = async (id: string, patch: Partial<Task>) => {
    await new Promise((r) => setTimeout(r, 2));
    const row = rows.get(id);
    if (!row) {
      refusals.push(id);
      throw Object.assign(new Error("Task not found."), { code: "PGRST116" });
    }
    const next = { ...row, ...patch, updatedAt: stamp() };
    rows.set(id, next);
    return next;
  };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bundle = (): TasksModuleBundle => ({
    buckets: [bucket("inbox", { isSystem: true, name: "Inbox" }), bucket("p1")],
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
    updateTask: rs.fn(({ taskId, patch }: { taskId: string; patch: Partial<Task> }) =>
      write(taskId, patch),
    ),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => [
      await write(taskId, patch),
    ]),
    deleteTask: rs.fn(({ taskId }: { taskId: string }) =>
      write(taskId, { deletedAt: "2026-10-20T10:00:00.000Z" }),
    ),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, rows, release, refusals, api };
}

async function mountWithFlushingCapture() {
  const server = fakeServer([task("a")]);
  const hook = renderTasksHook(server.runtime, {
    userId: "u1",
    workspaceId: "w1",
    modulePermission: "edit",
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  const store = findWorkspaceStore(server.runtime, "w1");
  if (!store) throw new Error("no store");
  // A task captured offline waits in the outbox; the flush is sending it now.
  await act(async () => {
    store.enqueue({ kind: "create", id: "op-cap", task: task("n", "Call Ana") });
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(store.isQueuedCreate("n")).toBe(true);
  expect(server.api.createTask).toHaveBeenCalledTimes(1);
  return { server, hook, store };
}

hunt("HV-15 variant 509-2-outbox-overtaken: a live write jumps a waiting capture", () => {
  it("renaming a task whose capture is still flushing never reaches the server ahead of it", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    toastMock.error.mockClear();
    // The person retitles the task before its capture's answer comes back.
    await act(async () => {
      hook.result.current.commands.writeTask("n", { title: "Call Ana about the lease" });
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 40));
    });
    // Sent live, the server refused it (no such task yet) and the edit was undone.
    expect(server.refusals).toEqual([]);
    // Either the edit waited and landed, or it was held back with "Still saving".
    const held = (toastMock.error.mock.calls as unknown[][]).some(([m]) =>
      String(m).startsWith("Still saving"),
    );
    expect(held || server.rows.get("n")?.title === "Call Ana about the lease").toBe(true);
  });

  it("deleting a task whose capture is still flushing doesn't leave it on the server", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    toastMock.error.mockClear();
    await act(async () => {
      hook.result.current.commands.deleteTask("n");
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(server.refusals).toEqual([]);
    const held = (toastMock.error.mock.calls as unknown[][]).some(([m]) =>
      String(m).startsWith("Still saving"),
    );
    expect(held || !!server.rows.get("n")?.deletedAt).toBe(true);
  });
});
