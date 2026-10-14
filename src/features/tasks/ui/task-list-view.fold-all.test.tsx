// MOD-122 on the real List: folding every group that holds tasks used to crash
// the project (React #185, also after a reload, since folds are synced). The
// page picks the first task in scope whenever nothing it can find is selected
// (tasks-plan-view.tsx's backstop); the List dropped any selection it couldn't
// show, so with nothing visible the two flipped the selection back and forth.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { resetFoldsForTests } from "../folds";
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
const tasks = [task("a"), task("b", { sectionId: "s1" }), task("c", { sectionId: "s1" })];

function renderPage() {
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
  function Page() {
    const [selected, setSelected] = useState<string | null>(null);
    const select = (id: string | null) => {
      picks.push(id);
      // A loop would spin here until the test times out: stop it loudly.
      if (picks.length > 60) throw new Error("the selection never settles");
      setSelected(id);
    };
    // The page's backstop, as tasks-plan-view.tsx has it: nothing it can find
    // selected, so the first task in scope.
    useEffect(() => {
      if (selected && tasks.some((t) => t.id === selected)) return;
      const first = tasks[0]?.id ?? null;
      if (first !== selected) select(first);
    });
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
        api={api as never}
        sections={sections}
        collapseKey={FOLD_KEY}
        selectedTaskId={selected}
        onSelectTask={select}
      />
    );
  }
  render(
    <TooltipProvider>
      <Page />
    </TooltipProvider>,
  );
  return { picks };
}

describe("folding every group that holds tasks (MOD-122)", () => {
  it("settles instead of looping, and stays settled when the project opens again", () => {
    const { picks } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^No section/ }));
    // Task a hid, so the List moved to Triage's first row.
    expect(picks.at(-1)).toBe("b");
    const before = picks.length;
    fireEvent.click(screen.getByRole("button", { name: /^Triage/ }));
    expect(screen.queryByRole("button", { name: "Task a" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Task b" })).toBeNull();
    // Nothing left to show: the List leaves the selection where it was.
    expect(picks.length).toBe(before);

    // The folds are remembered: opening the project again starts all folded.
    cleanup();
    const again = renderPage();
    expect(screen.queryByRole("button", { name: "Task a" })).toBeNull();
    expect(again.picks.length).toBeLessThanOrEqual(2);
    expect(again.picks.at(-1)).toBe("a");
  });
});
