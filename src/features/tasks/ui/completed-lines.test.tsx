// MOD-148 on the real List and Board: while Display → Completed is Hidden,
// no group or column ends with its own "N completed · show" line (the
// dogfood project showed 11 lines for two open tasks). One quiet
// "N completed · Show" line ends the whole view, counts every completed task
// Display hides there, and shows them in place, in their groups, until
// "Hide" (or the scope, grouping or Completed changes). It never saves
// Display. "7 days" keeps each group's line for the older ones; Backlog keeps
// its folded line per group; a section that shows nothing keeps its header.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import type { CompletedMode } from "../completed";
import { resetFoldsForTests } from "../folds";
import { makeTask } from "../helpers";
import type { Bucket, ProjectStatus, Section, Task } from "../model";
import type { ListGrouping } from "./list-extensions";
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
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetFoldsForTests();
});

const OLD = "2026-01-01T00:00:00.000Z";

function section(id: string, name: string, position: number): Section {
  return {
    id,
    workspaceId: "w",
    projectId: "p1",
    name,
    position,
    startsOn: null,
    endsOn: null,
    createdAt: OLD,
    updatedAt: OLD,
  };
}
const SECTIONS = [
  section("s1", "Triage", 1),
  section("s2", "Visual", 2),
  section("s3", "Later", 3),
];
const PROJECT: Bucket = {
  id: "p1",
  workspaceId: "w",
  ownerId: "u1",
  name: "Dogfood",
  isSystem: false,
  group: null,
  position: "a",
  createdAt: OLD,
  updatedAt: OLD,
  deletedAt: null,
};

const STATUSES: ProjectStatus[] = (
  [
    ["st-backlog", "backlog", "Backlog"],
    ["st-todo", "todo", "Todo"],
    ["st-doing", "in_progress", "In progress"],
    ["st-done", "done", "Done"],
  ] as const
).map(([id, category, name]) => ({
  id,
  workspaceId: "w",
  projectId: "p1",
  category,
  name,
  position: 0,
  hidden: false,
  createdAt: OLD,
  updatedAt: OLD,
}));

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "p1", title: `Task ${id}`, position: id }),
    id,
    assigneeId: null,
    statusId: "st-todo",
    statusCategory: "todo",
    updatedAt: OLD,
    ...over,
  };
}
const done = (id: string, over: Partial<Task> = {}) =>
  task(id, { status: "done", statusId: "st-done", statusCategory: "done", ...over });

/** The dogfood project, small: two open tasks, done work in No section,
 *  Triage and Visual (only done work there), a Backlog task in Triage, and
 *  Later with no tasks at all (the List draws no group for it; the Board
 *  keeps its column). */
const DOGFOOD = [
  task("a"),
  done("d1"),
  task("b", { sectionId: "s1" }),
  done("d2", { sectionId: "s1" }),
  done("d3", { sectionId: "s1" }),
  task("x", { sectionId: "s1", statusId: "st-backlog", statusCategory: "backlog" }),
  done("d4", { sectionId: "s2" }),
  done("d5", { sectionId: "s2" }),
  // Done today: "7 days" lists it.
  done("d6", { sectionId: "s2", updatedAt: new Date().toISOString() }),
];

function apiOf(tasks: Task[]) {
  return {
    loaded: true,
    tasks,
    queuedTaskIds: new Set<string>(),
    queueClaims: new Map<string, string[]>(),
    subtasksByParent: new Map<string, Task[]>(),
    subtaskProgressByTask: new Map(),
    tagsByTask: new Map(),
    blockedTaskIds: new Set<string>(),
    blockersByTask: new Map(),
    statuses: STATUSES,
    statusById: new Map(STATUSES.map((s) => [s.id, s])),
    statusesForBucket: () => STATUSES,
    sections: SECTIONS,
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
    patchTask: rs.fn(),
    deleteTask: rs.fn(),
    setTaskParent: rs.fn(),
    skipOccurrence: rs.fn(),
    setTaskStatus: rs.fn(),
    dropTask: rs.fn(async () => true),
    createSection: rs.fn(),
    renameSection: rs.fn(),
    deleteSection: rs.fn(),
  };
}

type ListProps = Partial<Parameters<typeof TaskListView>[0]>;

