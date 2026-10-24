// HV-15 variant of benchmarks/escapes/509-2-outbox-overtaken: a bulk status
// change (and a board drop) goes straight to the server while an older
// check-off for the same task still waits in the outbox, so the older one
// lands last and wins. Fixed by MOD-561: the bulk status part waits in the
// outbox behind it, the drop's waits its turn.

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

const task = (id: string): Task => ({
  ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
  id,
  creatorId: "u1",
  assigneeId: "u1",
  updatedAt: "2026-10-20T08:00:00.000Z",
});

/** A server whose first status op (the queued check-off being flushed) is held until released. */
function fakeServer(tasks: Task[]) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  let clock = 0;
  const write = async (id: string, patch: Partial<Task>) => {
    await new Promise((r) => setTimeout(r, 2));
    clock += 1;
    const next = {
      ...(rows.get(id) as Task),
      ...patch,
      updatedAt: new Date(Date.parse("2026-10-20T09:00:00.000Z") + clock * 1000).toISOString(),
    };
    rows.set(id, next);
    return next;
  };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let statusCalls = 0;
  const statusLog: string[] = [];
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
      if (statusCalls === 1) await gate;
      statusLog.push(status);
      const done = status === "done";
      return write(taskId, {
        status: done ? "done" : "todo",
        statusCategory: done ? "done" : "todo",
      });
    }),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, rows, release, statusLog };
}

async function mountWithFlushingCheckOff() {
  const server = fakeServer([task("a")]);
  const hook = renderTasksHook(server.runtime, {
    userId: "u1",
    workspaceId: "w1",
    modulePermission: "edit",
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  const store = findWorkspaceStore(server.runtime, "w1");
  if (!store) throw new Error("no store");
  // An older check-off made offline waits in the outbox; the flush is sending it now.
  await act(async () => {
    store.enqueue({
      kind: "status",
      id: "op-old",
      taskId: "a",
      status: "done",
      fields: { status: "done", statusCategory: "done" },
    });
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(store.hasOutboxEntries("a")).toBe(true);
  return { server, hook, store };
}

describe("HV-15 variant 509-2-outbox-overtaken: a live status write jumps a waiting check-off", () => {
  it("a bulk 'To do' on a task whose check-off is still flushing stays To do", async () => {
    const { server, hook } = await mountWithFlushingCheckOff();
    // The person reopens it from a selection before that answer comes back.
    await act(async () => {
      await hook.result.current.commands.bulkWrite([{ taskId: "a", status: "todo" }], {
        label: () => "Moved to To do",
      });
    });
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 40));
    });
    // In the order they were made: the newer change is the one that stays.
    expect(server.rows.get("a")?.status).toBe("todo");
  });

  it("a board drop into To do on a task whose check-off is still flushing stays To do", async () => {
    const { server, hook } = await mountWithFlushingCheckOff();
    let dropped: Promise<boolean> | null = null;
    await act(async () => {
      dropped = hook.result.current.commands.dropTask({ taskId: "a", status: "todo" }, "Moved");
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      server.release();
      await dropped;
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(server.rows.get("a")?.status).toBe("todo");
  });
});
