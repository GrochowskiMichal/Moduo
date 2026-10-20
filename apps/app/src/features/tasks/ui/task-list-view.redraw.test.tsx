// TV-D11b (REPLAN §6.11, spec §Assumptions #8): editing one task redraws one
// row. Rows are memoised by task and take their own facts and one actions
// object, so the module's maps (new after many changes anywhere, read from
// the Tasks context since A4) and the other tasks' unchanged objects never
// redraw them.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, screen } from "@testing-library/react";
import { useState } from "react";

// Every row (and its queue mark) reads the members once per draw: the count.
// A row also looks its assignee up as it draws: which rows drew.
const draws = rs.hoisted(() => {
  const seen = { n: 0, people: [] as (string | null)[] };
  const byId = (id: string | null) => {
    seen.people.push(id);
    return null;
  };
  return Object.assign(seen, { byId });
});
rs.mock("../assignees", () => ({
  useAssignees: () => {
    draws.n += 1;
    return { assignees: [], currentUserId: "u1", byId: draws.byId };
  },
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { setRunClaims } from "../../focus/claims";
import type { Bucket, Task } from "../model";
import { useTasksSelector } from "../tasks-context";
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

/** The list over the store's tasks (as the page hands its scope), or the ones a test sets. */
async function renderList(seed: Task[] = []) {
  let setTasks: (next: Task[]) => void = () => {};
  let setProjects: (next: Bucket[]) => void = () => {};
  const initial =
    seed.length > 0
      ? seed
      : Array.from({ length: ROWS }, (_, i) => task(String(i + 1), `Task ${i + 1}`));
  function Harness() {
    const live = useTasksSelector((d) => d.liveTasks);
    const [own, set] = useState<Task[] | null>(null);
    const tasks = own ?? live;
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
        />
      </TooltipProvider>
    );
  }
  const view = await renderWithTasks(<Harness />, {
    seed: { buckets: [inbox], tasks: initial },
    workspaceId: "w",
  });
  // The store's own copies (what a teammate's edit replaces one of).
  const stored = (id: string) => view.store.getSnapshot().bundle.tasks.find((t) => t.id === id);
  return {
    store: view.store,
    stored,
    initial: initial.map((t) => stored(t.id) ?? t),
    setTasks: (next: Task[]) => act(() => setTasks(next)),
    setProjects: (next: Bucket[]) => act(() => setProjects(next)),
  };
}

describe("one edit redraws one row (TV-D11b)", () => {
  it("renaming a task redraws its row only", async () => {
    const { initial, setTasks } = await renderList();
    expect(screen.getAllByRole("row")).toHaveLength(ROWS);
    draws.n = 0;
    // The store keeps every other task's object; the edited one is new.
    setTasks(initial.map((t) => (t.id === "7" ? { ...t, title: "Renamed" } : t)));
    expect(screen.getByText("Renamed")).toBeTruthy();
    // The list itself, then one row: the row and its queue mark.
    expect(draws.n).toBe(LIST_DRAW + ROW_DRAWS);
  });

  it("a claims poll redraws only the mark of the task someone is on (TV-F7)", async () => {
    await renderList();
    draws.n = 0;
    act(() => setRunClaims("w", new Map([["7", ["u2"]]])));
    // Row 7's Focus mark only: no list, no other row.
    expect(draws.n).toBe(1);
    draws.n = 0;
    // The next poll answers the same: a new map, nothing redraws.
    act(() => setRunClaims("w", new Map([["7", ["u2"]]])));
    expect(draws.n).toBe(0);
    act(() => setRunClaims(null, new Map()));
  });

  it("a new list with nothing changed for a row redraws no row", async () => {
    const { initial, setTasks } = await renderList();
    draws.n = 0;
    // A change elsewhere (another list, the queue): new array, same tasks.
    setTasks([...initial]);
    expect(draws.n).toBe(LIST_DRAW);
  });

  it("a project added or renamed redraws no row (rows don't carry the project list)", async () => {
    const { setProjects } = await renderList();
    draws.n = 0;
    setProjects([...PROJECTS.slice(1), project("p-new", "New project")]);
    expect(draws.n).toBe(LIST_DRAW);
    setProjects(PROJECTS.map((p) => (p.id === "p3" ? { ...p, name: "Renamed" } : p)));
    expect(draws.n).toBe(LIST_DRAW * 2);
  });

  it("at midnight a row's date label rolls over (rows hear the new day)", async () => {
    rs.useFakeTimers();
    try {
      rs.setSystemTime(new Date(2026, 9, 1, 23, 59, 30));
      const { initial, setTasks } = await renderList();
      const due = new Date(2026, 9, 2, 12).toISOString();
      setTasks(initial.map((t) => (t.id === "7" ? { ...t, dueDate: due } : t)));
      expect(screen.getByText("Tomorrow")).toBeTruthy();
      // Past midnight: the same task, no change of its own.
      act(() => {
        rs.setSystemTime(new Date(2026, 9, 2, 0, 0, 40));
        rs.advanceTimersByTime(40_000);
      });
      expect(screen.queryByText("Tomorrow")).toBeNull();
      expect(screen.getByText("Today")).toBeTruthy();
    } finally {
      rs.useRealTimers();
    }
  });

  it("a teammate's edit to task B (through the store) redraws row B, not row A", async () => {
    const people = (id: string, title: string) => ({ ...task(id, title), assigneeId: `u-${id}` });
    const { store, stored } = await renderList([people("A", "Task A"), people("B", "Task B")]);
    expect(screen.getAllByRole("row")).toHaveLength(2);
    draws.n = 0;
    draws.people = [];
    const b = stored("B") as Task;
    act(() =>
      store.answer({
        tasks: [{ ...b, title: "Renamed by Mike", updatedAt: "2026-10-02T00:00:00.000Z" }],
      }),
    );
    expect(screen.getByText("Renamed by Mike")).toBeTruthy();
    // The list itself, then row B: the row and its queue mark. Row A never drew.
    expect(draws.n).toBe(LIST_DRAW + ROW_DRAWS);
    expect(draws.people).toContain("u-B");
    expect(draws.people).not.toContain("u-A");
  });

  it("an edit through the store redraws at most 2 of 30 rows (TS-3b, AC3)", async () => {
    const seed = Array.from({ length: ROWS }, (_, i) => ({
      ...task(String(i + 1), `Task ${i + 1}`),
      assigneeId: `u-${i + 1}`,
    }));
    const { store, stored } = await renderList(seed);
    draws.people = [];
    const t = stored("12") as Task;
    act(() =>
      store.answer({
        tasks: [{ ...t, title: "Edited", updatedAt: "2026-10-02T00:00:00.000Z" }],
      }),
    );
    expect(screen.getByText("Edited")).toBeTruthy();
    const redrawn = new Set(draws.people.filter((p) => p !== null));
    expect(redrawn.size).toBeLessThanOrEqual(2);
    expect(redrawn).toContain("u-12");
  });
});
