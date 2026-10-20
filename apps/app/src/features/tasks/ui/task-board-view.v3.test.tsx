// TV-U11 on the real Board (AC4.2, AC7.1, AC7.4, AC11.6): a project's own
// statuses with the folded Backlog button (a click unfolds it; it is no drop
// target), empty people hidden behind "n hidden · Show", lanes that fold,
// the Description preview, the "+" with the column's value, and the keys
// (⌥⇧→ moves a card a column through `dropTask`, `c` adds into its column).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

const PEOPLE = {
  u1: {
    userId: "u1",
    name: "You",
    fullName: "Alex Rivera",
    avatarUrl: null,
    isMe: true,
    canTakeTasks: true,
  },
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

import { TooltipProvider } from "../../../components/ui/tooltip";
import { readFolds, resetFoldsForTests } from "../folds";
import { makeTask } from "../helpers";
import type { Bucket, ProjectStatus, Task } from "../model";
import { renderWithTasks } from "../testing/render-with-tasks";
import { TaskBoardView } from "./task-board-view";

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
  resetFoldsForTests();
});

const STAMP = "2026-10-01T00:00:00.000Z";
const status = (
  id: string,
  category: ProjectStatus["category"],
  name: string,
  position = 0,
): ProjectStatus => ({
  id,
  workspaceId: "w",
  projectId: "p1",
  category,
  name,
  position,
  hidden: false,
  createdAt: STAMP,
  updatedAt: STAMP,
});
const STATUSES = [
  status("s-backlog", "backlog", "Backlog"),
  status("s-todo", "todo", "Todo"),
  status("s-doing", "in_progress", "In progress", 0),
  status("s-review", "in_progress", "In review", 1),
  status("s-done", "done", "Done"),
];
const PROJECT: Bucket = {
  id: "p1",
  workspaceId: "w",
  ownerId: "u1",
  name: "Website",
  isSystem: false,
  group: null,
  position: "a",
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt: null,
};

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "p1", title: `Task ${id}`, position: id }),
    id,
    assigneeId: null,
    statusId: "s-todo",
    statusCategory: "todo",
    updatedAt: STAMP,
    ...over,
  };
}

/** The Board over a store holding the project, its statuses and these tasks (A4). */
async function renderBoard(tasks: Task[], extra: Record<string, unknown> = {}) {
  // The writes are spies: the keys' move is asserted through dropTask.
  const api = {
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
    patchTask: rs.fn(),
    deleteTask: rs.fn(),
    setTaskParent: rs.fn(),
    skipOccurrence: rs.fn(),
    setTaskStatus: rs.fn(),
    dropTask: rs.fn(async () => true),
    createSection: rs.fn(),
  };
  const onRequestCapture = rs.fn();
  const onSelectTask = rs.fn();
  await renderWithTasks(
    <TooltipProvider>
      <TaskBoardView
        tasks={tasks}
        scopeTitle="Website"
        selection="p1"
        view="board"
        onViewChange={() => {}}
        boardGroupBy="status"
        buckets={[PROJECT]}
        inbox={null}
        bucketNameById={() => "Website"}
        canEdit
        onRequestCapture={onRequestCapture}
        selectedTaskId={null}
        onSelectTask={onSelectTask}
        foldKey="moduo:tasks:folds:test"
        {...extra}
      />
    </TooltipProvider>,
    {
      seed: { buckets: [PROJECT], statuses: STATUSES, tasks },
      workspaceId: "w",
      commands: api,
    },
  );
  return { api, onRequestCapture, onSelectTask };
}

const columnNames = () =>
  [...document.querySelectorAll<HTMLElement>("section[data-board-column]")].map(
    (s) => s.dataset.boardColumn,
  );

