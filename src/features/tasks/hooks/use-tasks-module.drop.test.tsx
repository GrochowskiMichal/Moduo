// TV-U4 — a drop (`dropTask`): its writes go one after another (the
// field-level write, then the status op, then the assign op: #329's "two
// concurrent writes"); every subtask follows a project move, Won't do ones too,
// once (#329's archived subtasks, and its double write); the Undo toast shows
// only once the drop saved (#329's "Moved to X" on a failed move); Undo puts
// the fields back and never overwrites a newer change.

import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import type { Bucket, Task, TasksModuleBundle } from "../model";

type ToastOpts = { action?: { label: string; onClick: () => void } };
const toastMock = rs.hoisted(() => {
  let n = 0;
  const fn = rs.fn((..._args: unknown[]) => `toast-${++n}`);
  return Object.assign(fn, { dismiss: rs.fn(), error: rs.fn(), message: rs.fn() });
});
rs.mock("sonner", () => ({ toast: toastMock }));

// Live updates (TV-D5) need a socket; these tests drive the hook without one.
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

function task(id: string, position: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position }),
    id,
    creatorId: "u1",
    assigneeId: "u1",
    ...over,
  };
}

function fakeRuntime(tasks: Task[], opts: { failStatus?: boolean } = {}) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  const bundle = (): TasksModuleBundle => ({
    buckets: [bucket("inbox", { isSystem: true, name: "Inbox" }), bucket("p1"), bucket("p2")],
    tasks: [...rows.values()],
    tags: [],
    tagLinks: [],
    taskRelations: [],
    truncated: [],
  });
  const order: string[] = [];
  let inFlight = 0;
  let overlapped = false;
  // Each write takes a tick, so two at once would overlap.
  const write = async (label: string, id: string, patch: Partial<Task>) => {
    inFlight += 1;
    if (inFlight > 1) overlapped = true;
    order.push(label);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
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
      write(`update:${taskId}`, taskId, patch),
    ),
    opSetStatus: rs.fn(
      async ({
        taskId,
        status,
        position,
      }: {
        taskId: string;
        status: Task["status"];
        position?: string;
      }) => {
        if (opts.failStatus) throw new Error("You can't change this task.");
        return write(`status:${taskId}`, taskId, position ? { status, position } : { status });
      },
    ),
    opAssign: rs.fn(({ taskId, assigneeId }: { taskId: string; assigneeId: string | null }) =>
      write(`assign:${taskId}`, taskId, { assigneeId }),
    ),
  };
  return {
    runtime: { tasks: api } as unknown as ModuoRuntime,
    api,
    rows,
    order,
    overlapped: () => overlapped,
  };
}

async function mount(tasks: Task[], opts: { failStatus?: boolean } = {}) {
  toastMock.mockClear();
  toastMock.error.mockClear();
  const fake = fakeRuntime(tasks, opts);
  const hook = renderHook(() =>
    useTasksModule(fake.runtime, { userId: "u1", workspaceId: "w1", modulePermission: "edit" }),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...fake, hook };
}

/** The Undo toast's options for `label`, failing when there's none. */
function undoFor(label: string): ToastOpts {
  const call = toastMock.mock.calls.find((c) => c[0] === label);
  if (!call) throw new Error(`no "${label}" toast`);
  return call[1] as ToastOpts;
}

describe("dropTask — one drop, its writes in order, one Undo", () => {
  it("sends the parent change, then the status (with the place), then the assignee — never at once", async () => {
    const { hook, order, overlapped, api } = await mount([
      task("p", "0000000010"),
      task("t", "0000000020"),
    ]);
    let saved: boolean | undefined;
    await act(async () => {
      saved = await hook.result.current.dropTask(
        { taskId: "t", parentId: "p", position: "0000000015", status: "done", assigneeId: null },
        "Moved to Done",
      );
    });
    expect(saved).toBe(true);
    expect(order).toEqual(["update:t", "status:t", "assign:t"]);
    expect(overlapped()).toBe(false);
    // The place rides with the status op, not the field write.
    expect(api.updateTask.mock.calls[0][0].patch).toEqual({ parentId: "p" });
    expect(api.opSetStatus.mock.calls[0][0]).toMatchObject({
      status: "done",
      position: "0000000015",
    });
    expect(undoFor("Moved to Done").action?.label).toBe("Undo");
  });

  it("a project move brings every subtask once — Won't do and done ones too — to the project's end", async () => {
    const { hook, api } = await mount([
      task("parent", "0000000010"),
      task("open", "0000000020", { parentId: "parent" }),
      task("wont", "0000000030", { parentId: "parent", status: "archived" }),
      task("done", "0000000040", { parentId: "parent", status: "done" }),
      task("x", "0000000050", { bucketId: "p2" }),
      task("y", "0000000060"),
    ]);
    await act(async () => {
      await hook.result.current.dropTask({ taskId: "parent", bucketId: "p2" }, "Moved to p2");
    });
    const calls = api.updateTask.mock.calls.map((c) => c[0]);
    // One write per row: no second write for a subtask (#329's double write).
    expect(calls.map((c) => c.taskId).sort()).toEqual(["done", "open", "parent", "wont"]);
    for (const c of calls.filter((c) => c.taskId !== "parent")) {
      expect(c.patch).toEqual({ bucketId: "p2" });
    }
    const parent = calls.find((c) => c.taskId === "parent");
    // After p2's last task (x), before what follows it (y).
    expect(parent?.patch.bucketId).toBe("p2");
    const pos = parent?.patch.position as string;
    expect(pos > "0000000050" && pos < "0000000060").toBe(true);
  });

  it("a failed drop says so and offers no Undo (#329's toast on a failed move)", async () => {
    const { hook } = await mount([task("t", "0000000010")], { failStatus: true });
    let saved: boolean | undefined;
    await act(async () => {
      saved = await hook.result.current.dropTask(
        { taskId: "t", status: "in_progress" },
        "Moved to In progress",
      );
    });
    expect(saved).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith("You can't change this task.");
    expect(toastMock.mock.calls.some((c) => c[0] === "Moved to In progress")).toBe(false);
  });

  it("Undo puts back what the drop changed", async () => {
    const { hook, rows } = await mount([task("t", "0000000010", { priority: null })]);
    await act(async () => {
      await hook.result.current.dropTask(
        { taskId: "t", priority: "high", position: "0000000099" },
        "Set to High priority",
      );
    });
    expect(rows.get("t")).toMatchObject({ priority: "high", position: "0000000099" });
    act(() => undoFor("Set to High priority").action?.onClick());
    await waitFor(() =>
      expect(rows.get("t")).toMatchObject({ priority: null, position: "0000000010" }),
    );
  });

  it("Undo never overwrites a newer change, and says so", async () => {
    const { hook, rows, api } = await mount([task("t", "0000000010")]);
    await act(async () => {
      await hook.result.current.dropTask(
        { taskId: "t", status: "in_progress", position: "0000000099" },
        "Moved to In progress",
      );
    });
    // Someone finishes it meanwhile (here: another edit through the hook).
    await act(async () => {
      await hook.result.current.dropTask({ taskId: "t", status: "done" }, "Moved to Done");
    });
    api.opSetStatus.mockClear();
    act(() => undoFor("Moved to In progress").action?.onClick());
    // The place goes back; the newer status stays.
    await waitFor(() => expect(rows.get("t")?.position).toBe("0000000010"));
    expect(rows.get("t")?.status).toBe("done");
    expect(api.opSetStatus).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toastMock.mock.calls.some((c) => c[0] === "Undo kept a newer change to “t”.")).toBe(
        true,
      ),
    );
  });
});
