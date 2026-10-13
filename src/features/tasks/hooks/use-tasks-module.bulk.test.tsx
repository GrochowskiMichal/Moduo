// TV-U12 — a selection's change (`bulkWrite`, AC4.6, AC11.9; spec edge case
// "bulk action on 4 tasks where one is read-only"): each task goes through its
// own server op, the refused one goes back while the rest stay, the toast
// says "3 of 4 changed" and names the refused task, and one Undo puts the
// three back.

import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import type {
  Bucket,
  Task,
  TaskQueueEntry,
  TaskRelation,
  TasksModuleBundle,
  TaskWaitingEntry,
} from "../model";

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

type FakeOptions = {
  /** Its status op is refused (its other ops save). */
  refuseStatus?: string;
  /** Its restore from Recently deleted is refused (its delete saves). */
  refuseRestore?: string;
  /** Its Waiting on entries can't be removed. */
  refuseWaitingRemove?: string;
  /** Already in my Focus line-up, in order. */
  queued?: string[];
  relations?: TaskRelation[];
};

const queueEntry = (taskId: string, position: string): TaskQueueEntry => ({
  id: `q-${taskId}`,
  workspaceId: "w1",
  userId: "u1",
  taskId,
  position,
  queuedAt: "2026-10-13T08:00:00.000Z",
  updatedAt: "2026-10-13T08:00:00.000Z",
});

/** A server that refuses any write to `readOnly`, as the op's task gate does. */
function fakeRuntime(tasks: Task[], readOnly: string, opts: FakeOptions = {}) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  const bundle = (): TasksModuleBundle => ({
    buckets: [bucket("inbox", { isSystem: true, name: "Inbox" }), bucket("p1"), bucket("p2")],
    tasks: [...rows.values()],
    tags: [],
    tagLinks: [],
    taskRelations: opts.relations ?? [],
    truncated: [],
  });
  const write = async (id: string, patch: Partial<Task>) => {
    await new Promise((r) => setTimeout(r, 2));
    if (id === readOnly) throw new Error("You don't have access to this task.");
    if (id === opts.refuseRestore && patch.deletedAt === null) {
      throw new Error("It was deleted more than 30 days ago.");
    }
    // Every write moves the row's clock, as the server's trigger does.
    clock += 1;
    const next = {
      ...(rows.get(id) as Task),
      ...patch,
      updatedAt: new Date(startedAt + clock * 1000).toISOString(),
    };
    rows.set(id, next);
    return next;
  };
  let clock = 0;
  const startedAt = Date.now();
  let queue = (opts.queued ?? []).map((taskId, i) => queueEntry(taskId, `a${i}`));
  const waiting = new Map<string, TaskWaitingEntry>();
  const api = {
    list: rs.fn(async () => bundle()),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => [...queue]),
    opQueueAdd: rs.fn(async ({ taskId }: { taskId: string }) => {
      await new Promise((r) => setTimeout(r, 2));
      if (!queue.some((e) => e.taskId === taskId)) {
        queue = [...queue, queueEntry(taskId, `b${queue.length}`)];
      }
      return [...queue];
    }),
    opQueueRemove: rs.fn(async ({ taskId }: { taskId: string }) => {
      await new Promise((r) => setTimeout(r, 2));
      queue = queue.filter((e) => e.taskId !== taskId);
      return [...queue];
    }),
    addWaiting: rs.fn(
      async (input: { taskId: string; id: string; kind: TaskWaitingEntry["kind"] }) => {
        await new Promise((r) => setTimeout(r, 2));
        const row: TaskWaitingEntry = {
          id: input.id,
          workspaceId: "w1",
          taskId: input.taskId,
          kind: input.kind,
          ref: null,
          label: "the printer",
          since: "2026-10-13T08:00:00.000Z",
          createdBy: "u1",
          updatedAt: "2026-10-13T08:00:00.000Z",
        };
        waiting.set(row.id, row);
        return [...waiting.values()].filter((w) => w.taskId === input.taskId);
      },
    ),
    removeWaiting: rs.fn(async ({ entryId }: { entryId: string }) => {
      await new Promise((r) => setTimeout(r, 2));
      const row = waiting.get(entryId);
      if (row && row.taskId === opts.refuseWaitingRemove) {
        throw new Error("You don't have access to this task.");
      }
      waiting.delete(entryId);
      return [...waiting.values()].filter((w) => w.taskId === row?.taskId);
    }),
    opCatchUp: rs.fn(async () => []),
    updateTask: rs.fn(({ taskId, patch }: { taskId: string; patch: Partial<Task> }) =>
      write(taskId, patch),
    ),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => [
      await write(taskId, patch),
    ]),
    opSetStatus: rs.fn(async ({ taskId, status }: { taskId: string; status: Task["status"] }) => {
      if (taskId === opts.refuseStatus) {
        await new Promise((r) => setTimeout(r, 2));
        throw new Error("That status isn’t in this project.");
      }
      return write(taskId, { status, statusCategory: status === "done" ? "done" : "todo" });
    }),
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

