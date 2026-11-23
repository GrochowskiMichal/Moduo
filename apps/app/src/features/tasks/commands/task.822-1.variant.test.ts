// HV-15 variant of benchmarks/escapes/822-1-queue-bypass: an edit that changes a
// task's status together with another field (writeTask's field-level save) goes
// live past an older check-off still waiting in the outbox for the same task,
// so the older check-off lands last and wins. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/tasks/commands/task.822-1.variant.test.ts

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

/** A server whose first status op (the queued check-off being flushed) is held until released. */
function fakeServer(tasks: Task[]) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  let clock = 0;
  const stamp = () => {
    clock += 1;
    return new Date(Date.parse("2026-10-20T09:00:00.000Z") + clock * 1000).toISOString();
  };
  const write = async (id: string, patch: Partial<Task>) => {
    await new Promise((r) => setTimeout(r, 2));
    const row = rows.get(id);
    if (!row) throw Object.assign(new Error("Task not found."), { code: "PGRST116" });
    const next = { ...row, ...patch, updatedAt: stamp() };
    rows.set(id, next);
    return next;
  };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let statusCalls = 0;
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
    updateTask: rs.fn(({ taskId, patch }: { taskId: string; patch: Partial<Task> }) =>
      write(taskId, patch),
    ),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => [
      await write(taskId, patch),
    ]),
    opSetStatus: rs.fn(async ({ taskId, status }: { taskId: string; status: string }) => {
      statusCalls += 1;
      // The queued check-off is on its way: held until released.
      if (statusCalls === 1) await gate;
      return write(taskId, { status, statusCategory: status } as Partial<Task>);
    }),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, rows, release, api };
}

hunt("HV-15 variant 822-1: a status edit with other fields overtakes a waiting check-off", () => {
  it("reopening and renaming a task in one edit while its check-off still flushes leaves it To do", async () => {
    const server = fakeServer([task("a", "Call Ana")]);
    const hook = renderTasksHook(server.runtime, {
      userId: "u1",
      workspaceId: "w1",
      modulePermission: "edit",
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const store = findWorkspaceStore(server.runtime, "w1");
    if (!store) throw new Error("no store");
    // A check-off made offline waits in the outbox; back online, the flush is sending it now.
    await act(async () => {
      store.enqueue({
        kind: "status",
        id: "op-done",
        taskId: "a",
        status: "done",
        recurrence: null,
        fields: { statusCategory: "done" } as Partial<Task>,
      } as Parameters<typeof store.enqueue>[0]);
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(store.hasOutboxEntries("a")).toBe(true);
    expect(server.api.opSetStatus).toHaveBeenCalledTimes(1);
    toastMock.error.mockClear();
    // Newer: in the panel the person reopens it and retitles it in one save.
    await act(async () => {
      hook.result.current.commands.writeTask("a", {
        status: "todo",
        title: "Call Ana about the lease",
      });
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 40));
    });
    const held = (toastMock.error.mock.calls as unknown[][]).some(([m]) =>
      String(m).startsWith("Still saving"),
    );
    // Either the newer edit was held back, or it landed after the check-off and wins.
    if (held) return;
    expect(server.rows.get("a")?.title).toBe("Call Ana about the lease");
    expect(server.rows.get("a")?.statusCategory).toBe("todo");
  });
});
