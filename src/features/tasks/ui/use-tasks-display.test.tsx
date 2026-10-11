// TV-U1 · U1-3, TV-U2 · U2-2/U2-3 — the Tasks page's Display wiring: Display
// and filters are remembered per workspace and scope, a task checked off in
// this scope stays (and is never "hidden" for the selection backstop), the
// Queue ignores Completed, and a Status filter asking for Done shows them.

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

  it("a deep-linked done task (and its parent) stays after the link is done with", () => {
    const tasks = [
      task("a"),
      task("p", { status: "done" }),
      task("c", { status: "done", parentId: "p" }),
    ];
    const { result, rerender } = renderHook(
      ({ linked, scope }) => useTasksDisplay("w1", scope, tasks, linked),
      { initialProps: { linked: "c" as string | null, scope: "b1" } },
    );
    expect(result.current.isHidden(tasks[2])).toBe(false);
    expect(result.current.isHidden(tasks[1])).toBe(false); // its parent too
    rerender({ linked: null, scope: "b1" });
    expect([...result.current.viewProps.stayingIds].sort()).toEqual(["c", "p"]);
    rerender({ linked: null, scope: "b2" });
    expect(result.current.isHidden(tasks[2])).toBe(true);
  });

  it("completed tasks you only browse through hide again (no deep link, nothing stays)", () => {
    const tasks = [task("open"), task("d1", { status: "done" }), task("d2", { status: "done" })];
    const { result, rerender } = renderHook(() => useTasksDisplay("w1", "b1", tasks, null));
    rerender();
    expect([...result.current.viewProps.stayingIds]).toEqual([]);
    expect(result.current.isHidden(tasks[1])).toBe(true);
  });

  it("the Queue never hides a task", () => {
    const done = task("done", { status: "done" });
    const { result } = renderHook(() => useTasksDisplay("w1", "today", [done]));
    expect(result.current.isHidden(done)).toBe(false);
  });

  it("remembers filters per scope, and a Display edit keeps them", () => {
    const { result, rerender } = renderHook(({ scope }) => useTasksDisplay("w1", scope, []), {
      initialProps: { scope: "b1" },
    });
    const high = { dimension: "priority", operator: "is" as const, values: ["high"] };
    act(() => result.current.setFilters([high]));
    act(() => result.current.setDisplay({ ...result.current.display, group: "date" }));
    expect(result.current.filters).toEqual([high]);
    expect(result.current.display.group).toBe("date");
    const stored = JSON.parse(window.localStorage.getItem("moduo:tasks:view:w1:b1") ?? "{}");
    expect(stored.filters).toEqual([high]);

    rerender({ scope: "b2" });
    expect(result.current.filters).toEqual([]);
    expect(result.current.display.group).toBe("none");
    rerender({ scope: "b1" });
    expect(result.current.filters).toEqual([high]);
  });

  it("a Status filter asking for Done shows done tasks whatever Completed says", () => {
    const done = task("done", { status: "done" });
    const { result } = renderHook(() => useTasksDisplay("w1", "b1", [done]));
    expect(result.current.isHidden(done)).toBe(true);
    act(() =>
      result.current.setFilters([{ dimension: "status", operator: "is", values: ["done"] }]),
    );
    expect(result.current.viewProps.completed).toBe("all");
    expect(result.current.isHidden(done)).toBe(false);
    // Display itself still says Hidden, for when the filter goes.
    expect(result.current.display.completed).toBe("hidden");
  });

  it("layout is per scope; a new scope starts with the old workspace-wide view", () => {
    const { result, rerender } = renderHook(
      ({ scope }) => useTasksDisplay("w1", scope, [], null, "board"),
      { initialProps: { scope: "b1" } },
    );
    expect(result.current.display.layout).toBe("board");
    act(() => result.current.setDisplay({ ...result.current.display, layout: "timeline" }));
    rerender({ scope: "b2" });
    expect(result.current.display.layout).toBe("board");
    rerender({ scope: "b1" });
    expect(result.current.display.layout).toBe("timeline");
  });

  it("All groups by project and My tasks by status until told otherwise", () => {
    const { result } = renderHook(() => useTasksDisplay("w1", "all", []));
    expect(result.current.display.group).toBe("bucket");
    const mine = renderHook(() => useTasksDisplay("w1", "mine", []));
    expect(mine.result.current.display.group).toBe("status");
  });
});
