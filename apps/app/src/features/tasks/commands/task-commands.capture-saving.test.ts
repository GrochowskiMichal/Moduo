// Every task command that goes live for a task whose capture still waits in
// the outbox (or is being flushed) says "Still saving" instead (`savingBlocked`
// / `stillSaving`, shared.ts): sent first, the server (which doesn't have the
// task yet) refuses it and the capture then lands without it. One row per
// command: Focus, tags, reminders, sessions, Waiting on, subtasks, the
// parent, dependencies (sibling of benchmarks/escapes/509-2-outbox-overtaken,
// HV-15).

import { describe, expect, it, rs } from "@rstest/core";
import { act, waitFor } from "@testing-library/react";

import type { TaskCommands } from ".";
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
    // Checked as the request arrives (before any wait), as the server would.
    if (!rows.has(id)) {
      refusals.push(`${what} ${id}`);
      throw Object.assign(new Error("Task not found."), { code: "PGRST116" });
    }
    await new Promise((r) => setTimeout(r, 2));
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
      if (t.parentId) await known(t.parentId, "subtask of");
      else await gate;
      const saved = { ...t, updatedAt: stamp() };
      rows.set(t.id, saved);
      return saved;
    }),
    updateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => {
      if (patch.parentId) await known(patch.parentId, "parent");
      return write(taskId, patch);
    }),
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
  const extra = {
    attachTag: rs.fn(async (r: { entityId: string; tagId: string }) => {
      await known(r.entityId, "tag");
      return { id: crypto.randomUUID(), workspaceId: "w1", ...r, entityType: "task" };
    }),
    detachTag: rs.fn(async () => {}),
    upsertTag: rs.fn(async (t: unknown) => t),
    addReminder: rs.fn(async (r: { taskId: string }) => {
      await known(r.taskId, "reminder");
      return [];
    }),
    addSession: rs.fn(async (r: { taskId: string }) => {
      await known(r.taskId, "session");
      return [];
    }),
    createTaskRelation: rs.fn(async (r: { blockerTaskId: string; blockedTaskId: string }) => {
      await known(r.blockerTaskId, "blocker");
      await known(r.blockedTaskId, "blocked");
      return { id: crypto.randomUUID(), workspaceId: "w1", createdAt: "", ...r };
    }),
  };
  const all = Object.assign(api, extra);
  return {
    runtime: { tasks: all } as unknown as ModuoRuntime,
    rows,
    release,
    refusals,
    queued,
    waiting,
    api: all,
  };
}

