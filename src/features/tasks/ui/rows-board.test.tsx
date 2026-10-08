// TV-U1 on the real List and Board: the row anatomy and its fixed columns
// (U1-1), tags as a count (U1-2), done rows and hidden completed tasks
// (U1-3), and board columns and cards (U1-4).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";

const PEOPLE = {
  u1: { userId: "u1", name: "Me", avatarUrl: null, isMe: true, canTakeTasks: true },
  u2: { userId: "u2", name: "Mike", avatarUrl: null, isMe: false, canTakeTasks: true },
} as const;

rs.mock("../assignees", () => ({
  useAssignees: () => ({
    assignees: Object.values(PEOPLE),
    currentUserId: "u1",
    byId: (id: string | null) => (id ? (PEOPLE[id as keyof typeof PEOPLE] ?? null) : null),
  }),
  previewAssign: async () => null,
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

import { SELECTED_OPTION } from "../../../components/ui/selection";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { useJustCompleted } from "../completed";
import { makeTask } from "../helpers";
import type { Task } from "../model";
import { TaskBoardView } from "./task-board-view";
import { TaskListView } from "./task-list-view";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const OLD = "2026-01-01T00:00:00.000Z";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "b1", title: `Task ${id}`, position: id }),
    id,
    assigneeId: null,
    updatedAt: OLD,
    ...over,
  };
}

function viewApi(tasks: Task[], extra: Record<string, unknown> = {}) {
  return {
    tasks,
    queuedTaskIds: new Set<string>(),
    queueClaims: new Map<string, string[]>(),
    subtasksByParent: new Map<string, Task[]>(),
    subtaskProgressByTask: new Map(),
    tagsByTask: new Map(),
    blockedTaskIds: new Set<string>(),
    blockersByTask: new Map(),
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
    patchTask: rs.fn(),
    deleteTask: rs.fn(),
    setTaskParent: rs.fn(),
    skipOccurrence: rs.fn(),
    ...extra,
  };
}

type ListExtra = Partial<Parameters<typeof TaskListView>[0]>;

function renderList(tasks: Task[], extra: ListExtra = {}, apiExtra: Record<string, unknown> = {}) {
  const api = viewApi(tasks, apiExtra);
  render(
    <TooltipProvider>
      <TaskListView
        tasks={tasks}
        scopeTitle="Work"
        selection="b1"
        view="list"
        onViewChange={() => {}}
        groupBy="none"
        onGroupByChange={() => {}}
        buckets={[]}
        inbox={null}
        bucketNameById={() => "Work"}
        canEdit
        onRequestCapture={() => {}}
        selectedTaskId={null}
        onSelectTask={() => {}}
        api={api as never}
        {...extra}
      />
    </TooltipProvider>,
  );
  return api;
}

const rowOf = (title: string) =>
  screen.getByRole("button", { name: title }).closest('[role="row"]') as HTMLElement;
const cols = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>("[data-col]")].map((el) => el.dataset.col);

