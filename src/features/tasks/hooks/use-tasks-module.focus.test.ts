import { describe, expect, it, rs } from "@rstest/core";
import { renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { makeTask } from "../helpers";
import type { Task, TasksModuleBundle } from "../model";
import { useTasksModule } from "./use-tasks-module";

// The Focus engine's flush sink (TV-F1, F1-7): every answer it gives decides
// whether tracked seconds are kept, retried or dropped.

const WS = "ws-1";

function task(id: string, timeSpentSeconds = 0): Task {
  return {
    ...makeTask({ workspaceId: WS, bucketId: "b1", title: id, position: "a0" }),
    id,
    timeSpentSeconds,
    updatedAt: "2026-10-08T10:00:00.000Z",
  };
}

function bundleOf(
  tasks: Task[],
  truncated: TasksModuleBundle["truncated"] = [],
): TasksModuleBundle {
  return { buckets: [], tasks, tags: [], tagLinks: [], taskRelations: [], truncated };
}

function fakeRuntime(bundle: TasksModuleBundle, upsert: (t: Task) => Promise<Task>) {
  const upsertTask = rs.fn(upsert);
  const runtime = {
    tasks: {
      list: rs.fn(() => Promise.resolve(bundle)),
      getTimeBlocks: rs.fn(() => Promise.resolve({})),
      upsertTask,
      opCatchUp: rs.fn(() => Promise.resolve([])),
    },
  } as unknown as ModuoRuntime;
  return { runtime, upsertTask };
}

async function mounted(
  bundle: TasksModuleBundle,
  upsert: (t: Task) => Promise<Task> = (t) => Promise.resolve(t),
  modulePermission: "view" | "edit" = "edit",
) {
  const { runtime, upsertTask } = fakeRuntime(bundle, upsert);
  const hook = renderHook(() =>
    useTasksModule(runtime, { userId: "u1", workspaceId: WS, modulePermission }),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { hook, upsertTask };
}

const totalOf = (tasks: Task[], id: string) => tasks.find((t) => t.id === id)?.timeSpentSeconds;

describe("persistFocusTime — the focus engine's sink", () => {
  it("saves the seconds into the task's total and says so", async () => {
    const { hook, upsertTask } = await mounted(bundleOf([task("t1", 100)]));
    const result = hook.result.current.persistFocusTime("t1", 60);
    await expect(result).resolves.toBe(true);
    expect(upsertTask.mock.calls[0]?.[0].timeSpentSeconds).toBe(160);
    await waitFor(() => expect(totalOf(hook.result.current.tasks, "t1")).toBe(160));
  });

  it("reports a failed save and puts the total back", async () => {
    const { hook } = await mounted(bundleOf([task("t1", 100)]), () =>
      Promise.reject(new Error("offline")),
    );
    await expect(hook.result.current.persistFocusTime("t1", 60)).resolves.toBe(false);
    await waitFor(() => expect(totalOf(hook.result.current.tasks, "t1")).toBe(100));
  });

  it("a second save before React re-renders builds on the first, not on the stale bundle", async () => {
    const { hook, upsertTask } = await mounted(bundleOf([task("t1", 100)]));
    const persist = hook.result.current.persistFocusTime; // the same render's closure
    await persist("t1", 60);
    await persist("t1", 5);
    expect(upsertTask.mock.calls.map((c) => c[0].timeSpentSeconds)).toEqual([160, 165]);
  });

  it("says 'not now' while the bundle is loading", () => {
    const { runtime } = fakeRuntime(bundleOf([task("t1")]), (t) => Promise.resolve(t));
    const hook = renderHook(() =>
      useTasksModule(runtime, { userId: "u1", workspaceId: WS, modulePermission: "edit" }),
    );
    expect(hook.result.current.persistFocusTime("t1", 30)).toBe(false);
  });

  it("drops time only for a task that's gone from a complete bundle", async () => {
    const complete = await mounted(bundleOf([task("t1")]));
    expect(complete.hook.result.current.persistFocusTime("gone", 30)).toBe(true);
    const capped = await mounted(
      bundleOf([task("t1")], [{ scope: "tasks", shown: 1, total: 5000 }]),
    );
    // The task may just sit outside the capped read: keep the seconds.
    expect(capped.hook.result.current.persistFocusTime("elsewhere", 30)).toBe(false);
  });

  it("without edit access the save fails visibly instead of waiting forever", async () => {
    const { hook, upsertTask } = await mounted(bundleOf([task("t1")]), undefined, "view");
    await expect(hook.result.current.persistFocusTime("t1", 30)).resolves.toBe(false);
    expect(upsertTask).not.toHaveBeenCalled();
  });
});
