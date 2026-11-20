// Track A3 through the Tasks hook: the commands follow `planTaskWrite`'s
// rules on every path. A status sent with another field still takes the task
// out of my queue; a refused check-off says nothing more and finishes no
// subtasks; a bulk reschedule of a backlog task shows it in To do; the
// Inbox's "assign and edit" sends the status as its category word.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import type {
  Bucket,
  ProjectStatus,
  RecurrenceRule,
  Task,
  TaskQueueEntry,
  TasksModuleBundle,
} from "../model";

type ToastOptions = { action?: { label: string; onClick: () => void } };
const toasts = rs.hoisted(() => ({
  notes: [] as Array<{ msg: string; options?: ToastOptions }>,
  errors: [] as string[],
}));
rs.mock("sonner", () => {
  const toast = (msg: string, options?: ToastOptions) => {
    toasts.notes.push({ msg, options });
    return `toast-${toasts.notes.length}`;
  };
  toast.error = (msg: string) => toasts.errors.push(msg);
  toast.dismiss = () => {};
  return { toast };
});
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

import { renderTasksHook } from "../testing/tasks-hook";

const ME = "u1";

const bucket = (id: string, over: Partial<Bucket> = {}): Bucket => ({
  id,
  workspaceId: "w1",
  ownerId: ME,
  name: id.toUpperCase(),
  isSystem: false,
  group: null,
  position: id,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  ...over,
});

const status = (
  id: string,
  category: ProjectStatus["category"],
  projectId: string | null,
): ProjectStatus => ({
  id,
  workspaceId: "w1",
  projectId,
  category,
  name: id,
  position: 1,
  hidden: false,
  createdAt: "",
  updatedAt: "",
});

const STATUSES = [
  status("s-backlog", "backlog", "p1"),
  status("s-todo", "todo", "p1"),
  status("s-done", "done", "p1"),
  status("d-todo", "todo", null),
  status("d-done", "done", null),
];

const DAILY: RecurrenceRule = {
  rrule: "FREQ=DAILY",
  dtstart: "2026-10-01T07:00:00.000Z",
  nextOccurrence: null,
};

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
    id,
    creatorId: ME,
    assigneeId: ME,
    statusId: "s-todo",
    statusCategory: "todo",
    ...over,
  };
}

const queueRow = (taskId: string): TaskQueueEntry => ({
  id: `q-${taskId}`,
  workspaceId: "w1",
  userId: ME,
  taskId,
  position: "a0",
  queuedAt: "2026-10-13T08:00:00.000Z",
  updatedAt: "2026-10-13T08:00:00.000Z",
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeRuntime(tasks: Task[], queue: TaskQueueEntry[] = []) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  const bundle = (): TasksModuleBundle => ({
    buckets: [
      bucket("inbox", { isSystem: true, name: "Inbox" }),
      bucket("p1"),
      bucket("x", { name: "X", archivedAt: "2026-10-19T00:00:00.000Z" }),
    ],
    tasks: [...rows.values()],
    tags: [],
    tagLinks: [],
    taskRelations: [],
    statuses: STATUSES,
    truncated: [],
  });
  const write = (id: string, patch: Partial<Task>): Task => {
    const next = { ...(rows.get(id) as Task), ...patch, updatedAt: new Date().toISOString() };
    rows.set(id, next);
    return next;
  };
  const reschedule = { gate: deferred<void>() };
  const api = {
    list: rs.fn(async () => bundle()),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => [...queue]),
    opQueueAdd: rs.fn(async () => [...queue]),
    opCatchUp: rs.fn(async () => []),
    upsertTask: rs.fn(() => new Promise<Task>(() => {})),
    updateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) =>
      write(taskId, patch),
    ),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => [
      write(taskId, patch),
    ]),
    opSetStatus: rs.fn(async ({ taskId }: { taskId: string; status: string }) => write(taskId, {})),
    opAssign: rs.fn(async ({ taskId, assigneeId }: { taskId: string; assigneeId: string | null }) =>
      write(taskId, { assigneeId }),
    ),
    opReschedule: rs.fn(
      async ({ taskId, scheduledAt }: { taskId: string; scheduledAt: string }) => {
        await reschedule.gate.promise;
        return write(taskId, {
          scheduledAt,
          status: "todo",
          statusCategory: "todo",
          statusId: "s-todo",
        });
      },
    ),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, api, reschedule };
}

async function mount(tasks: Task[], queue: TaskQueueEntry[] = []) {
  const fake = fakeRuntime(tasks, queue);
  const hook = renderTasksHook(fake.runtime, {
    userId: ME,
    workspaceId: "w1",
    modulePermission: "edit",
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...fake, hook };
}

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));

beforeEach(() => {
  toasts.notes = [];
  toasts.errors = [];
});

