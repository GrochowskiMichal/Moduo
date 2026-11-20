// MOD-122 on the real List: folding every group that holds tasks used to crash
// the project (React #185, also after a reload, since folds are synced). The
// page picks a task whenever nothing it can find is selected (tasks-plan-view's
// backstop, `backstopPick`); the List dropped any selection it couldn't show,
// so with nothing visible the two flipped the selection back and forth.
// The page here runs the real rule, fed the List's order as the page feeds it.
//
// MOD-123: with nothing shown, the List tells the page, whose panel then shows
// what it shows with nothing selected. MOD-124: a closed "Backlog · n" line
// stays closed: the page never picks a task the List hides, and the List opens
// a line only for a selection that arrives inside it.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { resetFoldsForTests } from "../folds";
import { type GroupBy, makeTask } from "../helpers";
import type { Section, Task } from "../model";
import { backstopPick } from "../selection";
import { renderWithTasks } from "../testing/render-with-tasks";
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
const FOLD_KEY = "w:p1:section";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "p1", title: `Task ${id}`, position: id }),
    id,
    assigneeId: null,
    updatedAt: OLD,
    ...over,
  };
}

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

const sections = [section("s1", "Triage", 1), section("s2", "Visual", 2)];
// The board as it was: one task with no section, the rest in Triage, Visual empty.
const boardTasks = [task("a"), task("b", { sectionId: "s1" }), task("c", { sectionId: "s1" })];

async function renderPage({
  tasks: initialTasks = boardTasks,
  groupBy = "section",
}: {
  tasks?: Task[];
  groupBy?: GroupBy;
} = {}) {
  const api = {
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
    patchTask: rs.fn(),
    deleteTask: rs.fn(),
    setTaskParent: rs.fn(),
    skipOccurrence: rs.fn(),
    setTaskStatus: rs.fn(),
    dropTask: rs.fn(async () => true),
  };
  const picks: (string | null)[] = [];
  const shown = { nothing: false, reports: 0 };
  function Page({ tasks }: { tasks: Task[] }) {
    const inScope = (id: string) => tasks.some((t) => t.id === id);
    const [selected, setSelected] = useState<string | null>(null);
    const orderRef = useRef<readonly string[]>([]);
    const select = (id: string | null) => {
      picks.push(id);
      // A loop would spin here until the test times out: stop it loudly.
      if (picks.length > 60) throw new Error("the selection never settles");
      setSelected(id);
    };
    // The page's backstop, its real rule, with the List's rows as the page
    // reads them (the List writes them in a layout effect, before this runs).
    useEffect(() => {
      const pick = backstopPick({
        selectedId: selected,
        selectedParentId: null,
        inScope,
        listOrder: orderRef.current,
        firstInScope: tasks[0]?.id ?? null,
      });
      if (pick !== undefined) select(pick);
    });
    return (
      <TaskListView
        tasks={tasks}
        scopeTitle="Dogfood"
        selection="p1"
        view="list"
        onViewChange={() => {}}
        groupBy={groupBy}
        buckets={[]}
        inbox={null}
        bucketNameById={() => "Dogfood"}
        canEdit
        onRequestCapture={() => {}}
        sections={sections}
        collapseKey={FOLD_KEY}
        selectedTaskId={selected}
        onSelectTask={select}
        orderRef={orderRef}
        onShowsNothing={(nothing) => {
          shown.nothing = nothing;
          shown.reports += 1;
        }}
      />
    );
  }
  // The store holds the scope's tasks and the project's sections; the page
  // hands the List its scope in its own order (the first one is the backstop's).
  const view = await renderWithTasks(
    <TooltipProvider>
      <Page tasks={initialTasks} />
    </TooltipProvider>,
    { seed: { tasks: initialTasks, sections }, workspaceId: "w", commands: api },
  );
  /** The store moves on (a status change, a remote edit): the same page, new tasks. */
  const update = (tasks: Task[]) => {
    act(() => view.store.answer({ tasks }));
    view.rerender(
      <TooltipProvider>
        <Page tasks={tasks} />
      </TooltipProvider>,
    );
  };
  return { picks, shown, update };
}

