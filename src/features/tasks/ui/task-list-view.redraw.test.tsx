// TV-D11b (REPLAN §6.11, spec §Assumptions #8): editing one task redraws one
// row. Rows are memoised by task and take their own facts and one actions
// object, so a new module API (it is new after every change anywhere) and the
// other tasks' unchanged objects never redraw them.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";

// Every row (and its queue mark) reads the members once per draw: the count.
const draws = rs.hoisted(() => ({ n: 0 }));
rs.mock("../assignees", () => ({
  useAssignees: () => {
    draws.n += 1;
    return { assignees: [], currentUserId: "u1", byId: () => null };
  },
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import type { Bucket, Task } from "../model";
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

const NOW = "2026-10-01T00:00:00.000Z";

function task(id: string, title: string): Task {
  return {
    id,
    workspaceId: "w",
    creatorId: "u1",
    creatorUnknown: false,
    assigneeId: "u1",
    bucketId: "b1",
    parentId: null,
    title,
    description: "",
    dueDate: null,
    scheduledAt: null,
    durationMinutes: null,
    timeSpentSeconds: 0,
    recurrence: null,
    energyLevel: null,
    priority: null,
    status: "todo",
    committedFor: null,
    commitOrder: null,
    rescheduleCount: 0,
    position: id.padStart(4, "0"),
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

const inbox: Bucket = {
  id: "inbox",
  workspaceId: "w",
  ownerId: "u1",
  name: "Inbox",
  isSystem: true,
  group: null,
  position: "a",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

/** A module API as the hook makes it: a fresh object (and fresh maps) each time. */
function apiFor(tasks: Task[]) {
  return {
    loaded: true,
    tasks,
    queuedTaskIds: new Set<string>(),
    queueClaims: new Map(),
    subtasksByParent: new Map(),
    subtaskProgressByTask: new Map(),
    tagsByTask: new Map(),
    blockedTaskIds: new Set<string>(),
    blockersByTask: new Map(),
    statusById: new Map(),
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
    patchTask: rs.fn(),
    deleteTask: rs.fn(),
    setTaskParent: rs.fn(),
    skipOccurrence: rs.fn(),
  };
}

const ROWS = 30;
/** The list itself reads the members once per draw. */
const LIST_DRAW = 1;
/** A row reads them once, and so does its queue mark. */
const ROW_DRAWS = 2;
// The page's own props keep their identity (the hook memoises them).
const bucketName = () => "Work";
const noop = () => {};

function project(id: string, name: string): Bucket {
  return { ...inbox, id, name, isSystem: false, position: id };
}
/** A workspace with many projects (TV-U6 found 224 freezing the page). */
const PROJECTS = Array.from({ length: 200 }, (_, i) => project(`p${i}`, `Project ${i}`));

function renderList() {
  let setTasks: (next: Task[]) => void = () => {};
  let setProjects: (next: Bucket[]) => void = () => {};
  const initial = Array.from({ length: ROWS }, (_, i) => task(String(i + 1), `Task ${i + 1}`));
  function Harness() {
    const [tasks, set] = useState(initial);
    const [buckets, setBuckets] = useState(PROJECTS);
    setTasks = set;
    setProjects = setBuckets;
    return (
      <TooltipProvider>
        <TaskListView
          tasks={tasks}
          scopeTitle="Work"
          selection="b1"
          view="list"
          onViewChange={noop}
          groupBy="none"
          buckets={buckets}
          inbox={inbox}
          bucketNameById={bucketName}
          canEdit
          onRequestCapture={noop}
          selectedTaskId="1"
          onSelectTask={noop}
          api={apiFor(tasks) as never}
        />
      </TooltipProvider>
    );
  }
  render(<Harness />);
  return {
    initial,
    setTasks: (next: Task[]) => act(() => setTasks(next)),
    setProjects: (next: Bucket[]) => act(() => setProjects(next)),
  };
}

describe("one edit redraws one row (TV-D11b)", () => {
  it("renaming a task redraws its row only", () => {
    const { initial, setTasks } = renderList();
    expect(screen.getAllByRole("row")).toHaveLength(ROWS);
    draws.n = 0;
    // The store keeps every other task's object; the edited one is new.
    setTasks(initial.map((t) => (t.id === "7" ? { ...t, title: "Renamed" } : t)));
    expect(screen.getByText("Renamed")).toBeTruthy();
    // The list itself, then one row: the row and its queue mark.
    expect(draws.n).toBe(LIST_DRAW + ROW_DRAWS);
  });

  it("a new module API with nothing changed for a row redraws no row", () => {
    const { initial, setTasks } = renderList();
    draws.n = 0;
    // A change elsewhere (another list, the queue): new array, same tasks.
    setTasks([...initial]);
    expect(draws.n).toBe(LIST_DRAW);
  });

  it("a project added or renamed redraws no row (rows don't carry the project list)", () => {
    const { setProjects } = renderList();
    draws.n = 0;
    setProjects([...PROJECTS.slice(1), project("p-new", "New project")]);
    expect(draws.n).toBe(LIST_DRAW);
    setProjects(PROJECTS.map((p) => (p.id === "p3" ? { ...p, name: "Renamed" } : p)));
    expect(draws.n).toBe(LIST_DRAW * 2);
  });
});
