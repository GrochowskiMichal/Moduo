// TV-D4: the Tasks hook reads and writes MY queue (D4-1), shows who else has a
// task queued and notes it when I queue it too (D4-2).

import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { WorkspaceContext, type WorkspaceContextValue } from "../../workspaces/workspace-context";
import { makeTask } from "../helpers";
import type { Task, TaskQueueEntry, TasksModuleBundle } from "../model";

const toasts = rs.hoisted(() => ({ notes: [] as string[], errors: [] as string[] }));
rs.mock("sonner", () => {
  const toast = (msg: string) => toasts.notes.push(msg);
  toast.error = (msg: string) => toasts.errors.push(msg);
  return { toast };
});

import { useTasksModule } from "./use-tasks-module";

const ME = "u1";
const MIKE = "u2";

const BUCKET = {
  id: "b1",
  workspaceId: "w1",
  ownerId: ME,
  name: "Inbox",
  isSystem: true,
  group: null,
  position: "a",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    creatorId: ME,
    assigneeId: ME,
    ...over,
  };
}

function row(userId: string, taskId: string, position: string, workspaceId = "w1"): TaskQueueEntry {
  return {
    id: `${userId}:${taskId}`,
    workspaceId,
    userId,
    taskId,
    position,
    queuedAt: "2026-10-08T10:00:00Z",
    updatedAt: "2026-10-08T10:00:00Z",
  };
}

/** A fake server holding the queue rows; each op answers with my queue. */
function fakeRuntime(tasks: Task[], queue: TaskQueueEntry[]) {
  let rows = queue.slice();
  const bundle: TasksModuleBundle = {
    buckets: [BUCKET],
    tasks,
    tags: [],
    tagLinks: [],
    taskRelations: [],
    truncated: [],
  };
  const mine = () =>
    rows
      .filter((r) => r.userId === ME && r.workspaceId === "w1")
      .sort((a, b) => (a.position < b.position ? -1 : 1));
  const byId = (id: string) => tasks.find((t) => t.id === id) as Task;
  const api = {
    list: rs.fn(async () => bundle),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => rows.slice()),
    opQueueAdd: rs.fn(async ({ taskId }: { taskId: string; at?: string }) => {
      if (!mine().some((r) => r.taskId === taskId)) rows.push(row(ME, taskId, "zzzzzzzzzz"));
      return mine();
    }),
    opQueueRemove: rs.fn(async ({ taskId }: { taskId: string }) => {
      rows = rows.filter((r) => !(r.userId === ME && r.taskId === taskId));
      return mine();
    }),
    opQueueReorder: rs.fn(async () => mine()),
    opQueueMoveToEnd: rs.fn(async () => mine()),
    opSetStatus: rs.fn(async ({ taskId, status }: { taskId: string; status: Task["status"] }) => {
      if (status === "done" || status === "archived")
        rows = rows.filter((r) => r.taskId !== taskId);
      return { ...byId(taskId), status };
    }),
    opCatchUp: rs.fn(async () => []),
  };
  const serverAdd = (taskId: string, position: string) => rows.push(row(ME, taskId, position));
  return { runtime: { tasks: api } as unknown as ModuoRuntime, api, serverAdd };
}

const MEMBERS = [
  { userId: ME, displayName: "Maciej" },
  { userId: MIKE, displayName: "Mike" },
];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <WorkspaceContext.Provider value={{ members: MEMBERS } as unknown as WorkspaceContextValue}>
      {children}
    </WorkspaceContext.Provider>
  );
}

async function mount(tasks: Task[], queue: TaskQueueEntry[], permission: "edit" | "view" = "edit") {
  const fake = fakeRuntime(tasks, queue);
  const hook = renderHook(
    () =>
      useTasksModule(fake.runtime, { userId: ME, workspaceId: "w1", modulePermission: permission }),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...fake, hook };
}

beforeEach(() => {
  toasts.notes = [];
  toasts.errors = [];
});