async function mountWithFlushingCapture(opts: { offline?: boolean } = {}) {
  const server = fakeServer([task("a")]);
  const hook = renderTasksHook(server.runtime, {
    userId: "u1",
    workspaceId: "w1",
    modulePermission: "edit",
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  const store = findWorkspaceStore(server.runtime, "w1");
  if (!store) throw new Error("no store");
  // A task captured offline waits in the outbox; the flush is sending it now
  // (or, still offline, it waits).
  if (opts.offline) store.wentOffline();
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

const saidOffline = () =>
  (toastMock.mock.calls as unknown[][]).some(([title]) => title === "Offline");

const saidStillSaving = () =>
  [...toastMock.error.mock.calls, ...toastMock.mock.calls, ...undoToastMock.mock.calls].some(
    (call) => JSON.stringify(call).toLowerCase().includes("still saving"),
  );

type Row = [string, (c: TaskCommands) => unknown];

const rows: Row[] = [
  ["Focus: add to my queue", (c) => c.addToQueue("n")],
  ["Focus on this", (c) => c.focusOnTask("n")],
  ["a tag toggled on", (c) => c.toggleTaskTag("n", "tag-1")],
  ["a tag made for it", (c) => c.createTagForTask("Errand", "n")],
  ["a selection's tag", (c) => c.bulkTag(["n"], { name: "Errand" }, () => false)],
  ["a reminder", (c) => c.addReminder("n", "at", "2026-10-21T09:00:00.000Z")],
  [
    "a work session",
    (c) =>
      c.addSession("n", {
        startsAt: "2026-10-21T09:00:00.000Z",
        endsAt: "2026-10-21T10:00:00.000Z",
        userId: "u1",
      }),
  ],
  ["Waiting on", (c) => c.addWaiting("n", { kind: "person", ref: "u2", label: "Ana" })],
  ["another task moved under it", (c) => c.setTaskParent("a", "n")],
  ["it blocks another task", (c) => c.addBlocker("a", "n")],
  ["another task blocks it", (c) => c.addBlocker("n", "a")],
  ["it moved under another task", (c) => c.setTaskParent("n", "a")],
];

describe("a task command waits for the task's capture still saving", () => {
  it.each(rows)("%s says Still saving and sends nothing ahead of it", async (_name, run) => {
    const { server, hook } = await mountWithFlushingCapture();
    await whileFlushing(server, () => run(hook.result.current.commands));
    expect(server.refusals).toEqual([]);
    expect(saidStillSaving()).toBe(true);
    // The capture itself landed as it was.
    expect(server.rows.get("n")?.title).toBe("Call Ana");
  });

  it("a selection's tag still tags the saved tasks and names the one still saving", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    await whileFlushing(server, () =>
      hook.result.current.commands.bulkTag(["a", "n"], { name: "Errand" }, () => false),
    );
    expect(server.refusals).toEqual([]);
    expect(server.api.attachTag).toHaveBeenCalledTimes(1);
    expect(saidStillSaving()).toBe(true);
  });

  it("a task that is saved isn't held back (Focus, a reminder, a dependency)", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    await whileFlushing(server, () => {
      const c = hook.result.current.commands;
      c.addToQueue("a");
      c.addReminder("a", "at", "2026-10-21T09:00:00.000Z");
    });
    expect(server.refusals).toEqual([]);
    expect(server.queued).toEqual(["a"]);
    expect(server.api.addReminder).toHaveBeenCalledTimes(1);
    expect(saidStillSaving()).toBe(false);
  });
});

describe("a subtask under a task whose capture is still saving waits behind it", () => {
  it("online, while the capture is being sent: it goes after it and lands under it", async () => {
    const { server, hook } = await mountWithFlushingCapture();
    await whileFlushing(server, () =>
      hook.result.current.commands.addSubtask("n", "Bring the keys"),
    );
    expect(server.refusals).toEqual([]);
    expect(saidStillSaving()).toBe(false);
    const sub = [...server.rows.values()].find((t) => t.title === "Bring the keys");
    expect(sub?.parentId).toBe("n");
    expect(server.rows.get("n")?.title).toBe("Call Ana");
  });

  it("offline, under a task captured offline: both wait on the device and sync in order", async () => {
    const { server, hook, store } = await mountWithFlushingCapture({ offline: true });
    await act(async () => {
      void hook.result.current.commands.addSubtask("n", "Bring the keys");
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(saidStillSaving()).toBe(false);
    expect(
      store.waitingEntries().map((e) => (e.kind === "create" ? e.task.title : e.kind)),
    ).toEqual(["Call Ana", "Bring the keys"]);
    // Shown at once, under its parent.
    const shown = store.getSnapshot().bundle.tasks.find((t) => t.title === "Bring the keys");
    expect(shown?.parentId).toBe("n");
    server.release();
    await act(async () => {
      await store.syncNow();
      await store.flush();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(server.refusals).toEqual([]);
    const sub = [...server.rows.values()].find((t) => t.title === "Bring the keys");
    expect(sub?.parentId).toBe("n");
    expect(store.waitingEntries()).toEqual([]);
  });
});

describe("offline, a task command on a task captured offline says Offline, as any edit does", () => {
  it.each(rows)("%s", async (_name, run) => {
    const { server, hook } = await mountWithFlushingCapture({ offline: true });
    await act(async () => {
      void run(hook.result.current.commands);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(server.refusals).toEqual([]);
    expect(saidStillSaving()).toBe(false);
    expect(saidOffline()).toBe(true);
  });
});