const row = (title: string) => screen.queryByRole("button", { name: title });
const backlogLine = () => screen.getByRole("button", { name: /^Backlog, / });

describe("folding every group that holds tasks (MOD-122, MOD-123)", () => {
  it("settles instead of looping, and stays settled when the project opens again", async () => {
    const { picks, shown } = await renderPage();
    expect(shown.nothing).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^No section/ }));
    // Task a hid, so the List moved to Triage's first row.
    expect(picks.at(-1)).toBe("b");
    const before = picks.length;
    fireEvent.click(screen.getByRole("button", { name: /^Triage/ }));
    expect(row("Task a")).toBeNull();
    expect(row("Task b")).toBeNull();
    // Nothing left to show: the List leaves the selection where it was, and
    // says so, so the page's panel shows the project instead (MOD-123).
    expect(picks.length).toBe(before);
    expect(shown.nothing).toBe(true);

    // Opening a group shows rows again, and the panel goes back to the task.
    fireEvent.click(screen.getByRole("button", { name: /^Triage/ }));
    expect(row("Task b")).toBeTruthy();
    expect(shown.nothing).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^Triage/ }));

    // The folds are remembered: opening the project again starts all folded,
    // with nothing selected (no row to pick), and settles there.
    cleanup();
    const again = await renderPage();
    expect(row("Task a")).toBeNull();
    expect(again.picks).toEqual([]);
    expect(again.shown.nothing).toBe(true);
    // Opening a group picks its first row.
    fireEvent.click(screen.getByRole("button", { name: /^Triage/ }));
    expect(again.picks).toEqual(["b"]);
    expect(again.shown.nothing).toBe(false);
  });

  it("says nothing more while the rows it shows change but some still show", async () => {
    const { shown } = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^No section/ }));
    fireEvent.click(screen.getByRole("button", { name: /^No section/ }));
    // Only a change between "some rows" and "none" is news (no extra draws).
    expect(shown.reports).toBe(0);
  });
});

describe("a project with only completed work (MOD-148)", () => {
  // Hidden means hidden: no row shows, only the headers and the list's one
  // "N completed · Show" line, so the page and the List must agree on nothing.
  const allDone = [
    task("a", { status: "done", statusCategory: "done" }),
    task("b", { sectionId: "s1", status: "done", statusCategory: "done" }),
    task("c", { sectionId: "s1", status: "done", statusCategory: "done" }),
  ];
  const endLine = () => screen.getByRole("button", { name: /^\d+ completed, (show|hide)$/ });

  it("settles on nothing, then Show picks the first row it lists, and Hide keeps it", async () => {
    const { picks, shown } = await renderPage({ tasks: allDone });
    expect(row("Task a")).toBeNull();
    expect(endLine().textContent).toBe("3 completed · Show");
    expect(picks).toEqual([]);
    expect(shown.nothing).toBe(true);

    fireEvent.click(endLine());
    expect(row("Task a")).toBeTruthy();
    expect(picks).toEqual(["a"]);
    expect(shown.nothing).toBe(false);
    // The selected one is listed whatever Display says (TV-U1's rule), but
    // the line still counts it: its count holds still under the cursor.
    expect(endLine().textContent).toBe("3 completed · Hide");

    // Hiding again keeps the selected row (it's never pulled from under you),
    // and nothing flips.
    fireEvent.click(endLine());
    expect(row("Task a")).toBeTruthy();
    expect(row("Task b")).toBeNull();
    expect(endLine().textContent).toBe("3 completed · Show");
    expect(picks).toEqual(["a"]);
  });

  it("with its only task done, Show selects it and the line stays to hide it again", async () => {
    const { picks } = await renderPage({ tasks: [allDone[0] as Task] });
    fireEvent.click(endLine());
    expect(picks).toEqual(["a"]);
    expect(endLine().textContent).toBe("1 completed · Hide");
    fireEvent.click(endLine());
    expect(endLine().textContent).toBe("1 completed · Show");
  });
});