async function mount(tasks: Task[], readOnly: string, opts: FakeOptions = {}) {
  toastMock.mockClear();
  toastMock.error.mockClear();
  const fake = fakeRuntime(tasks, readOnly, opts);
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

// TV-U13b — the three bulk bugs a review found in TV-U12's code.
describe("bulk follow-ups (TV-U13b)", () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("a selection dropped on Focus only adds: tasks already in it are never taken out", async () => {
    const { hook, api } = await mount([task("a"), task("b")], "none", { queued: ["a", "b"] });
    await waitFor(() => expect(hook.result.current.queuedTaskIds.size).toBe(2));
    await act(async () => {
      hook.result.current.bulkQueue(["a", "b"], { mode: "add" });
      await wait(30);
    });
    expect(api.opQueueRemove).not.toHaveBeenCalled();
    expect([...hook.result.current.queuedTaskIds].sort()).toEqual(["a", "b"]);
  });

  it("adding a selection to Focus names a blocked task instead of skipping it silently", async () => {
    const relation: TaskRelation = {
      id: "r1",
      workspaceId: "w1",
      blockerTaskId: "first",
      blockedTaskId: "b",
      createdAt: "",
    };
    const { hook, api } = await mount(
      [task("a"), task("b", { title: "Ship it" }), task("first")],
      "none",
      { relations: [relation] },
    );
    await act(async () => {
      hook.result.current.bulkQueue(["a", "b"], { mode: "add" });
      await wait(40);
    });
    expect(api.opQueueAdd).toHaveBeenCalledTimes(2);
    const call = toastMock.mock.calls.find((c) => c[0] === "Added 2 tasks to Focus");
    expect(call).toBeTruthy();
    expect((call?.[1] as ToastOpts | undefined)?.description).toBe(
      "“Ship it” is blocked by an open task.",
    );
  });

  it("a task whose move saved but whose status was refused is named, and Undo moves it back", async () => {
    const { hook, rows } = await mount([task("a"), task("b", { title: "Launch post" })], "none", {
      refuseStatus: "b",
    });
    await act(async () => {
      await hook.result.current.bulkWrite(
        ["a", "b"].map((taskId) => ({ taskId, bucketId: "p2", status: "done" as const })),
        { label: (n) => `Moved ${n} tasks to p2` },
      );
    });
    // The move landed on the server before the status was refused.
    expect(rows.get("b")?.bucketId).toBe("p2");
    const call = toastMock.mock.calls.find((c) => c[0] === "1 of 2 changed");
    expect(call).toBeTruthy();
    const opts = call?.[1] as ToastOpts;
    expect(opts.description).toBe(
      "“Launch post” changed only in part: That status isn’t in this project.",
    );
    expect(opts.action?.label).toBe("Undo");
    await act(async () => {
      opts.action?.onClick();
      await wait(60);
    });
    await waitFor(() => expect(rows.get("b")?.bucketId).toBe("p1"));
    expect(rows.get("a")?.bucketId).toBe("p1");
  });

  it("Undo of a delete restores what it can, re-attaches subtasks, and names the one it couldn't", async () => {
    const { hook, rows } = await mount(
      [task("parent"), task("child", { parentId: "parent" }), task("old", { title: "Old notes" })],
      "none",
      { refuseRestore: "old" },
    );
    await act(async () => {
      await hook.result.current.bulkDelete(["parent", "old"]);
    });
    // The server promoted the unselected subtask when its parent went.
    expect(rows.get("child")?.parentId).toBeNull();
    const call = toastMock.mock.calls.find((c) => c[0] === "Deleted 2 tasks");
    expect(call).toBeTruthy();
    await act(async () => {
      (call?.[1] as ToastOpts | undefined)?.action?.onClick();
      await wait(80);
    });
    await waitFor(() => expect(rows.get("child")?.parentId).toBe("parent"));
    expect(rows.get("parent")?.deletedAt ?? null).toBeNull();
    // The restored parent shows at once, without waiting for the next sync.
    expect(hook.result.current.tasks.some((t) => t.id === "parent")).toBe(true);
    expect(toastMock.error).toHaveBeenCalledWith(
      "Couldn’t restore “Old notes”",
      expect.objectContaining({ description: "It was deleted more than 30 days ago." }),
    );
  });

  it("Undo of Waiting on keeps the entries it couldn't remove and takes the rest away", async () => {
    const { hook } = await mount([task("a"), task("b")], "none", { refuseWaitingRemove: "b" });
    await act(async () => {
      await hook.result.current.bulkWaiting(
        ["a", "b"],
        { kind: "text", label: "the printer" },
        "the printer",
        [],
      );
    });
    expect(hook.result.current.waiting.map((w) => w.taskId).sort()).toEqual(["a", "b"]);
    const call = toastMock.mock.calls.find((c) => c[0] === "2 tasks waiting on the printer");
    expect(call).toBeTruthy();
    await act(async () => {
      (call?.[1] as ToastOpts | undefined)?.action?.onClick();
      await wait(60);
    });
    await waitFor(() => expect(hook.result.current.waiting.map((w) => w.taskId)).toEqual(["b"]));
  });
});
