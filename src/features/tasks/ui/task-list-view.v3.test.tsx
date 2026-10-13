// TV-U10 on the real List: the status icon finishes and reopens (default k),
// ⇧S opens the status menu, Backlog folds behind its line (53b), a group
// header's "+" stays visible and adds with the group's value (default n),
// section groups count "2 of 5", folds are remembered, late rows offer their
// fixes on hover (default i) and read-only views say so (research §9).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
import { makeTask } from "../helpers";
import type { Section, Task } from "../model";
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

const OLD = "2026-01-01T00:00:00.000Z";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "p1", title: `Task ${id}`, position: id }),
    id,
    assigneeId: null,
    updatedAt: OLD,
    ...over,
  };
}

function section(id: string, name: string, position: number, over: Partial<Section> = {}) {
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
    ...over,
  } satisfies Section;
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
  const onRequestCapture = rs.fn();
  // The page keeps the selection: a j or a click moves it, like the real one.
  function Page() {
    const [selected, setSelected] = useState<string | null>(extra.selectedTaskId ?? null);
    return (
      <TaskListView
        tasks={tasks}
        scopeTitle="Work"
        selection="p1"
        view="list"
        onViewChange={() => {}}
        groupBy="none"
        buckets={[]}
        inbox={null}
        bucketNameById={() => "Work"}
        canEdit
        onRequestCapture={onRequestCapture}
        api={api as never}
        {...extra}
        selectedTaskId={selected}
        onSelectTask={(id) => {
          setSelected(id);
          extra.onSelectTask?.(id);
        }}
      />
    );
  }
  const view = render(
    <TooltipProvider>
      <Page />
    </TooltipProvider>,
  );
  return { api, onRequestCapture, view };
}

const rowOf = (title: string) =>
  screen.getByRole("button", { name: title }).closest('[role="row"]') as HTMLElement;

describe("the status icon (default k)", () => {
  it("finishes an open task from any open category", () => {
    const { api } = renderList([task("a", { status: "in_progress" })]);
    fireEvent.click(within(rowOf("Task a")).getByRole("button", { name: "Mark as done" }));
    expect(api.toggleDone).toHaveBeenCalledTimes(1);
  });

  it("reopens a Won't do task to To do (not Done)", () => {
    const { api } = renderList([task("a", { status: "archived" })], { completed: "all" });
    fireEvent.click(within(rowOf("Task a")).getByRole("button", { name: "Reopen" }));
    expect(api.setTaskStatus).toHaveBeenCalledWith("a", { category: "todo" });
    expect(api.toggleDone).not.toHaveBeenCalled();
  });

  it("Space on a selected Won't do task reopens it too (it used to mark it Done)", () => {
    const { api } = renderList([task("a", { status: "archived" })], {
      completed: "all",
      selectedTaskId: "a",
    });
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: " " });
    expect(api.setTaskStatus).toHaveBeenCalledWith("a", { category: "todo" });
    expect(api.toggleDone).not.toHaveBeenCalled();
  });

  it("⏎ opens the selected task full; `e` edits its title", () => {
    const onOpenTask = rs.fn();
    renderList([task("a")], { selectedTaskId: "a", onOpenTask });
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onOpenTask).toHaveBeenCalledWith("a");
    fireEvent.keyDown(grid, { key: "e" });
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("⇧S opens the status menu on the selected row", async () => {
    renderList([task("a")], { selectedTaskId: "a" });
    const grid = screen.getByRole("grid");
    grid.focus();
    await act(async () => {
      fireEvent.keyDown(grid, { key: "S", shiftKey: true });
    });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitemradio", { name: /In progress/ })).toBeTruthy();
  });
});

