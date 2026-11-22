// A selection's change never goes live for a task whose capture still waits
// in the outbox (or is being flushed): sent first, the server (which doesn't
// have the task yet) refuses it and the capture then lands without it. The
// bulk paths use the one "Still saving" check (`stillSaving`, shared.ts) the
// single-task commands use; a selection's check-off still waits behind the
// capture (sibling of benchmarks/escapes/509-2-outbox-overtaken, HV-15).

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
  let clock = 0;
  /** Every op that reached the server for a task it doesn't have. */
  const refusals: string[] = [];
  const stamp = () => {
    clock += 1;
    return new Date(Date.parse("2026-10-20T09:00:00.000Z") + clock * 1000).toISOString();
  };
  const known = async (id: string, what: string) => {
    await new Promise((r) => setTimeout(r, 2));
    if (!rows.has(id)) {
      refusals.push(`${what} ${id}`);
      throw Object.assign(new Error("Task not found."), { code: "PGRST116" });
    }
  };
  const write = async (id: string, patch: Partial<Task>, what = "update") => {
    await known(id, what);
    const next = { ...(rows.get(id) as Task), ...patch, updatedAt: stamp() };
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
  const queued: string[] = [];
  const waiting: string[] = [];
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
      write(taskId, { deletedAt: "2026-10-20T10:00:00.000Z" }, "delete"),
    ),
    opSetStatus: rs.fn(({ taskId, status }: { taskId: string; status: string }) =>
      write(taskId, { status, statusCategory: status } as Partial<Task>, "status"),
    ),
    opQueueAdd: rs.fn(async ({ taskId }: { taskId: string }) => {
      await known(taskId, "queue");
      queued.push(taskId);
      return queued.map((id, i) => ({
        id: `q-${id}`,
        workspaceId: "w1",
        userId: "u1",
        taskId: id,
        position: `a${i}`,
        queuedAt: "",
        updatedAt: "",
      }));
    }),
    addWaiting: rs.fn(async (r: { taskId: string; id: string; kind: string }) => {
      await known(r.taskId, "waiting");
      waiting.push(r.taskId);
      return [
        {
          ...r,
          workspaceId: "w1",
          ref: null,
          label: null,
          since: "",
          createdBy: "u1",
          updatedAt: "",
        },
      ];
    }),
  };
  return {
    runtime: { tasks: api } as unknown as ModuoRuntime,
    rows,
    release,
    refusals,
    queued,
    waiting,
    api,
  };
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
  toastMock.mockClear();
  toastMock.error.mockClear();
  undoToastMock.mockClear();
  return { server, hook, store };
}

/** Run `fn` while the capture is held, then let it land. */
async function whileFlushing(server: ReturnType<typeof fakeServer>, fn: () => unknown) {
  await act(async () => {
    void fn();
    await new Promise((r) => setTimeout(r, 20));
  });
  await act(async () => {
    server.release();
    await new Promise((r) => setTimeout(r, 40));
  });
}

const saidStillSaving = () =>
  [...toastMock.error.mock.calls, ...toastMock.mock.calls, ...undoToastMock.mock.calls].some(
    (call) => JSON.stringify(call).toLowerCase().includes("still saving"),
  );

describe("a selection's change waits for a capture still saving", () => {
  it("a bulk field edit leaves the saving task out and saves the rest", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    await whileFlushing(server, () =>
      hook.result.current.commands.bulkWrite(
        [
          { taskId: "a", priority: "high" },
          { taskId: "n", priority: "high" },
        ],
        { label: (n) => `${n} changed` },
      ),
    );
    expect(server.refusals).toEqual([]);
    expect(server.rows.get("a")?.priority).toBe("high");
    expect(saidStillSaving()).toBe(true);
    // The capture landed as it was, and shows as the server has it.
    expect(server.rows.get("n")?.title).toBe("Call Ana");
  });

  it("a bulk check-off still waits behind the capture and lands", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    await act(async () => {
      void hook.result.current.commands.bulkWrite([{ taskId: "n", status: "done" }], {
        label: (n) => `${n} done`,
      });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(server.api.opSetStatus).not.toHaveBeenCalled();
    await act(async () => {
      server.release();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(server.refusals).toEqual([]);
    expect(saidStillSaving()).toBe(false);
    expect(server.rows.get("n")?.statusCategory).toBe("done");
  });

  it("a bulk delete leaves the saving task out and deletes the rest", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    await whileFlushing(server, () => hook.result.current.commands.bulkDelete(["a", "n"]));
    expect(server.refusals).toEqual([]);
    expect(server.rows.get("a")?.deletedAt).toBeTruthy();
    expect(server.rows.get("n")?.deletedAt ?? null).toBeNull();
  });

  it("Focus on a selection doesn't send the saving task's add ahead of it", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    await whileFlushing(server, () => hook.result.current.commands.bulkQueue(["a", "n"]));
    expect(server.refusals).toEqual([]);
    expect(server.queued).toEqual(["a"]);
  });

  it("Waiting on for a selection doesn't send the saving task's entry ahead of it", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    await whileFlushing(server, () =>
      hook.result.current.commands.bulkWaiting(
        ["a", "n"],
        { kind: "person", ref: "u2", label: "Ana" },
        "Waiting on Ana",
        [],
      ),
    );
    expect(server.refusals).toEqual([]);
    expect(server.waiting).toEqual(["a"]);
  });
});
