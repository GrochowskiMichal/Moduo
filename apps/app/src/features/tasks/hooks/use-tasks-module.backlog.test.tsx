// TV-D9: statuses through the Tasks hook. Queuing or scheduling a backlog
// task moves it to To do (the server does it; the list shows it at once);
// assigning one or giving it a due date offers "Move to To do"; a status is
// set by the project's status id or by category, and the checkbox's legacy
// values change the category the list reads.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

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
  return { toast };
});
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

import { useTasksModule } from "./use-tasks-module";

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

const status = (
  id: string,
  category: ProjectStatus["category"],
  name: string,
  position = 1,
): ProjectStatus => ({
  id,
  workspaceId: "w1",
  projectId: "p1",
  category,
  name,
  position,
  hidden: false,
  createdAt: "",
  updatedAt: "",
});
const STATUSES = [
  status("s-backlog", "backlog", "Ideas"),
  status("s-todo", "todo", "Todo"),
  status("s-doing", "in_progress", "In progress"),
  status("s-review", "in_progress", "In review", 2),
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

function fakeRuntime(tasks: Task[]) {
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
    opQueueAdd: rs.fn(async () => []),
    opSetStatus: rs.fn(async ({ taskId }: { taskId: string; status: string }) => byId(taskId)),
    opAssign: rs.fn(
      async ({ taskId, assigneeId }: { taskId: string; assigneeId: string | null }) => ({
        ...byId(taskId),
        assigneeId,
      }),
    ),
    opReschedule: rs.fn(
      async ({ taskId, scheduledAt }: { taskId: string; scheduledAt: string }) => ({
        ...byId(taskId),
        scheduledAt,
        status: "todo" as const,
        statusCategory: "todo" as const,
        statusId: "s-todo",
      }),
    ),
    opCatchUp: rs.fn(async () => []),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, api };
}

async function mount(tasks: Task[]) {
  const fake = fakeRuntime(tasks);
  const hook = renderHook(() =>
    useTasksModule(fake.runtime, { userId: ME, workspaceId: "w1", modulePermission: "edit" }),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...fake, hook };
}

const backlog = (id: string) =>
  task(id, { status: "todo", statusCategory: "backlog", statusId: "s-backlog" });

beforeEach(() => {
  toasts.notes = [];
  toasts.errors = [];
});

describe("useTasksModule: statuses (TV-D9)", () => {
  it("reads the project's statuses, and the sidebar count leaves Backlog out", async () => {
    const { hook } = await mount([backlog("b1"), task("t1")]);
    expect(hook.result.current.statusesForBucket("p1").map((s) => s.name)).toEqual([
      "Ideas",
      "Todo",
      "In progress",
      "In review",
      "Done",
      "Canceled",
    ]);
    expect(hook.result.current.openTaskCountByBucket.get("p1")).toBe(1);
  });

  it("queuing a backlog task shows it in To do at once (the server moves it)", async () => {
    const { api, hook } = await mount([backlog("b1")]);
    act(() => hook.result.current.addToQueue("b1"));
    const shown = hook.result.current.tasks.find((t) => t.id === "b1");
    expect(shown?.statusCategory).toBe("todo");
    expect(shown?.statusId).toBe("s-todo");
    await waitFor(() => expect(api.opQueueAdd).toHaveBeenCalledTimes(1));
  });

  it("scheduling a backlog task shows it in To do at once", async () => {
    const { api, hook } = await mount([backlog("b1")]);
    act(() => hook.result.current.scheduleTaskAt("b1", "2026-11-12T09:00:00.000Z"));
    expect(hook.result.current.tasks.find((t) => t.id === "b1")?.statusCategory).toBe("todo");
    await waitFor(() => expect(api.opReschedule).toHaveBeenCalledTimes(1));
  });

  it("assigning a backlog task offers Move to To do, which sets the category", async () => {
    const { api, hook } = await mount([backlog("b1")]);
    act(() => hook.result.current.patchTask("b1", { assigneeId: "u2" }));
    await waitFor(() => expect(api.opAssign).toHaveBeenCalledTimes(1));
    const offer = toasts.notes.find((n) => n.options?.action?.label === "Move to To do");
    expect(offer?.msg).toBe("b1 is still in Backlog");
    act(() => offer?.options?.action?.onClick());
    await waitFor(() => expect(api.opSetStatus).toHaveBeenCalledTimes(1));
    expect(api.opSetStatus.mock.calls[0]![0]).toMatchObject({ taskId: "b1", status: "todo" });
  });

  it("giving a backlog task a due date offers it too; an open task's doesn't", async () => {
    const { hook } = await mount([backlog("b1"), task("t1")]);
    act(() => hook.result.current.patchTask("t1", { dueDate: "2026-11-20T00:00:00.000Z" }));
    expect(toasts.notes.some((n) => n.options?.action)).toBe(false);
    act(() => hook.result.current.patchTask("b1", { dueDate: "2026-11-20T00:00:00.000Z" }));
    expect(toasts.notes.some((n) => n.options?.action?.label === "Move to To do")).toBe(true);
  });

  it("sets a status by the project's id, or by category (sent as the category word)", async () => {
    const { api, hook } = await mount([task("t1")]);
    act(() => hook.result.current.setTaskStatus("t1", { statusId: "s-review" }));
    expect(hook.result.current.tasks.find((t) => t.id === "t1")).toMatchObject({
      statusId: "s-review",
      statusCategory: "in_progress",
      status: "in_progress",
    });
    await waitFor(() => expect(api.opSetStatus).toHaveBeenCalledTimes(1));
    expect(api.opSetStatus.mock.calls[0]![0]).toMatchObject({ status: "s-review" });

    act(() => hook.result.current.setTaskStatus("t1", { category: "backlog" }));
    expect(hook.result.current.tasks.find((t) => t.id === "t1")).toMatchObject({
      statusId: "s-backlog",
      statusCategory: "backlog",
      status: "todo",
    });
    await waitFor(() => expect(api.opSetStatus).toHaveBeenCalledTimes(2));
    expect(api.opSetStatus.mock.calls[1]![0]).toMatchObject({ status: "backlog" });
  });

  it("the checkbox's done changes the category the list reads, before the server answers", async () => {
    const { api, hook } = await mount([task("t1")]);
    act(() => hook.result.current.toggleDone(hook.result.current.tasks[0]!));
    expect(hook.result.current.tasks.find((t) => t.id === "t1")).toMatchObject({
      status: "done",
      statusCategory: "done",
      statusId: "s-done",
    });
    await waitFor(() => expect(api.opSetStatus).toHaveBeenCalledTimes(1));
    expect(api.opSetStatus.mock.calls[0]![0]).toMatchObject({ status: "done" });
  });
});
