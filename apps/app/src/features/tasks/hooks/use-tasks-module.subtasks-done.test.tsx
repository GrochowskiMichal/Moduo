// Call 87 (TV-U13): finishing a task finishes its open subtasks too, with one
// Undo that names them ("Done · also 2 subtasks"), from the checkbox, a
// status pick and a check-off alike. A repeating parent keeps its subtasks
// open (TV-D12 resets them per cycle); a subtask has none of its own.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import type { ProjectStatus, Task, TasksModuleBundle } from "../model";

type ToastOptions = { action?: { label: string; onClick: () => void } };
const toasts = rs.hoisted(() => ({
  notes: [] as Array<{ msg: string; options?: ToastOptions }>,
  errors: [] as string[],
}));
rs.mock("sonner", () => {
  const toast = (msg: string, options?: ToastOptions) => toasts.notes.push({ msg, options });
  toast.error = (msg: string) => toasts.errors.push(msg);
  toast.dismiss = () => {};
  return { toast };
});
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

import { renderTasksHook } from "../testing/tasks-hook";

const ME = "u1";
const PROJECT = {
  id: "p1",
  workspaceId: "w1",
  ownerId: ME,
  name: "Website",
  isSystem: false,
  group: null,
  position: "a",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};
const status = (id: string, category: ProjectStatus["category"], name: string): ProjectStatus => ({
  id,
  workspaceId: "w1",
  projectId: "p1",
  category,
  name,
  position: 1,
  hidden: false,
  createdAt: "",
  updatedAt: "",
});
const STATUSES = [
  status("s-todo", "todo", "Todo"),
  status("s-doing", "in_progress", "In progress"),
  status("s-done", "done", "Done"),
  status("s-wont", "wont_do", "Canceled"),
];

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

const done = { status: "done" as const, statusCategory: "done" as const, statusId: "s-done" };

async function mount(tasks: Task[]) {
  const bundle: TasksModuleBundle = {
    buckets: [PROJECT],
    tasks,
    tags: [],
    tagLinks: [],
    taskRelations: [],
    statuses: STATUSES,
    truncated: [],
  };
  const byId = (id: string) => tasks.find((t) => t.id === id) as Task;
  const api = {
    list: rs.fn(async () => bundle),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => []),
    opSetStatus: rs.fn(async ({ taskId, status: s }: { taskId: string; status: string }) =>
      s === "done" || s === "s-done" ? { ...byId(taskId), ...done } : byId(taskId),
    ),
    opCatchUp: rs.fn(async () => []),
  };
  const runtime = { tasks: api } as unknown as ModuoRuntime;
  const hook = renderTasksHook(runtime, {
    userId: ME,
    workspaceId: "w1",
    modulePermission: "edit",
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { api, hook };
}

const statusCalls = (api: { opSetStatus: { mock: { calls: unknown[][] } } }) =>
  api.opSetStatus.mock.calls.map((c) => {
    const arg = c[0] as { taskId: string; status: string };
    return `${arg.taskId}:${arg.status}`;
  });

beforeEach(() => {
  toasts.notes = [];
  toasts.errors = [];
});

describe("call 87: finishing a task finishes its open subtasks", () => {
  it("checks off the open subtasks with the parent and says so with one Undo", async () => {
    const parent = task("p");
    const { api, hook } = await mount([
      parent,
      task("c1", { parentId: "p" }),
      task("c2", { parentId: "p" }),
      task("c3", { parentId: "p", ...done }),
    ]);
    act(() => hook.result.current.commands.toggleDone(parent));
    await waitFor(() => expect(api.opSetStatus).toHaveBeenCalledTimes(3));
    expect(statusCalls(api).sort()).toEqual(["c1:done", "c2:done", "p:done"]);
    const said = toasts.notes.find((n) => n.msg.startsWith("Done · also"));
    expect(said?.msg).toBe("Done · also 2 subtasks");

    // Undo: each comes back to the status it had (by its own status id).
    await waitFor(() =>
      expect(hook.result.current.tasks.find((t) => t.id === "c1")?.statusCategory).toBe("done"),
    );
    act(() => said?.options?.action?.onClick());
    await waitFor(() => expect(api.opSetStatus).toHaveBeenCalledTimes(6));
    expect(statusCalls(api).slice(3).sort()).toEqual(["c1:s-todo", "c2:s-todo", "p:s-todo"]);
  });

  it("does the same through the status picker", async () => {
    const parent = task("p");
    const { api, hook } = await mount([parent, task("c1", { parentId: "p" })]);
    act(() => hook.result.current.commands.setTaskStatus("p", { statusId: "s-done" }));
    await waitFor(() => expect(api.opSetStatus).toHaveBeenCalledTimes(2));
    expect(statusCalls(api).sort()).toEqual(["c1:done", "p:s-done"]);
    expect(toasts.notes.some((n) => n.msg === "Done · also 1 subtask")).toBe(true);
  });

  it("leaves a repeating parent's subtasks open, and a subtask finishes alone", async () => {
    const repeating = task("r", {
      recurrence: { rrule: "FREQ=WEEKLY", dtstart: null, nextOccurrence: null },
    });
    const { api, hook } = await mount([
      repeating,
      task("rc", { parentId: "r" }),
      task("p"),
      task("c1", { parentId: "p" }),
    ]);
    act(() => hook.result.current.commands.toggleDone(repeating));
    act(() =>
      hook.result.current.commands.toggleDone(
        hook.result.current.tasks.find((t) => t.id === "c1") as Task,
      ),
    );
    await waitFor(() => expect(api.opSetStatus).toHaveBeenCalledTimes(2));
    expect(statusCalls(api).sort()).toEqual(["c1:done", "r:done"]);
    expect(toasts.notes.some((n) => n.msg.startsWith("Done · also"))).toBe(false);
  });
});