describe("Row anatomy (U1-1, U1-2)", () => {
  it("every row carries the same fixed columns, in order, so they line up", () => {
    renderList([
      task("a", { priority: "high", dueDate: "2026-10-20T00:00:00.000Z", assigneeId: "u2" }),
      task("b"),
    ]);
    expect(cols(rowOf("Task a"))).toEqual(["priority", "date", "assignee", "queue"]);
    // An empty row still holds every cell.
    expect(cols(rowOf("Task b"))).toEqual(["priority", "date", "assignee", "queue"]);
  });

  it("collapses a column that's empty on every row", () => {
    renderList([task("a"), task("b")]);
    expect(cols(rowOf("Task a"))).toEqual(["queue"]);
  });

  it("energy stays off on rows until Display turns it on", () => {
    const rows = [task("a", { energyLevel: "high" })];
    renderList(rows);
    expect(cols(rowOf("Task a"))).not.toContain("energy");
    cleanup();
    renderList(rows, { properties: ["priority", "energy", "date", "assignee"] });
    expect(cols(rowOf("Task a"))).toContain("energy");
    expect(screen.getByLabelText("High energy")).toBeTruthy();
  });

  it("priority is a fixed three-bar glyph read by fill (ghost bars stay)", () => {
    renderList([task("a", { priority: "medium" })]);
    const svg = screen.getByLabelText("Medium priority").querySelector("svg") as SVGElement;
    expect(svg.querySelectorAll("rect")).toHaveLength(3);
    expect(svg.getAttribute("data-level")).toBe("2");
    expect([...svg.querySelectorAll("rect")].map((r) => r.getAttribute("class"))).toEqual([
      null,
      null,
      "opacity-25",
    ]);
  });

  it("tags show as a quiet `# N` count after the title, never as chips", () => {
    const tags = [
      { id: "t1", name: "ui" },
      { id: "t2", name: "notes" },
      { id: "t3", name: "bug" },
    ];
    renderList([task("a")], {}, { tagsByTask: new Map([["a", tags]]) });
    const row = rowOf("Task a");
    expect(screen.getByText("3 tags").className).toContain("sr-only");
    expect(row.textContent).not.toContain("ui");
    expect(row.querySelector('[data-slot="tag-chip"], .tag-chip')).toBeNull();
    // The count sits in the title cell, right after the title.
    const title = row.querySelector('[data-slot="row-title"]') as HTMLElement;
    expect(title.querySelector('[data-slot="meta-counts"]')).not.toBeNull();
  });

  it("counts subtasks as done/total and marks blocked and repeating tasks", () => {
    renderList(
      [task("a", { recurrence: { rrule: "FREQ=DAILY", dtstart: null, nextOccurrence: null } })],
      {},
      {
        subtaskProgressByTask: new Map([["a", { done: 1, total: 3 }]]),
        blockedTaskIds: new Set(["a"]),
        blockersByTask: new Map([["a", [task("z", { title: "Spec" })]]]),
      },
    );
    const row = rowOf("Task a");
    expect(row.textContent).toContain("1/3");
    expect(screen.getByText("1 of 3 subtasks done")).toBeTruthy();
    expect(screen.getByLabelText("Blocked by “Spec”")).toBeTruthy();
    expect(screen.getByLabelText("Repeats")).toBeTruthy();
  });

  it("in a cross-bucket flat view the bucket is dot + name text, not a pill", () => {
    renderList([task("a")], { selection: "all" });
    const bucket = screen.getByRole("button", { name: "Bucket: Work" });
    expect(bucket.textContent).toBe("Work");
    expect(bucket.querySelector('[data-slot="badge"]')).toBeNull();
    expect(bucket.querySelector('[data-slot="nav-row-dot"]')).not.toBeNull();
  });

  it("the queue toggle hides until hover, focus or selection, unless queued or claimed", () => {
    renderList(
      [task("a"), task("b"), task("c")],
      {},
      {
        queuedTaskIds: new Set(["b"]),
        queueClaims: new Map([["c", ["u2"]]]),
      },
    );
    const toggle = (title: string) =>
      rowOf(title).querySelector('[data-col="queue"] button') as HTMLElement;
    expect(toggle("Task a").className).toContain("opacity-0");
    expect(toggle("Task a").className).toContain("group-hover:opacity-100");
    expect(toggle("Task a").className).toContain("group-aria-selected:opacity-100");
    expect(toggle("Task b").className).not.toContain("opacity-0");
    expect(toggle("Task c").className).not.toContain("opacity-0");
  });

  it("the date cell is named by its dates", () => {
    renderList([task("a", { dueDate: "2026-10-20T00:00:00.000Z" })]);
    const cell = rowOf("Task a").querySelector('[data-col="date"]') as HTMLElement;
    expect(cell.getAttribute("aria-label")).toMatch(/^Due \S+ \d+, 2026$/);
  });
});