describe("Tasks: one task's write follows the planner (A3)", () => {
  it("a status sent with another field takes the task out of my queue, and it stays out", async () => {
    const { api, hook } = await mount([task("t1")], [queueRow("t1")]);
    await waitFor(() => expect(hook.result.current.queuedTaskIds.has("t1")).toBe(true));
    act(() => hook.result.current.commands.patchTask("t1", { status: "done", title: "Shipped" }));
    // Shown at once: the same write takes it out of the queue.
    expect(hook.result.current.queuedTaskIds.has("t1")).toBe(false);
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1));
    expect(api.updateTask.mock.calls[0]![0].patch).toMatchObject({
      title: "Shipped",
      status: "done",
      statusCategory: "done",
    });
    expect(api.opSetStatus).not.toHaveBeenCalled();
    await tick();
    // Settled: the row the server dropped is gone from the copy too.
    expect(hook.result.current.queuedTaskIds.has("t1")).toBe(false);
  });

  it("a check-off refused for an archived project says so once: no next, no subtasks", async () => {
    const repeating = task("a1", { bucketId: "x", recurrence: DAILY });
    const parent = task("a2", { bucketId: "x" });
    const child = task("a2c", { bucketId: "x", parentId: "a2" });
    const { api, hook } = await mount([repeating, parent, child]);
    act(() => hook.result.current.commands.toggleDone(repeating));
    act(() => hook.result.current.commands.toggleDone(parent));
    act(() => hook.result.current.commands.markDone("a2"));
    await tick();
    expect(toasts.errors).toEqual([
      "Unarchive “X” to change its tasks.",
      "Unarchive “X” to change its tasks.",
      "Unarchive “X” to change its tasks.",
    ]);
    expect(toasts.notes.map((n) => n.msg)).toEqual([]);
    expect(api.opSetStatus).not.toHaveBeenCalled();
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("a check-off of a task still saving says so once and finishes nothing", async () => {
    const { api, hook } = await mount([]);
    act(() => {
      void hook.result.current.commands.createTask({ bucketId: "p1", title: "New" });
    });
    const tempId = hook.result.current.tasks.find((t) => t.title === "New")?.id ?? "";
    expect(tempId.startsWith("tmp-")).toBe(true);
    act(() => hook.result.current.commands.markDone(tempId));
    await tick();
    expect(toasts.errors).toEqual(["Still saving that task — try again in a moment."]);
    expect(toasts.notes.map((n) => n.msg)).toEqual([]);
    expect(api.opSetStatus).not.toHaveBeenCalled();
  });

  it("a bulk reschedule of a backlog task shows it in To do before the server answers", async () => {
    const backlog = task("b1", {
      status: "todo",
      statusCategory: "backlog",
      statusId: "s-backlog",
    });
    const { api, hook, reschedule } = await mount([backlog]);
    let done: Promise<string[]> = Promise.resolve([]);
    act(() => {
      done = hook.result.current.commands.bulkWrite(
        [{ taskId: "b1", scheduledAt: "2026-11-12T09:00:00.000Z" }],
        {
          label: (n) => `Moved ${n}`,
        },
      );
    });
    expect(hook.result.current.tasks.find((t) => t.id === "b1")).toMatchObject({
      statusCategory: "todo",
      statusId: "s-todo",
      scheduledAt: "2026-11-12T09:00:00.000Z",
    });
    await waitFor(() => expect(api.opReschedule).toHaveBeenCalledTimes(1));
    // Only the reschedule is sent: the server moves it out of Backlog itself.
    expect(api.opSetStatus).not.toHaveBeenCalled();
    await act(async () => {
      reschedule.gate.resolve();
      await done;
    });
    expect(hook.result.current.tasks.find((t) => t.id === "b1")?.statusCategory).toBe("todo");
  });

  it("the Inbox's assign-and-edit sends the status as its category word, not a picked id", async () => {
    const inboxTask = task("i1", { bucketId: "inbox", statusId: "d-todo" });
    const { api, hook } = await mount([inboxTask]);
    act(() => hook.result.current.commands.patchTask("i1", { assigneeId: "u2", status: "done" }));
    // Shown at once with the default set's Done.
    expect(hook.result.current.tasks.find((t) => t.id === "i1")).toMatchObject({
      assigneeId: "u2",
      statusCategory: "done",
      statusId: "d-done",
    });
    await waitFor(() => expect(api.opAssign).toHaveBeenCalledTimes(1));
    expect(api.opUpdateTask).toHaveBeenCalledTimes(1);
    expect(api.opUpdateTask.mock.calls[0]![0].patch).toEqual({
      status: "done",
      statusCategory: "done",
    });
    expect(api.opUpdateTask.mock.invocationCallOrder[0]).toBeLessThan(
      api.opAssign.mock.invocationCallOrder[0]!,
    );
  });
});
