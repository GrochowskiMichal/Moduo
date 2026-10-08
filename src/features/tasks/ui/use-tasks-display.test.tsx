// TV-U1 · U1-3 — the Tasks page's Display wiring: Completed is remembered per
// workspace and scope, a task checked off in this scope stays (and is never
// "hidden" for the selection backstop), and the Queue ignores Completed.

import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import { makeTask } from "../helpers";
import type { Task } from "../model";
import { useTasksDisplay } from "./use-tasks-display";

const OLD = "2026-01-01T00:00:00.000Z";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    updatedAt: OLD,
    ...over,
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("useTasksDisplay", () => {
  it("defaults to completed hidden, and the backstop treats old done tasks as hidden", () => {
    const tasks = [task("open"), task("done", { status: "done" })];
    const { result } = renderHook(() => useTasksDisplay("w1", "b1", tasks));
    expect(result.current.display.completed).toBe("hidden");
    expect(result.current.viewProps.completed).toBe("hidden");
    expect(result.current.isHidden(tasks[0])).toBe(false);
    expect(result.current.isHidden(tasks[1])).toBe(true);
  });

  it("remembers Completed per scope", () => {
    const tasks = [task("done", { status: "done" })];
    const { result, rerender } = renderHook(({ scope }) => useTasksDisplay("w1", scope, tasks), {
      initialProps: { scope: "b1" },
    });
    act(() => result.current.setDisplay({ ...result.current.display, completed: "all" }));
    expect(result.current.viewProps.completed).toBe("all");
    expect(result.current.isHidden(tasks[0])).toBe(false);
    expect(window.localStorage.getItem("moduo:tasks:view:w1:b1")).toContain('"all"');

    rerender({ scope: "b2" });
    expect(result.current.viewProps.completed).toBe("hidden");
    rerender({ scope: "b1" });
    expect(result.current.viewProps.completed).toBe("all");
  });

  it("a task checked off in this scope stays shown until the scope changes", () => {
    const { result, rerender } = renderHook(
      ({ tasks, scope }) => useTasksDisplay("w1", scope, tasks),
      { initialProps: { tasks: [task("a")], scope: "b1" } },
    );
    const done = [task("a", { status: "done" })];
    rerender({ tasks: done, scope: "b1" });
    expect([...result.current.viewProps.stayingIds]).toEqual(["a"]);
    expect(result.current.isHidden(done[0])).toBe(false);

    rerender({ tasks: done, scope: "b2" });
    expect(result.current.isHidden(done[0])).toBe(true);
  });

  it("a done task opened here (deep link, selection) stays after the selection moves on", () => {
    const tasks = [
      task("a"),
      task("p", { status: "done" }),
      task("c", { status: "done", parentId: "p" }),
    ];
    const { result, rerender } = renderHook(
      ({ selected, scope }) => useTasksDisplay("w1", scope, tasks, selected),
      { initialProps: { selected: "c" as string | null, scope: "b1" } },
    );
    expect(result.current.isHidden(tasks[2])).toBe(false);
    expect(result.current.isHidden(tasks[1])).toBe(false); // its parent too
    rerender({ selected: "a", scope: "b1" });
    expect([...result.current.viewProps.stayingIds].sort()).toEqual(["a", "c", "p"]);
    rerender({ selected: null, scope: "b2" });
    expect(result.current.isHidden(tasks[2])).toBe(true);
  });

  it("the Queue never hides a task", () => {
    const done = task("done", { status: "done" });
    const { result } = renderHook(() => useTasksDisplay("w1", "today", [done]));
    expect(result.current.isHidden(done)).toBe(false);
  });
});
