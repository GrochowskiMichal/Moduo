// HV-15 variant of benchmarks/escapes/822-1-queue-bypass: a time write (a typed total, "Add time…") on a task whose capture still waits in the outbox goes live past it; the server, which doesn't have the task yet, answers "gone" and the time silently goes back.
// Fixed in MOD-725: `timeWriteBlocked` (time.ts) checks `stillSaving`, as every other task
// command does since #822. Kept as the regression test.

import { describe, expect, it, rs } from "@rstest/core";
import { act, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { findWorkspaceStore } from "../../../lib/sync/store";
import { makeTask } from "../helpers";
import type { Bucket, Task, TasksModuleBundle, TaskTimeResult, TrackTimeInput } from "../model";

const toastMock = rs.hoisted(() =>
  Object.assign(
    rs.fn(() => "t"),
    { dismiss: rs.fn(), error: rs.fn(), message: rs.fn() },
  ),
);
rs.mock("sonner", () => ({ toast: toastMock }));
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));
rs.mock("@/lib/undo-toast", () => ({ UNDO_TOAST_MS: 8000, undoToast: rs.fn(() => 1) }));

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
  const totals = new Map<string, number>();
  /** Time writes that reached the server for a task it doesn't have. */
  const gone: string[] = [];
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
      const saved = { ...t, updatedAt: "2026-10-20T09:00:00.000Z" };
      rows.set(t.id, saved);
      return saved;
    }),
    // tasks_op_track_time: a task it can't find answers {status: 'gone'}.
    trackTime: rs.fn(async (input: TrackTimeInput): Promise<TaskTimeResult> => {
      if (!rows.has(input.taskId)) {
        gone.push(`${input.action} ${input.taskId}`);
        return {
          status: "gone",
          taskId: input.taskId,
          entryId: null,
          totalSeconds: null,
          mySeconds: null,
          myWaitingSeconds: null,
        };
      }
      await new Promise((r) => setTimeout(r, 2));
      const before = totals.get(input.taskId) ?? 0;
      const total =
        input.action === "set_total" ? (input.seconds ?? 0) : before + (input.seconds ?? 0);
      totals.set(input.taskId, total);
      return {
        status: "saved",
        taskId: input.taskId,
        entryId: crypto.randomUUID(),
        totalSeconds: total,
        mySeconds: total,
        myWaitingSeconds: 0,
      };
    }),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, rows, totals, gone, release };
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
  // A task captured offline waits in the outbox; back online, the flush is sending it now.
  await act(async () => {
    store.enqueue({ kind: "create", id: "op-cap", task: task("n", "Call Ana") });
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(store.isQueuedCreate("n")).toBe(true);
  toastMock.mockClear();
  toastMock.error.mockClear();
  return { server, hook };
}

const saidStillSaving = () =>
  [...toastMock.error.mock.calls, ...toastMock.mock.calls].some((call) =>
    JSON.stringify(call).toLowerCase().includes("still saving"),
  );

describe("HV-15 variant 822-1: a time write overtakes the task's capture and is silently lost", () => {
  it("typing a total on a task whose capture is still flushing says Still saving and sends nothing ahead of it", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    await act(async () => {
      hook.result.current.commands.setTimeSpent("n", 1800);
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 40));
    });
    // The capture landed; the typed 30 minutes reached the server ahead of
    // it, came back "gone", and went back without a word.
    expect(server.rows.get("n")?.title).toBe("Call Ana");
    expect(server.gone).toEqual([]);
    expect(saidStillSaving()).toBe(true);
  });

  it("Add time… on a task whose capture is still flushing says Still saving and sends nothing ahead of it", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    let ok: boolean | undefined;
    await act(async () => {
      void hook.result.current.commands
        .logTime("n", { seconds: 1800, on: "2026-10-20" })
        .then((r) => {
          ok = r;
        });
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(ok).toBe(false);
    expect(server.gone).toEqual([]);
    expect(saidStillSaving()).toBe(true);
  });
});