describe("Backlog (53b)", () => {
  it("folds behind a quiet line at the end, and opens on a click", () => {
    renderList([task("a"), task("b", { statusCategory: "backlog" })]);
    expect(screen.queryByRole("button", { name: "Task b" })).toBeNull();
    const line = screen.getByRole("button", { name: /Backlog, 1 task, show/ });
    fireEvent.click(line);
    expect(screen.getByRole("button", { name: "Task b" })).toBeTruthy();
  });

  it("j walks an opened Backlog in order: a selected Backlog task stays in its line", () => {
    const onSelectTask = rs.fn();
    renderList(
      [
        task("a"),
        task("x", { statusCategory: "backlog" }),
        task("y", { statusCategory: "backlog" }),
        task("z", { statusCategory: "backlog" }),
      ],
      { selectedTaskId: "a", onSelectTask },
    );
    fireEvent.click(screen.getByRole("button", { name: /Backlog, 3 tasks, show/ }));
    const grid = screen.getByRole("grid");
    grid.focus();
    for (let i = 0; i < 3; i++) fireEvent.keyDown(grid, { key: "j" });
    expect(onSelectTask.mock.calls.map((c) => c[0])).toEqual(["x", "y", "z"]);
    // The line still counts all three: none was pulled out above it.
    expect(screen.getByRole("button", { name: /Backlog, 3 tasks, hide/ })).toBeTruthy();
  });

  it("closing the line that holds the selection closes it; the selection steps up", () => {
    const onSelectTask = rs.fn();
    renderList([task("a"), task("x", { statusCategory: "backlog" })], {
      selectedTaskId: "a",
      onSelectTask,
    });
    fireEvent.click(screen.getByRole("button", { name: /Backlog, 1 task, show/ }));
    fireEvent.click(screen.getByRole("button", { name: "Task x" }));
    expect(onSelectTask).toHaveBeenLastCalledWith("x");
    fireEvent.click(screen.getByRole("button", { name: /Backlog, 1 task, hide/ }));
    expect(screen.getByRole("button", { name: /Backlog, 1 task, show/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Task x" })).toBeNull();
    expect(onSelectTask).toHaveBeenLastCalledWith("a");
  });

  it("grouped by status, Backlog is its own group, folded", () => {
    renderList([task("a"), task("b", { statusCategory: "backlog" })], { groupBy: "status" });
    expect(screen.queryByRole("button", { name: /Backlog, 1 task/ })).toBeNull();
    const header = screen.getByRole("button", { name: /^Backlog/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Task b" })).toBeNull();
  });
});

describe("group headers (default n)", () => {
  const sections = [
    section("s1", "Design", 1, { endsOn: "2026-10-24" }),
    section("s2", "Build", 2),
  ];
  const tasks = () => [
    task("a", { sectionId: "s1" }),
    task("b", { sectionId: "s1", status: "done" }),
    task("c", { sectionId: "s2" }),
  ];

  it("section groups read '2 of 5' and their end date; the + stays visible and adds there", () => {
    const { onRequestCapture } = renderList(tasks(), { groupBy: "section", sections });
    const design = screen.getByRole("button", { name: /^Design/ });
    expect(design.textContent).toContain("1 of 2");
    expect(design.textContent).toMatch(/ends Oct 24/);
    const add = screen.getByRole("button", { name: "Add a task to Design" });
    // Not in the fading slot: always there.
    expect(add.closest('[data-slot="group-header-persistent"]')).not.toBeNull();
    fireEvent.click(add);
    expect(onRequestCapture).toHaveBeenCalledWith({ projectId: "p1", sectionId: "s1" });
  });

  it("a project grouped by section ends with + Add section", () => {
    const onAddSection = rs.fn();
    renderList(tasks(), { groupBy: "section", sections, onAddSection });
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    const input = screen.getByRole("textbox", { name: "New section name" });
    fireEvent.change(input, { target: { value: "Launch" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddSection).toHaveBeenCalledWith("Launch");
  });

  it("a fold is remembered for the view", () => {
    const key = "test:folds";
    renderList(tasks(), { groupBy: "section", sections, collapseKey: key });
    fireEvent.click(screen.getByRole("button", { name: /^Design/ }));
    expect(screen.queryByRole("button", { name: "Task a" })).toBeNull();
    cleanup();
    renderList(tasks(), { groupBy: "section", sections, collapseKey: key });
    expect(screen.queryByRole("button", { name: "Task a" })).toBeNull();
    expect(screen.getByRole("button", { name: "Task c" })).toBeTruthy();
  });
});

describe("hover and states", () => {
  it("a late row offers Move · Won't do · Break down", () => {
    const { api } = renderList([
      task("a", { dueOn: "2020-01-01", dueDate: "2020-01-01T00:00:00Z" }),
    ]);
    const row = rowOf("Task a");
    expect(row.dataset.late).toBe("true");
    fireEvent.click(within(row).getByRole("button", { name: "Won’t do" }));
    expect(api.setTaskStatus).toHaveBeenCalledWith("a", { category: "wont_do" });
    expect(within(row).getByRole("button", { name: "Break down" })).toBeTruthy();
  });

  it("an empty date cell offers its picker", () => {
    renderList([task("a", { dueDate: "2026-12-01T00:00:00.000Z" }), task("b")]);
    const cell = rowOf("Task b").querySelector('[data-col="date"]') as HTMLElement;
    expect(cell.tagName).toBe("BUTTON");
    expect(cell.getAttribute("aria-label")).toBe("Due date");
  });

  it("read-only says View only and has no New", () => {
    renderList([task("a")], { canEdit: false });
    expect(screen.getByText("View only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
  });

  it("filtered to nothing says how many the filters hide", () => {
    renderList([], { filterActive: true, filteredOut: { hidden: 214, filters: 2 } });
    expect(screen.getByText("No tasks match")).toBeTruthy();
    expect(screen.getByText("214 hidden by 2 filters")).toBeTruthy();
  });
});