describe("Board v3 (TV-U11)", () => {
  it("a project's own statuses; Backlog is the folded button, which unfolds and takes no drop", async () => {
    await renderBoard([task("a"), task("b", { statusId: "s-backlog", statusCategory: "backlog" })]);
    expect(columnNames()).toEqual(["Todo", "In progress", "In review", "Done"]);
    const backlog = screen.getByRole("button", { name: "Backlog, 1 task, unfold" });
    // Never a drop target: no droppable section around it, no rotated text.
    expect(backlog.closest("section")).toBeNull();
    expect(backlog.textContent).not.toContain("Backlog");
    fireEvent.click(backlog);
    expect(columnNames()).toEqual(["Backlog", "Todo", "In progress", "In review", "Done"]);
    // Remembered for the person (key per scope and grouping, TV-U8).
    expect(readFolds("moduo:tasks:folds:test")["col:status:s-backlog"]).toBe(false);
  });

  it("a status's ⋯ folds it into the button", async () => {
    await renderBoard([task("a")]);
    fireEvent.pointerDown(screen.getByRole("button", { name: "In review options" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Fold" }));
    expect(columnNames()).not.toContain("In review");
    expect(screen.getByRole("button", { name: "In review, 0 tasks, unfold" })).toBeTruthy();
  });

  it('a column\'s "+" adds with its value; In review carries its own status', async () => {
    const { onRequestCapture } = await renderBoard([task("a")]);
    fireEvent.click(screen.getByRole("button", { name: "Add a task to In review" }));
    expect(onRequestCapture).toHaveBeenCalledWith({
      projectId: "p1",
      seed: { status: "in_progress", statusId: "s-review", statusName: "In review" },
    });
    expect(screen.queryByRole("button", { name: "Add a task to Done" })).toBeNull();
  });

  it("empty people hide behind “n hidden · Show” (default o)", async () => {
    await renderBoard([task("a", { assigneeId: "u2" })], { boardGroupBy: "assignee" });
    expect(columnNames()).toEqual(["Mike"]);
    fireEvent.click(screen.getByRole("button", { name: "2 hidden · Show" }));
    expect(columnNames()).toEqual(["You", "Mike", "Unassigned"]);
  });

  it("your column reads You, and its buttons say you (MOD-137)", async () => {
    await renderBoard([task("a", { assigneeId: "u1" })], { boardGroupBy: "assignee" });
    expect(columnNames()).toContain("You");
    expect(screen.getByRole("button", { name: "Add a task to you" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Your column options" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a task to You" })).toBeNull();
  });

  it("lanes: one header per lane with cards, each folds (call 85)", async () => {
    await renderBoard([task("a", { priority: "high" }), task("b")], { lanes: "priority" });
    const lanes = [...document.querySelectorAll<HTMLElement>("[data-board-lane-key]")].map(
      (l) => l.dataset.boardLaneKey,
    );
    expect(lanes).toEqual(["high", "unset"]);
    const high = document.querySelector('[data-board-lane-key="high"]') as HTMLElement;
    expect(within(high).getByText("Task a")).toBeTruthy();
    fireEvent.click(within(high).getByRole("button", { expanded: true }));
    expect(screen.queryByText("Task a")).toBeNull();
  });

  it("Display → Description: Preview shows the words, never the markup (AC7.4)", async () => {
    const t = task("a", { description: "<p>Check the <b>empty</b> states</p>" });
    await renderBoard([t]);
    expect(document.querySelector('[data-slot="card-description"]')).toBeNull();
    cleanup();
    await renderBoard([t], { description: true });
    expect(document.querySelector('[data-slot="card-description"]')?.textContent).toBe(
      "Check the empty states",
    );
  });

  it("⌥⇧→ moves the selected card to the next column, through dropTask; `c` adds into its column", async () => {
    const { api, onRequestCapture } = await renderBoard([task("a")], { selectedTaskId: "a" });
    const board = screen.getByRole("grid", { name: "Website board" });
    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(api.dropTask).toHaveBeenCalledWith(
      { taskId: "a", status: "in_progress", statusId: "s-doing" },
      "Moved to In progress",
    );
    fireEvent.keyDown(board, { key: "c" });
    expect(onRequestCapture).toHaveBeenCalledWith({
      projectId: "p1",
      seed: { status: "todo" },
    });
  });
});

// MOD-161 — a sideways swipe that runs out at the Board's end stays in the
// Board: its scroller contains the overscroll (the columns and the lanes
// layout alike), so it never chains to the centre panel or the window, which
// the desktop app's WebKit view would rubber-band. Measured live with a
// sideways wheel: the Board scrolls to its end and the document never moves.
describe("the Board's sideways scroll (MOD-161)", () => {
  it("is contained in the columns' scroller", async () => {
    await renderBoard([task("a")]);
    const scroller = document.querySelector("section[data-board-column]")?.parentElement;
    expect(scroller?.className).toMatch(/\boverflow-x-auto\b/);
    expect(scroller?.className).toMatch(/\boverscroll-x-contain\b/);
  });

  it("is contained in the lanes' scroller", async () => {
    await renderBoard([task("a", { priority: "high" })], { lanes: "priority" });
    const lane = document.querySelector("[data-board-lane-key]") as HTMLElement;
    expect(lane.closest(".overflow-auto")?.className).toMatch(/\boverscroll-x-contain\b/);
  });
});