function renderList(over: ListProps = {}, tasks: Task[] = DOGFOOD) {
  const onSelectTask = rs.fn();
  function List(props: ListProps) {
    const [selected, setSelected] = useState<string | null>("a");
    return (
      <TaskListView
        tasks={tasks}
        scopeTitle="Dogfood"
        selection="p1"
        view="list"
        onViewChange={() => {}}
        groupBy="section"
        buckets={[]}
        inbox={null}
        bucketNameById={() => "Dogfood"}
        canEdit
        onRequestCapture={() => {}}
        sections={SECTIONS}
        onAddSection={() => {}}
        selectedTaskId={selected}
        onSelectTask={(id) => {
          onSelectTask(id);
          setSelected(id);
        }}
        api={apiOf(tasks) as never}
        {...props}
      />
    );
  }
  const view = render(
    <TooltipProvider>
      <List {...over} />
    </TooltipProvider>,
  );
  const rerender = (props: ListProps) =>
    view.rerender(
      <TooltipProvider>
        <List {...props} />
      </TooltipProvider>,
    );
  return { onSelectTask, rerender };
}

const row = (title: string) => screen.queryByRole("button", { name: title });
const groupLines = () => document.querySelectorAll('[data-slot="completed-line"]');
const endLines = () => [
  ...document.querySelectorAll<HTMLElement>('[data-slot="completed-end-line"]'),
];
const endButton = () => {
  const [line] = endLines();
  return (line?.matches("button") ? line : line?.querySelector("button")) as HTMLButtonElement;
};