describe("Done and completed (U1-3)", () => {
  const tasks = () => [
    task("open"),
    task("old-done", { status: "done" }),
    task("new-done", { status: "done", updatedAt: new Date().toISOString() }),
  ];

  it('hides completed tasks by default behind "N completed · show"', () => {
    renderList(tasks());
    expect(screen.getAllByRole("row")).toHaveLength(1);
    const line = screen.getByRole("button", { name: "2 completed, show" });
    expect(line.textContent).toBe("2 completed · show");

    fireEvent.click(line);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "2 completed, hide" })).toBeTruthy();
  });

  it('"7 days" lists the recent ones; "All" lists every one', () => {
    renderList(tasks(), { completed: "week" });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "1 completed, show" })).toBeTruthy();
    cleanup();
    renderList(tasks(), { completed: "all" });
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /completed/ })).toBeNull();
  });

  it("a task just checked off stays listed, struck through", () => {
    renderList(tasks(), { justCompletedIds: new Set(["old-done"]) });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    const row = rowOf("Task old-done");
    expect(screen.getByRole("button", { name: "Task old-done" }).className).toContain(
      "line-through",
    );
    expect(row.dataset.done).toBe("true");
  });

  it("a selected or deep-linked completed task stays listed (no fallback to another task)", () => {
    const onSelectTask = rs.fn();
    renderList([task("a"), task("b", { status: "done" })], {
      selectedTaskId: "b",
      onSelectTask,
      revealRequest: { id: "b", seq: 1 },
    });
    expect(rowOf("Task b")).toBeTruthy();
    expect(onSelectTask).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /completed/ })).toBeNull();
  });

  it("a done row dims as a whole except its checkbox", () => {
    renderList(tasks(), { completed: "all" });
    const row = rowOf("Task old-done");
    const title = row.querySelector('[data-slot="row-title"]') as HTMLElement;
    const columns = row.querySelector('[data-slot="row-columns"]') as HTMLElement;
    expect(title.className).toContain("opacity-40");
    expect(columns.className).toContain("opacity-40");
    // Dimmed once, by opacity: the title keeps its colour (the comp).
    expect(screen.getByRole("button", { name: "Task old-done" }).className).not.toContain(
      "text-muted-foreground",
    );
    expect(row.className).not.toContain("opacity-40");
    const check = within(row).getByRole("button", { name: "Mark as not done" });
    expect(title.contains(check) || columns.contains(check)).toBe(false);
  });

  it("a done parent with open subtasks stays, so they aren't hidden with it", () => {
    const parent = task("p", { status: "done" });
    const child = task("c", { parentId: "p" });
    renderList([parent, child], {}, { subtasksByParent: new Map([["p", [child]]]) });
    expect(rowOf("Task p")).toBeTruthy();
  });

  it("the Queue ignores Completed (TV-D4 keeps a checked-off task until reload)", () => {
    renderList(tasks(), { selection: "today", reorderable: false });
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});

describe("useJustCompleted", () => {
  it("keeps a task checked off in this scope, and forgets on a scope change", () => {
    const open = [task("a")];
    const done = [task("a", { status: "done" })];
    const { result, rerender } = renderHook(({ tasks, scope }) => useJustCompleted(tasks, scope), {
      initialProps: { tasks: open, scope: "inbox" },
    });
    expect([...result.current]).toEqual([]);
    rerender({ tasks: done, scope: "inbox" });
    expect([...result.current]).toEqual(["a"]);
    rerender({ tasks: done, scope: "b2" });
    expect([...result.current]).toEqual([]);
  });
});

describe("Board (U1-4)", () => {
  function renderBoard(tasks: Task[], extra: Record<string, unknown> = {}) {
    const api = viewApi(tasks);
    render(
      <TooltipProvider>
        <TaskBoardView
          tasks={tasks}
          scopeTitle="Work"
          selection="b1"
          view="board"
          onViewChange={() => {}}
          boardGroupBy="status"
          onBoardGroupByChange={() => {}}
          buckets={[]}
          inbox={null}
          bucketNameById={() => "Work"}
          canEdit
          onRequestCapture={() => {}}
          selectedTaskId="a"
          onSelectTask={() => {}}
          api={api as never}
          {...extra}
        />
      </TooltipProvider>,
    );
  }
  const card = (title: string) => screen.getByText(title).closest("[data-task-id]") as HTMLElement;

  it("columns flex between 280 and 400 px", () => {
    renderBoard([task("a")]);
    const column = card("Task a").closest("section") as HTMLElement;
    expect(column.className).toContain("min-w-70");
    expect(column.className).toContain("max-w-100");
    expect(column.className).toContain("flex-1");
  });

  it("a card has one quiet meta line, and selection is the tint", () => {
    renderBoard([
      task("a", {
        priority: "high",
        dueDate: "2026-10-20T00:00:00.000Z",
        assigneeId: "u2",
      }),
    ]);
    const el = card("Task a");
    for (const cls of SELECTED_OPTION.split(" ")) expect(el.className).toContain(cls);
    const meta = el.querySelector(".whitespace-nowrap") as HTMLElement;
    expect(meta).not.toBeNull();
    expect(meta.contains(screen.getByLabelText("High priority"))).toBe(true);
    expect(meta.contains(screen.getByLabelText("Assignee: Mike"))).toBe(true);
  });

  it("done cards fade, and completed cards hide behind each column's line", () => {
    renderBoard([task("a"), task("d", { status: "done" })]);
    expect(screen.queryByText("Task d")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 completed, show" }));
    expect(card("Task d").className).toContain("opacity-50");
    act(() => {});
  });

  it("keeps the selected card even when Display hides completed ones", () => {
    renderBoard([task("a"), task("d", { status: "done" })], { selectedTaskId: "d" });
    expect(card("Task d")).toBeTruthy();
  });

  it("a card with nothing to show has no empty meta line", () => {
    renderBoard([task("d", { status: "done" })], { completed: "all", canEdit: false });
    expect(card("Task d").querySelector(".whitespace-nowrap")).toBeNull();
  });
});
