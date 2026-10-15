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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function renderPage({
  tasks = boardTasks,
  groupBy = "section",
}: {
  tasks?: Task[];
  groupBy?: GroupBy;
} = {}) {
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
    sections,
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
  const inScope = (id: string) => tasks.some((t) => t.id === id);
  function Page() {
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
        api={api as never}
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
  render(
    <TooltipProvider>
      <Page />
    </TooltipProvider>,
  );
  return { picks, shown };
}

const row = (title: string) => screen.queryByRole("button", { name: title });
const backlogLine = () => screen.getByRole("button", { name: /^Backlog, / });

describe("folding every group that holds tasks (MOD-122, MOD-123)", () => {
  it("settles instead of looping, and stays settled when the project opens again", () => {
    const { picks, shown } = renderPage();
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
    const again = renderPage();
    expect(row("Task a")).toBeNull();
    expect(again.picks).toEqual([]);
    expect(again.shown.nothing).toBe(true);
    // Opening a group picks its first row.
    fireEvent.click(screen.getByRole("button", { name: /^Triage/ }));
    expect(again.picks).toEqual(["b"]);
    expect(again.shown.nothing).toBe(false);
  });

  it("says nothing more while the rows it shows change but some still show", () => {
    const { shown } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^No section/ }));
    fireEvent.click(screen.getByRole("button", { name: /^No section/ }));
    // Only a change between "some rows" and "none" is news (no extra draws).
    expect(shown.reports).toBe(0);
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

  it("opening the project picks the first row shown, never the Backlog task", () => {
    const { picks } = renderPage({ tasks: backlogFirst });
    expect(row("Task x")).toBeNull();
    expect(backlogLine().getAttribute("aria-expanded")).toBe("false");
    expect(picks.at(-1)).toBe("a");
  });

  it("closing the line that holds the selection moves it to a row still shown", () => {
    const { picks } = renderPage({ tasks: backlogFirst });
    fireEvent.click(backlogLine());
    fireEvent.click(screen.getByRole("button", { name: "Task x" }));
    expect(picks.at(-1)).toBe("x");
    fireEvent.click(backlogLine());
    expect(row("Task x")).toBeNull();
    expect(backlogLine().getAttribute("aria-expanded")).toBe("false");
    expect(picks.at(-1)).toBe("a");
  });

  it("with no other row shown, the selection stays put and the line stays closed", () => {
    const { picks, shown } = renderPage({ tasks: backlogFirst });
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