describe("the List while Completed is Hidden (MOD-148)", () => {
  it("draws no per-group lines and one line at the end, counting every hidden completed task", () => {
    renderList();
    expect(groupLines()).toHaveLength(0);
    expect(endLines()).toHaveLength(1);
    expect(endButton().textContent).toBe("6 completed · Show");
    expect(endButton().getAttribute("aria-label")).toBe("6 completed, show");
    expect(endButton().getAttribute("aria-expanded")).toBe("false");
    // Only the open tasks show; Backlog keeps its folded line per group.
    expect(row("Task a")).toBeTruthy();
    expect(row("Task b")).toBeTruthy();
    expect(row("Task d1")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Backlog, / })).toHaveLength(1);
    // Every section with tasks keeps its header, Visual too, which shows
    // none (all done).
    for (const name of [/^No section/, /^Triage/, /^Visual/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("sits at the very end, after + Add section, inside the list's grid", () => {
    renderList();
    const grid = screen.getByRole("grid");
    const line = endLines()[0] as HTMLElement;
    expect(grid.contains(line)).toBe(true);
    const add = screen.getByText("Add section");
    // Add section comes first in the document, then the line.
    expect(add.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A real button: Tab reaches it, as it reached the old lines.
    expect(endButton().tagName).toBe("BUTTON");
  });

  it("Show lists them in place, in their groups, and the line then reads Hide", () => {
    renderList();
    fireEvent.click(endButton());
    for (const id of ["d1", "d2", "d3", "d4", "d5", "d6"]) expect(row(`Task ${id}`)).toBeTruthy();
    expect(endButton().textContent).toBe("6 completed · Hide");
    expect(endButton().getAttribute("aria-expanded")).toBe("true");
    // In their groups: d2 and d3 sit between Triage's header and Visual's.
    const triage = screen.getByRole("button", { name: /^Triage/ });
    const visual = screen.getByRole("button", { name: /^Visual/ });
    const d2 = row("Task d2") as HTMLElement;
    expect(triage.compareDocumentPosition(d2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(d2.compareDocumentPosition(visual) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Still no per-group lines, and Backlog stays folded.
    expect(groupLines()).toHaveLength(0);
    expect(row("Task x")).toBeNull();

    fireEvent.click(endButton());
    expect(row("Task d1")).toBeNull();
    expect(endButton().textContent).toBe("6 completed · Show");
  });

  it("j/k walk the tasks it shows, never the line", () => {
    const { onSelectTask } = renderList();
    const grid = screen.getByRole("grid");
    fireEvent.click(endButton());
    // a (No section) → d1 (its done task, now shown) → b (Triage).
    fireEvent.keyDown(grid, { key: "j", code: "KeyJ" });
    expect(onSelectTask).toHaveBeenLastCalledWith("d1");
    fireEvent.keyDown(grid, { key: "j", code: "KeyJ" });
    expect(onSelectTask).toHaveBeenLastCalledWith("b");
  });

  it("its count holds still while the cursor walks onto a finished task", () => {
    renderList();
    const grid = screen.getByRole("grid");
    fireEvent.click(endButton());
    fireEvent.keyDown(grid, { key: "j", code: "KeyJ" });
    // d1 is selected: it stays listed whatever Display says, and still counts.
    expect(endButton().textContent).toBe("6 completed · Hide");
    fireEvent.click(endButton());
    expect(row("Task d1")).toBeTruthy();
    expect(row("Task d2")).toBeNull();
    expect(endButton().textContent).toBe("6 completed · Show");
  });

  it("counts a folded group's hidden tasks too, and its fold stays yours", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /^Visual/ }));
    expect(endButton().textContent).toBe("6 completed · Show");
    fireEvent.click(endButton());
    expect(row("Task d4")).toBeNull();
    expect(row("Task d2")).toBeTruthy();
  });

  it("ends with a new scope, grouping or Completed choice, and never saves Display", () => {
    const { rerender } = renderList();
    const showThenAway = (away: ListProps) => {
      fireEvent.click(endButton());
      expect(row("Task d1")).toBeTruthy();
      rerender(away);
      rerender({});
      expect(row("Task d1")).toBeNull();
      expect(endButton().textContent).toBe("6 completed · Show");
    };
    // Display → Completed: 7 days, then back: hidden again.
    showThenAway({ completed: "week" });
    // Another scope (All), then back to the project.
    showThenAway({ selection: "all" });
    // Group by Status, then back to Section.
    showThenAway({ groupBy: "status" });
  });

  it("an ungrouped list ends with the same one line", () => {
    renderList({ groupBy: "none", onAddSection: undefined });
    expect(groupLines()).toHaveLength(0);
    expect(endButton().textContent).toBe("6 completed · Show");
  });

  it("a view's own grouping (Upcoming's days) ends with the same one line", () => {
    const day = (t: Task) => (t.sectionId ? "tue" : "mon");
    const grouping: ListGrouping = {
      groups: (list) =>
        (["mon", "tue"] as const).map((key) => ({
          key,
          label: key === "mon" ? "Mon" : "Tue",
          tasks: list.filter((t) => day(t) === key),
        })),
      keyOf: day,
      header: (g) => ({ count: g.tasks.length }),
      accepts: () => true,
      onDrop: () => {},
      addState: () => ({ kind: "none" }),
    };
    renderList({ selection: "upcoming", grouping, onAddSection: undefined });
    expect(groupLines()).toHaveLength(0);
    expect(endButton().textContent).toBe("6 completed · Show");
    fireEvent.click(endButton());
    expect(row("Task d4")).toBeTruthy();
  });

  it("with nothing completed hidden there is no line", () => {
    renderList({}, [task("a"), task("b", { sectionId: "s1" })]);
    expect(endLines()).toHaveLength(0);
  });
});

describe("the List in 7 days and All (unchanged)", () => {
  it('"7 days" keeps each group\'s own line for the older ones, and no end line', () => {
    renderList({ completed: "week" as CompletedMode });
    expect(endLines()).toHaveLength(0);
    const lines = [...groupLines()].map((l) => l.textContent);
    // No section: d1 · Triage: d2, d3 · Visual: d4, d5 (d6 is recent and listed).
    expect(lines).toEqual(["1 completed · show", "2 completed · show", "2 completed · show"]);
    expect(row("Task d6")).toBeTruthy();
    // Each opens on its own, as before.
    const visual = groupLines()[2] as HTMLElement;
    fireEvent.click(within(visual).getByRole("button"));
    expect(row("Task d4")).toBeTruthy();
    expect(row("Task d2")).toBeNull();
  });

  it('"All" lists every one with no line at all', () => {
    renderList({ completed: "all" });
    expect(endLines()).toHaveLength(0);
    expect(groupLines()).toHaveLength(0);
    expect(row("Task d1")).toBeTruthy();
  });
});

type BoardProps = Partial<Parameters<typeof TaskBoardView>[0]>;

function renderBoard(over: BoardProps = {}, tasks: Task[] = DOGFOOD) {
  const view = render(boardOf(over, tasks));
  return { rerender: (props: BoardProps) => view.rerender(boardOf(props, tasks)) };
}

function boardOf(over: BoardProps, tasks: Task[]) {
  return (
    <TooltipProvider>
      <TaskBoardView
        tasks={tasks}
        scopeTitle="Dogfood"
        selection="p1"
        view="board"
        onViewChange={() => {}}
        boardGroupBy="section"
        buckets={[PROJECT]}
        inbox={null}
        bucketNameById={() => "Dogfood"}
        canEdit
        onRequestCapture={() => {}}
        selectedTaskId={null}
        onSelectTask={() => {}}
        api={apiOf(tasks) as never}
        {...over}
      />
    </TooltipProvider>
  );
}

const card = (title: string) => screen.queryByText(title)?.closest("[data-task-id]") ?? null;
const column = (name: string) =>
  document.querySelector(`section[data-board-column="${name}"]`) as HTMLElement;
/** Every "N completed" button on the board: a column's, a cell's or the end's. */
const completedButtons = () =>
  screen.queryAllByRole("button", { name: /^\d+ completed, (show|hide)$/ });
/** The board's end line: the one completed button outside every column. */
const boardEnd = () => {
  const outside = completedButtons().filter((b) => !b.closest("section[data-board-column]"));
  expect(outside).toHaveLength(1);
  return outside[0] as HTMLElement;
};

describe("the Board while Completed is Hidden (MOD-148)", () => {
  it("no column has its own line; one at the board's end counts every column's", () => {
    renderBoard();
    expect(groupLines()).toHaveLength(0);
    expect(completedButtons()).toHaveLength(1);
    expect(boardEnd().textContent).toBe("6 completed · Show");
    expect(boardEnd().getAttribute("aria-expanded")).toBe("false");
    expect(card("Task d2")).toBeNull();
    fireEvent.click(boardEnd());
    // In place, in their columns.
    expect(column("Triage").contains(card("Task d2"))).toBe(true);
    expect(column("Visual").contains(card("Task d4"))).toBe(true);
    expect(boardEnd().textContent).toBe("6 completed · Hide");
    expect(boardEnd().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(boardEnd());
    expect(card("Task d2")).toBeNull();
  });

  it("its count holds still with a finished card selected", () => {
    renderBoard({ selectedTaskId: "d2" });
    // d2 shows (the selection always does) and still counts.
    expect(card("Task d2")).toBeTruthy();
    expect(card("Task d3")).toBeNull();
    expect(boardEnd().textContent).toBe("6 completed · Show");
  });

  it("ends with a new grouping or Completed choice", () => {
    const { rerender } = renderBoard();
    for (const away of [{ completed: "week" as const }, { boardGroupBy: "status" as const }]) {
      fireEvent.click(boardEnd());
      expect(card("Task d2")).toBeTruthy();
      rerender(away);
      rerender({});
      expect(card("Task d2")).toBeNull();
      expect(boardEnd().textContent).toBe("6 completed · Show");
    }
  });

  it("a Done column whose cards are all hidden still takes drops", () => {
    renderBoard({ boardGroupBy: "status" });
    expect(within(column("Done")).getByText("Drop tasks here")).toBeTruthy();
    expect(boardEnd().textContent).toBe("6 completed · Show");
  });

  it("with lanes, no cell has its own line either", () => {
    renderBoard({ boardGroupBy: "status", lanes: "assignee" });
    expect(groupLines()).toHaveLength(0);
    expect(completedButtons()).toHaveLength(1);
    expect(boardEnd().textContent).toBe("6 completed · Show");
  });

  it('"7 days" keeps each column\'s own line, and no end line', () => {
    renderBoard({ completed: "week" });
    expect(completedButtons().every((b) => b.closest("section[data-board-column]"))).toBe(true);
    expect([...groupLines()].map((l) => l.textContent)).toEqual([
      "1 completed · show",
      "2 completed · show",
      "2 completed · show",
    ]);
  });
});