describe("a closed Backlog line stays closed (MOD-124)", () => {
  // Triage holds only a Backlog task (behind its "Backlog · 1" line); the
  // scope's first task is that Backlog task.
  const backlogFirst = [
    task("x", { sectionId: "s1", statusCategory: "backlog" }),
    task("a"),
    task("v", { sectionId: "s2" }),
  ];

  it("opening the project picks the first row shown, never the Backlog task", async () => {
    const { picks } = await renderPage({ tasks: backlogFirst });
    expect(row("Task x")).toBeNull();
    expect(backlogLine().getAttribute("aria-expanded")).toBe("false");
    expect(picks.at(-1)).toBe("a");
  });

  it("closing the line that holds the selection moves it to a row still shown", async () => {
    const { picks } = await renderPage({ tasks: backlogFirst });
    fireEvent.click(backlogLine());
    fireEvent.click(screen.getByRole("button", { name: "Task x" }));
    expect(picks.at(-1)).toBe("x");
    fireEvent.click(backlogLine());
    expect(row("Task x")).toBeNull();
    expect(backlogLine().getAttribute("aria-expanded")).toBe("false");
    expect(picks.at(-1)).toBe("a");
  });

  it("a selected task set to Backlog keeps the selection, and its line opens for it", async () => {
    const start = [task("a"), task("x", { sectionId: "s1" }), task("y", { sectionId: "s1" })];
    const { picks, update } = await renderPage({ tasks: start });
    fireEvent.click(screen.getByRole("button", { name: "Task x" }));
    expect(picks.at(-1)).toBe("x");
    const before = picks.length;
    // Its status moves to Backlog (the panel's picker, Undo, a teammate).
    const later = "2026-01-02T00:00:00.000Z";
    update([
      task("a"),
      task("x", { sectionId: "s1", statusCategory: "backlog", updatedAt: later }),
      start[2],
    ]);
    expect(picks.length).toBe(before);
    expect(row("Task x")).toBeTruthy();
    expect(backlogLine().getAttribute("aria-expanded")).toBe("true");
  });

  it("closing the line on it, then reopening it, still opens for the selection after", async () => {
    const { picks } = await renderPage({ tasks: backlogFirst });
    fireEvent.click(screen.getByRole("button", { name: /^No section/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Visual/ }));
    fireEvent.click(backlogLine());
    fireEvent.click(backlogLine());
    expect(backlogLine().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(backlogLine());
    expect(row("Task x")).toBeTruthy();
    expect(picks.at(-1)).toBe("x");
  });

  it("opening another Backlog line leaves the one closed on the selection shut", async () => {
    const { picks } = await renderPage({
      tasks: [
        task("a"),
        task("x", { sectionId: "s1", statusCategory: "backlog" }),
        task("z", { sectionId: "s2", statusCategory: "backlog" }),
      ],
    });
    const lines = () => screen.getAllByRole("button", { name: /^Backlog, / });
    fireEvent.click(screen.getByRole("button", { name: /^No section/ }));
    fireEvent.click(lines()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Task x" }));
    fireEvent.click(lines()[0]);
    expect(lines().map((l) => l.getAttribute("aria-expanded"))).toEqual(["false", "false"]);
    expect(picks.at(-1)).toBe("x");
    // Visual's line opens; Triage's stays shut, and the selection moves to a row shown.
    fireEvent.click(lines()[1]);
    expect(lines().map((l) => l.getAttribute("aria-expanded"))).toEqual(["false", "true"]);
    expect(picks.at(-1)).toBe("z");
  });

  it("with no other row shown, the selection stays put and the line stays closed", async () => {
    const { picks, shown } = await renderPage({ tasks: backlogFirst });
    fireEvent.click(screen.getByRole("button", { name: /^No section/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Visual/ }));
    fireEvent.click(backlogLine());
    fireEvent.click(screen.getByRole("button", { name: "Task x" }));
    const before = picks.length;
    fireEvent.click(backlogLine());
    expect(row("Task x")).toBeNull();
    expect(backlogLine().getAttribute("aria-expanded")).toBe("false");
    expect(picks.length).toBe(before);
    expect(picks.at(-1)).toBe("x");
    // Nothing shown: the panel shows the project (MOD-123).
    expect(shown.nothing).toBe(true);
  });
});
