// TV-U15 on the real List: the seams the views built on it use — a view's
// own grouping (Upcoming's days, empty ones kept), its own keys before the
// List's, its own row date words; extra groups on top (My tasks' team block,
// "Show n more", Take it) and at the end (the Inbox's snoozed, folded); a
// scope-aware empty state and a note under the toolbar.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({
    assignees: [
      { userId: "u1", name: "Me", avatarUrl: null, isMe: true, canTakeTasks: true },
      { userId: "u2", name: "Mike", avatarUrl: null, isMe: false, canTakeTasks: true },
    ],
    currentUserId: "u1",
    byId: () => null,
  }),
  previewAssign: async () => null,
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { makeTask, type TaskGroup } from "../helpers";
import type { Task } from "../model";
import type { ListExtraGroup, ListGrouping } from "./list-extensions";
import { TaskListView } from "./task-list-view";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "p1", title: `Task ${id}`, position: id }),
    id,
    assigneeId: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

type ListProps = Partial<Parameters<typeof TaskListView>[0]>;

function renderList(tasks: Task[], extra: ListProps = {}) {
  const api = {
    loaded: true,
    tasks,
    queuedTaskIds: new Set<string>(),
    queueClaims: new Map<string, string[]>(),
    subtasksByParent: new Map<string, Task[]>(),
    subtaskProgressByTask: new Map(),
    tagsByTask: new Map(),
    blockedTaskIds: new Set<string>(),
    blockersByTask: new Map(),
    statusById: new Map(),
    statusesForBucket: () => [],
    statuses: [],
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
    patchTask: rs.fn(),
    deleteTask: rs.fn(),
    setTaskParent: rs.fn(),
    skipOccurrence: rs.fn(),
    setTaskStatus: rs.fn(),
    dropTask: rs.fn(async () => true),
  };
  function Page() {
    const [selected, setSelected] = useState<string | null>(extra.selectedTaskId ?? null);
    return (
      <TaskListView
        tasks={tasks}
        scopeTitle="View"
        selection="mine"
        view="list"
        onViewChange={() => {}}
        groupBy="none"
        buckets={[]}
        inbox={null}
        bucketNameById={() => "Work"}
        canEdit
        onRequestCapture={() => {}}
        api={api as never}
        {...extra}
        selectedTaskId={selected}
        onSelectTask={setSelected}
      />
    );
  }
  render(
    <TooltipProvider>
      <Page />
    </TooltipProvider>,
  );
  return { api };
}

const headers = () =>
  Array.from(document.querySelectorAll("[data-list-group]")).map((h) => h.textContent ?? "");

/** A two-day grouping: an empty "Thu" keeps its header. */
function days(onDrop = rs.fn()): ListGrouping {
  return {
    groups: (tasks) =>
      [
        { key: "today", label: "Today", tasks: tasks.filter((t) => t.id !== "b") },
        { key: "thu", label: "Thu", tasks: tasks.filter((t) => t.id === "b") },
        { key: "fri", label: "Fri", tasks: [] },
      ] satisfies TaskGroup[],
    keyOf: (t) => (t.id === "b" ? "thu" : "today"),
    header: (group) => ({ sub: `· ${group.tasks.length} here` }),
    accepts: () => true,
    onDrop,
    addState: () => ({ kind: "none" }),
    whenOf: (t) => `at ${t.id}`,
  };
}

describe("a view's own grouping (Upcoming's days)", () => {
  it("draws its groups in order, an empty one keeping its header and line", () => {
    renderList([task("a", { dueDate: "2026-10-14T00:00:00.000Z" }), task("b")], {
      grouping: days(),
    });
    expect(headers()).toEqual(["Today· 1 here", "Thu· 1 here", "Fri· 0 here"]);
  });

  it("words each row's date its own way, a dateless row too", () => {
    renderList([task("a", { dueDate: "2026-10-14T00:00:00.000Z" }), task("b")], {
      grouping: days(),
    });
    const row = screen.getByRole("button", { name: "Task a" }).closest('[role="row"]');
    expect(row?.textContent).toContain("at a");
    const dateless = screen.getByRole("button", { name: "Task b" }).closest('[role="row"]');
    expect(dateless?.textContent).toContain("at b");
  });

  it("asks the view's keys first, and the List's only when the view passes", () => {
    const onViewKey = rs.fn((e: { key: string }, _selected: Task | null) => e.key === "t");
    const { api } = renderList([task("a")], {
      grouping: days(),
      onViewKey: onViewKey as never,
      selectedTaskId: "a",
    });
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "t" });
    expect(onViewKey).toHaveBeenCalledTimes(1);
    expect(onViewKey.mock.calls[0]?.[1]).toMatchObject({ id: "a" });
    // Not the view's: the List's own Space (finish) still works.
    fireEvent.keyDown(grid, { key: " " });
    expect(api.toggleDone).toHaveBeenCalledTimes(1);
  });
});

describe("extra groups (My tasks' team block, the Inbox's snoozed)", () => {
  const block = (over: Partial<ListExtraGroup> = {}): ListExtraGroup => ({
    key: "team:design",
    place: "lead",
    label: "For Design",
    sub: "· 3 unclaimed",
    count: null,
    taskIds: ["t1", "t2", "t3"],
    limit: 2,
    ...over,
  });

  it("leads with the team block, its tasks in no other group, the rest behind Show n more", () => {
    renderList([task("t1"), task("t2"), task("t3"), task("mine", { status: "in_progress" })], {
      groupBy: "status",
      extraGroups: [block()],
      takeableIds: new Set(["t1", "t2", "t3"]),
      onTake: rs.fn(),
    });
    expect(headers()[0]).toBe("For Design· 3 unclaimed");
    expect(headers().slice(1)).toEqual(["In progress1"]);
    expect(screen.queryByRole("button", { name: "Task t3" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(screen.getByRole("button", { name: "Task t3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();
  });

  it("Take it on a team row takes it", () => {
    const onTake = rs.fn();
    renderList([task("t1"), task("t2")], {
      extraGroups: [block({ taskIds: ["t1", "t2"], limit: 5 })],
      takeableIds: new Set(["t1", "t2"]),
      onTake,
    });
    const row = screen.getByRole("button", { name: "Task t1" }).closest('[role="row"]');
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Take it" }));
    expect(onTake).toHaveBeenCalledWith("t1");
  });

  it("a folded group at the end keeps its rows out of sight until opened", () => {
    renderList([task("a"), task("z")], {
      extraGroups: [
        { key: "snoozed", place: "trail", label: "Snoozed", taskIds: ["z"], folded: true },
      ],
    });
    expect(headers()).toEqual(["Snoozed1"]);
    expect(screen.queryByRole("button", { name: "Task z" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Snoozed/ }));
    expect(screen.getByRole("button", { name: "Task z" })).toBeTruthy();
  });
});

describe("states", () => {
  it("an empty view says what the view gave it, with its note under the toolbar", () => {
    renderList([], {
      emptyState: <p>Inbox is clear</p>,
      note: "Only you see your Inbox.",
    });
    expect(screen.getByText("Inbox is clear")).toBeTruthy();
    expect(screen.getByText("Only you see your Inbox.")).toBeTruthy();
  });
});