describe("useTasksModule: my queue (TV-D4)", () => {
  it("reads my queue in order, counts my open ones, and keeps others' rows as claims", async () => {
    const { hook } = await mount(
      [task("t1"), task("t2"), task("t3")],
      [row(ME, "t2", "000000mh34"), row(ME, "t1", "00000168g8"), row(MIKE, "t3", "000000mh34")],
    );
    const api = hook.result.current;
    expect(api.queuedTasks.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(api.queueCount).toBe(2);
    expect([...api.queuedTaskIds].sort()).toEqual(["t1", "t2"]);
    expect(api.queueClaims.get("t3")).toEqual([MIKE]);
    expect(api.queueClaims.has("t1")).toBe(false);
  });

  it("ignores rows of another workspace", async () => {
    const { hook } = await mount([task("t1")], [row(ME, "t1", "1", "w2")]);
    expect(hook.result.current.queuedTasks).toEqual([]);
  });

  it("the toggle adds to the end of my queue (shown at once) and removes again", async () => {
    const { api, hook } = await mount([task("t1"), task("t2")], [row(ME, "t1", "000000mh34")]);
    act(() => hook.result.current.toggleQueue("t2"));
    // Optimistic: queued before the server answers.
    expect(hook.result.current.queuedTaskIds.has("t2")).toBe(true);
    expect(hook.result.current.queuedTasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    await waitFor(() => expect(api.opQueueAdd).toHaveBeenCalledTimes(1));
    expect(api.opQueueAdd).toHaveBeenCalledWith({ workspaceId: "w1", taskId: "t2", at: "end" });
    expect(toasts.notes).toEqual([]);

    act(() => hook.result.current.toggleQueue("t1"));
    expect(hook.result.current.queuedTaskIds.has("t1")).toBe(false);
    await waitFor(() =>
      expect(api.opQueueRemove).toHaveBeenCalledWith({ workspaceId: "w1", taskId: "t1" }),
    );
    await waitFor(() => expect(hook.result.current.queuedTasks.map((t) => t.id)).toEqual(["t2"]));
  });

  it("queuing a task Mike has queued is allowed, with a quiet 'Also in Mike's queue'", async () => {
    const { api, hook } = await mount([task("t1")], [row(MIKE, "t1", "1")]);
    act(() => hook.result.current.toggleQueue("t1"));
    await waitFor(() => expect(api.opQueueAdd).toHaveBeenCalledTimes(1));
    expect(toasts.notes).toEqual(["Also in Mike’s queue"]);
    // Mike's claim stays.
    expect(hook.result.current.queueClaims.get("t1")).toEqual([MIKE]);
  });

  it("refuses done tasks without a round trip", async () => {
    const { api, hook } = await mount([task("t1", { status: "done" })], []);
    act(() => hook.result.current.toggleQueue("t1"));
    expect(api.opQueueAdd).not.toHaveBeenCalled();
    expect(toasts.errors).toEqual(["Done tasks can't be queued."]);
  });

  it("a view-only member can't change the queue", async () => {
    const { api, hook } = await mount([task("t1")], [row(MIKE, "t1", "1")], "view");
    act(() => hook.result.current.toggleQueue("t1"));
    expect(api.opQueueAdd).not.toHaveBeenCalled();
    expect(hook.result.current.queuedTaskIds.has("t1")).toBe(false);
    // Claims still read.
    expect(hook.result.current.queueClaims.get("t1")).toEqual([MIKE]);
  });

  it("completing a queued task takes it out of every queue; it stays shown, done, until reload", async () => {
    const { hook } = await mount(
      [task("t1"), task("t2")],
      [row(ME, "t1", "000000mh34"), row(ME, "t2", "00000168g8"), row(MIKE, "t1", "1")],
    );
    act(() => hook.result.current.markDone("t1"));
    const api = hook.result.current;
    expect(api.queuedTaskIds.has("t1")).toBe(false);
    expect(api.queueClaims.has("t1")).toBe(false);
    expect(api.queueCount).toBe(1);
    await waitFor(() =>
      expect(hook.result.current.queuedTasks.map((t) => [t.id, t.status])).toEqual([
        ["t1", "done"],
        ["t2", "todo"],
      ]),
    );
    // Reopening doesn't re-queue it (TV-D2): it leaves the Queue view.
    act(() => hook.result.current.patchTask("t1", { status: "todo" }));
    await waitFor(() => expect(hook.result.current.queuedTasks.map((t) => t.id)).toEqual(["t2"]));
    // After a reload the server's queue is the truth.
    await act(() => hook.result.current.reload());
    expect(hook.result.current.queuedTasks.map((t) => t.id)).toEqual(["t2"]);
  });

  it("a drag in the Queue becomes one reorder after the task it now follows", async () => {
    const { api, hook } = await mount(
      [task("a"), task("b"), task("c")],
      [row(ME, "a", "000000mh34"), row(ME, "b", "00000168g8"), row(ME, "c", "000001ilsc")],
    );
    act(() => hook.result.current.reorderQueue(["c", "a", "b"]));
    expect(hook.result.current.queuedTasks.map((t) => t.id)).toEqual(["c", "a", "b"]);
    await waitFor(() =>
      expect(api.opQueueReorder).toHaveBeenCalledWith({
        workspaceId: "w1",
        taskId: "c",
        afterTaskId: null,
      }),
    );
  });

  it("Skip in Focus moves the task to the end of my queue", async () => {
    const { api, hook } = await mount(
      [task("a"), task("b")],
      [row(ME, "a", "000000mh34"), row(ME, "b", "00000168g8")],
    );
    act(() => hook.result.current.moveQueuedToEnd("a"));
    expect(hook.result.current.queuedTasks.map((t) => t.id)).toEqual(["b", "a"]);
    await waitFor(() =>
      expect(api.opQueueMoveToEnd).toHaveBeenCalledWith({ workspaceId: "w1", taskId: "a" }),
    );
  });

  it("an older op's late answer never overwrites a newer one", async () => {
    const { api, hook, serverAdd } = await mount([task("t1"), task("t2")], []);
    let releaseFirst: (rows: TaskQueueEntry[]) => void = () => {};
    // The server takes the first add at once but its answer arrives last.
    api.opQueueAdd.mockImplementationOnce(() => {
      serverAdd("t1", "000000mh34");
      return new Promise<TaskQueueEntry[]>((resolve) => {
        releaseFirst = resolve;
      });
    });
    act(() => hook.result.current.toggleQueue("t1"));
    act(() => hook.result.current.toggleQueue("t2"));
    await waitFor(() => expect(api.opQueueAdd).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.queuedTaskIds.size).toBe(2));
    // The first op's answer (only t1) lands last.
    await act(async () => releaseFirst([row(ME, "t1", "000000mh34")]));
    expect([...hook.result.current.queuedTaskIds].sort()).toEqual(["t1", "t2"]);
  });

  it("captures a new task straight into my queue", async () => {
    const { api, hook } = await mount([], []);
    const created = task("t-new", { title: "Call the bank" });
    (api as unknown as { upsertTask: unknown }).upsertTask = rs.fn(async () => created);
    act(() => hook.result.current.captureToQueue("Call the bank"));
    expect(hook.result.current.queuedTasks.map((t) => t.title)).toEqual(["Call the bank"]);
    await waitFor(() =>
      expect(api.opQueueAdd).toHaveBeenCalledWith({ workspaceId: "w1", taskId: "t-new" }),
    );
    await waitFor(() =>
      expect(hook.result.current.queuedTasks.map((t) => t.id)).toEqual(["t-new"]),
    );
  });
});
