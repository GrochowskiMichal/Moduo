// TV-U12 — a selection's change (`bulkWrite`, AC4.6, AC11.9; spec edge case
// "bulk action on 4 tasks where one is read-only"): each task goes through its
// own server op, the refused one goes back while the rest stay, the toast
// says "3 of 4 changed" and names the refused task, and one Undo puts the
// three back.

import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import type { Bucket, Task, TasksModuleBundle } from "../model";

type ToastOpts = { description?: string; action?: { label: string; onClick: () => void } };
const toastMock = rs.hoisted(() => {
  let n = 0;
  const fn = rs.fn((..._args: unknown[]) => `toast-${++n}`);
  return Object.assign(fn, { dismiss: rs.fn(), error: rs.fn(), message: rs.fn() });
});
rs.mock("sonner", () => ({ toast: toastMock }));
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));

import { useTasksModule } from "./use-tasks-module";

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

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
    id,
    creatorId: "u1",
    assigneeId: "u1",
    ...over,
  };
}

/** A server that refuses any write to `readOnly`, as the op's task gate does. */
function fakeRuntime(tasks: Task[], readOnly: string) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  const bundle = (): TasksModuleBundle => ({
    buckets: [bucket("inbox", { isSystem: true, name: "Inbox" }), bucket("p1"), bucket("p2")],
    tasks: [...rows.values()],
    tags: [],
    tagLinks: [],
    taskRelations: [],
    truncated: [],
  });
  const write = async (id: string, patch: Partial<Task>) => {
    await new Promise((r) => setTimeout(r, 2));
    if (id === readOnly) throw new Error("You don't have access to this task.");
    const next = { ...(rows.get(id) as Task), ...patch };
    rows.set(id, next);
    return next;
  };
  const api = {
    list: rs.fn(async () => bundle()),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => []),
    opCatchUp: rs.fn(async () => []),
    updateTask: rs.fn(({ taskId, patch }: { taskId: string; patch: Partial<Task> }) =>
      write(taskId, patch),
    ),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => [
      await write(taskId, patch),
    ]),
    opSetStatus: rs.fn(({ taskId, status }: { taskId: string; status: Task["status"] }) =>
      write(taskId, { status, statusCategory: status === "done" ? "done" : "todo" }),
    ),
    opAssign: rs.fn(({ taskId, assigneeId }: { taskId: string; assigneeId: string | null }) =>
      write(taskId, { assigneeId }),
    ),
    // As the server: a delete promotes the task's live subtasks to the top.
    deleteTask: rs.fn(async ({ taskId }: { taskId: string }) => {
      await new Promise((r) => setTimeout(r, 2));
      for (const t of rows.values()) {
        if (t.parentId === taskId && !t.deletedAt) rows.set(t.id, { ...t, parentId: null });
      }
      return write(taskId, { deletedAt: new Date().toISOString() });
    }),
    listTrash: rs.fn(async () => ({ buckets: [], tasks: [] })),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, api, rows };
}

async function mount(tasks: Task[], readOnly: string) {
  toastMock.mockClear();
  toastMock.error.mockClear();
  const fake = fakeRuntime(tasks, readOnly);
  const hook = renderHook(() =>
    useTasksModule(fake.runtime, { userId: "u1", workspaceId: "w1", modulePermission: "edit" }),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...fake, hook };
}

describe("bulkWrite — one write for a selection, one Undo (AC4.6, AC11.9)", () => {
  it("changes the three it may, names the read-only fourth, and Undo puts the three back", async () => {
    const { hook, api, rows } = await mount(
      [task("a"), task("b"), task("c"), task("locked", { title: "Pricing copy" })],
      "locked",
    );
    let changed: string[] = [];
    await act(async () => {
      changed = await hook.result.current.bulkWrite(
        ["a", "b", "c", "locked"].map((taskId) => ({ taskId, bucketId: "p2" })),
        { label: (n) => `Moved ${n} tasks to p2` },
      );
    });
    expect(changed.sort()).toEqual(["a", "b", "c"]);
    // Each task went through its own op (its own permission check).
    expect(api.opUpdateTask).toHaveBeenCalledTimes(4);
    // The store shows the server's rows: the refused one stayed where it was.
    const shown = new Map(hook.result.current.tasks.map((t) => [t.id, t.bucketId]));
    expect([shown.get("a"), shown.get("b"), shown.get("c"), shown.get("locked")]).toEqual([
      "p2",
      "p2",
      "p2",
      "p1",
    ]);
    const call = toastMock.mock.calls.find((c) => c[0] === "3 of 4 changed");
    expect(call).toBeTruthy();
    const opts = call?.[1] as ToastOpts;
    expect(opts.description).toBe("“Pricing copy” is read-only to you.");
    expect(opts.action?.label).toBe("Undo");
    // One Undo for the whole batch.
    await act(async () => {
      opts.action?.onClick();
      await new Promise((r) => setTimeout(r, 40));
    });
    await waitFor(() =>
      expect(["a", "b", "c"].map((id) => rows.get(id)?.bucketId)).toEqual(["p1", "p1", "p1"]),
    );
  });

  it("says the change alone when every task saved", async () => {
    const { hook } = await mount([task("a"), task("b")], "none");
    await act(async () => {
      await hook.result.current.bulkWrite(
        ["a", "b"].map((taskId) => ({ taskId, status: "done" as const })),
        { label: (n) => `Completed ${n} tasks` },
      );
    });
    expect(toastMock.mock.calls.some((c) => c[0] === "Completed 2 tasks")).toBe(true);
  });

  it("deleting a parent and its selected subtask, then Undo, keeps the subtask under its parent", async () => {
    const { hook, rows } = await mount(
      [task("parent"), task("sub", { parentId: "parent" }), task("other")],
      "none",
    );
    await act(async () => {
      await hook.result.current.bulkDelete(["parent", "sub", "other"]);
    });
    const call = toastMock.mock.calls.find((c) => c[0] === "Deleted 3 tasks");
    expect(call).toBeTruthy();
    // The subtask went first, so the parent's delete didn't promote it.
    expect(rows.get("sub")?.parentId).toBe("parent");
    await act(async () => {
      (call?.[1] as ToastOpts | undefined)?.action?.onClick();
      await new Promise((r) => setTimeout(r, 40));
    });
    await waitFor(() => expect(rows.get("sub")?.deletedAt ?? null).toBeNull());
    expect(rows.get("sub")?.parentId).toBe("parent");
    expect(rows.get("parent")?.deletedAt ?? null).toBeNull();
  });
});
