// tasks-v2 Q1-1/Q1-2 on the real TaskListView + TaskRow: a row's buttons keep
// their Space/Enter (no keyboard drag, no list action), list keys hand focus
// back to the list, and keys typed in a row's popover never reach the list.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
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
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

const NOW = "2026-10-01T00:00:00.000Z";

function task(id: string, title: string, extra: Partial<Task> = {}): Task {
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
    position: id,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
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

/** The real list over three tasks; `queue` renders the reorderable Queue. */
function renderList({ queue = false }: { queue?: boolean } = {}) {
  const tasks = [task("a", "Alpha"), task("b", "Beta"), task("c", "Gamma")];
  const api = {
    loaded: true,
    tasks,
    queuedTaskIds: new Set(queue ? ["a", "b", "c"] : []),
    queueClaims: new Map(),
    subtasksByParent: new Map(),
    subtaskProgressByTask: new Map(),
    tagsByTask: new Map(),
    blockedTaskIds: new Set(),
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
    focusOnTask: rs.fn(() => true),
    patchTask: rs.fn(),
    deleteTask: rs.fn(),
    setTaskParent: rs.fn(),
    skipOccurrence: rs.fn(),
  };
  function Harness() {
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <TooltipProvider>
        <TaskListView
          tasks={tasks}
          scopeTitle={queue ? "Queue" : "Work"}
          selection={queue ? "today" : "b1"}
          view="list"
          onViewChange={() => {}}
          groupBy="none"
          buckets={[]}
          inbox={inbox}
          bucketNameById={() => "Work"}
          canEdit
          onRequestCapture={() => {}}
          selectedTaskId={selected}
          onSelectTask={setSelected}
          reorderable={queue}
          onReorder={() => {}}
          api={api as never}
        />
      </TooltipProvider>
    );
  }
  render(<Harness />);
  return { api, grid: screen.getByRole("grid") };
}

const SPACE = { key: " ", code: "Space" };
const ENTER = { key: "Enter", code: "Enter" };
const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const rowOf = (title: string) =>
  screen.getByRole("button", { name: title }).closest('[role="row"]') as HTMLElement;
const selectedTitle = () =>
  document.querySelector('[role="row"][aria-selected="true"] [data-row-title]')?.textContent;
// dnd-kit announces every lift in its live region.
const liftedAnything = () => /Picked up/.test(document.body.textContent ?? "");

describe("TaskListView keys (tasks-v2 Q1-1, Q1-2)", () => {
  it("Queue: Space on a row's queue toggle stays that button's — no keyboard drag, no list action", async () => {
    const { api } = renderList({ queue: true });
    await wait();
    const toggle = rowOf("Beta").querySelector<HTMLElement>('[aria-label="Remove from Focus"]')!;
    toggle.focus();

    expect(fireEvent.keyDown(toggle, SPACE)).toBe(true); // not prevented → the browser clicks it
    expect(fireEvent.keyDown(toggle, ENTER)).toBe(true);
    await wait();

    expect(liftedAnything()).toBe(false);
    expect(api.toggleDone).not.toHaveBeenCalled();
  });

  it("bucket list: Enter on a row's check-off stays that button's", async () => {
    const { api } = renderList();
    await wait();
    const checkOff = rowOf("Gamma").querySelector<HTMLElement>('[aria-label="Mark as done"]')!;
    checkOff.focus();

    expect(fireEvent.keyDown(checkOff, ENTER)).toBe(true);
    expect(fireEvent.keyDown(checkOff, SPACE)).toBe(true);
    await wait();

    expect(liftedAnything()).toBe(false);
    expect(api.toggleDone).not.toHaveBeenCalled();
  });

  it("⇧F is Focus on this for the selected row (call 31, TV-F7)", async () => {
    const { api, grid } = renderList();
    await wait();
    expect(selectedTitle()).toBe("Alpha");
    fireEvent.keyDown(grid, { key: "F", code: "KeyF", shiftKey: true });
    expect(api.focusOnTask).toHaveBeenCalledWith("a");
    expect(api.toggleQueue).not.toHaveBeenCalled();
  });

  it("a list key pressed on a row button hands focus back, so Space then completes the selected row", async () => {
    const { api, grid } = renderList();
    await wait();
    expect(selectedTitle()).toBe("Alpha");
    // Chromium leaves focus on a clicked button.
    const checkOff = rowOf("Gamma").querySelector<HTMLElement>('[aria-label="Mark as done"]')!;
    checkOff.focus();

    fireEvent.keyDown(checkOff, { key: "j", code: "KeyJ" });
    await wait();
    expect(selectedTitle()).toBe("Beta");
    expect(document.activeElement).toBe(grid);

    fireEvent.keyDown(grid, SPACE);
    expect(api.toggleDone).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  });

  it("a mouse click on a row button hands focus back to the list, like desktop; keyboard activation doesn't", async () => {
    const { api, grid } = renderList();
    await wait();
    const checkOff = rowOf("Gamma").querySelector<HTMLElement>('[aria-label="Mark as done"]')!;

    checkOff.focus(); // Chromium focuses a button on mousedown
    fireEvent.click(checkOff, { detail: 1 });
    expect(api.toggleDone).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c" }));
    expect(document.activeElement).toBe(grid);
    fireEvent.keyDown(grid, SPACE);
    expect(api.toggleDone).toHaveBeenLastCalledWith(expect.objectContaining({ id: "a" }));

    checkOff.focus();
    fireEvent.click(checkOff, { detail: 0 }); // Space/Enter on a Tab-focused button
    expect(document.activeElement).toBe(checkOff);
  });

  it("leaves ⌘K, ⌘⇧K and ⌘C to the app and the OS", async () => {
    const { api, grid } = renderList();
    await wait();
    grid.focus();

    expect(fireEvent.keyDown(grid, { key: "k", code: "KeyK", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(grid, { key: "K", code: "KeyK", metaKey: true, shiftKey: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(grid, { key: "c", code: "KeyC", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(grid, { key: "x", code: "KeyX", metaKey: true })).toBe(true);
    expect(selectedTitle()).toBe("Alpha");
    expect(api.toggleDone).not.toHaveBeenCalled();
  });

  it("keys typed in a row's due popover never reach the list", async () => {
    const { api, grid } = renderList();
    await wait();
    grid.focus();
    fireEvent.keyDown(grid, { key: "d", code: "KeyD" });
    await wait();
    // The picker (TV-P0) focuses its first control; keys there stay the picker's.
    const inside = document.activeElement as HTMLElement;
    expect(inside.closest('[data-slot="popover-content"]')).not.toBeNull();

    fireEvent.keyDown(inside, SPACE);
    fireEvent.keyDown(inside, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(inside, { key: "Backspace", code: "Backspace", metaKey: true });

    expect(api.toggleDone).not.toHaveBeenCalled();
    expect(api.deleteTask).not.toHaveBeenCalled();
    expect(selectedTitle()).toBe("Alpha");
  });
});

// TV-P0 (tasks-v3 AC1.5): the list's states besides rows.
describe("TaskListView states (TV-P0)", () => {
  function renderStates(opts: { loaded: boolean; filterActive?: boolean }) {
    const onClearFilters = rs.fn();
    const api = {
      loaded: opts.loaded,
      tasks: [],
      queuedTaskIds: new Set(),
      queueClaims: new Map(),
      subtasksByParent: new Map(),
      subtaskProgressByTask: new Map(),
      tagsByTask: new Map(),
      blockedTaskIds: new Set(),
    };
    render(
      <TooltipProvider>
        <TaskListView
          tasks={[]}
          scopeTitle="Work"
          selection="b1"
          view="list"
          onViewChange={() => {}}
          groupBy="none"
          buckets={[]}
          inbox={inbox}
          bucketNameById={() => "Work"}
          canEdit
          onRequestCapture={() => {}}
          selectedTaskId={null}
          onSelectTask={() => {}}
          filterActive={opts.filterActive}
          onClearFilters={onClearFilters}
          api={api as never}
        />
      </TooltipProvider>,
    );
    return { onClearFilters };
  }

  it("shows a skeleton before the first load, never an empty message", () => {
    renderStates({ loaded: false });
    expect(screen.getByRole("status", { name: "Loading tasks" })).toBeTruthy();
    expect(screen.queryByText(/Nothing here yet|No tasks/)).toBeNull();
  });

  it("an empty filter says “No tasks match”, and Clear filters clears it", () => {
    const { onClearFilters } = renderStates({ loaded: true, filterActive: true });
    expect(screen.getByText("No tasks match")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("an empty scope names it and teaches capture", () => {
    renderStates({ loaded: true });
    expect(screen.getByText("No tasks in Work")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a task" })).toBeTruthy();
    expect(screen.queryByText("Nothing here yet")).toBeNull();
  });
});

// MOD-121: the list takes focus on load so j/k work at once, but a browser
// counts that script focus as keyboard focus and drew a 2 px ring around the
// whole list. jsdom has no :focus-visible, so this pins the quiet marker and
// the class that drops the ring while it's there; the ring itself is checked
// live (getComputedStyle's box-shadow, on load and after a key).
describe("the list's focus on load (MOD-121)", () => {
  const quiet = (grid: HTMLElement) => grid.hasAttribute("data-quiet-focus");
  // jsdom says the document has no focus while an element blurs; a browser says
  // so only when the window itself lost focus. Model the browser.
  let hasFocus: ReturnType<typeof rs.spyOn>;
  beforeEach(() => {
    hasFocus = rs.spyOn(document, "hasFocus").mockReturnValue(true);
  });
  afterEach(() => hasFocus.mockRestore());

  it("takes focus quietly, and j/k still move the selection", async () => {
    const { grid } = renderList();
    await wait();
    expect(document.activeElement).toBe(grid);
    expect(quiet(grid)).toBe(true);
    expect(grid.className).toMatch(/(^|\s)data-\[quiet-focus\]:focus-visible:ring-0(\s|$)/);
    expect(grid.className).toMatch(/(^|\s)focus-visible:ring-2(\s|$)/);

    expect(selectedTitle()).toBe("Alpha");
    fireEvent.keyDown(grid, { key: "j", code: "KeyJ" });
    expect(selectedTitle()).toBe("Beta");
    // A key on the list is keyboard use: the ring shows from here on.
    expect(quiet(grid)).toBe(false);
    fireEvent.keyDown(grid, { key: "k", code: "KeyK" });
    expect(selectedTitle()).toBe("Alpha");
  });

  it("a lone modifier leaves it quiet; the list's own ⌘ keys don't", async () => {
    const { grid } = renderList();
    await wait();
    fireEvent.keyDown(grid, { key: "Meta", code: "MetaLeft", metaKey: true });
    fireEvent.keyDown(grid, { key: "Shift", code: "ShiftLeft", shiftKey: true });
    expect(quiet(grid)).toBe(true);
    // ⌘A selects every row: the list is in use from the keyboard.
    fireEvent.keyDown(grid, { key: "a", code: "KeyA", metaKey: true });
    expect(quiet(grid)).toBe(false);
  });

  it("rings as usual once focus has left and come back", async () => {
    const { grid } = renderList();
    await wait();
    act(() => grid.blur());
    expect(quiet(grid)).toBe(false);
    act(() => grid.focus());
    expect(quiet(grid)).toBe(false);
  });

  it("stays quiet while the window is away (another app), so coming back rings nothing", async () => {
    const { grid } = renderList();
    await wait();
    hasFocus.mockReturnValue(false);
    fireEvent.blur(grid);
    expect(quiet(grid)).toBe(true);
  });

  it("ends the quiet focus when a row's button takes focus (the list's own blur)", async () => {
    const { grid } = renderList();
    await wait();
    const checkOff = rowOf("Beta").querySelector<HTMLElement>('[aria-label="Mark as done"]')!;
    act(() => checkOff.focus());
    expect(quiet(grid)).toBe(false);
  });

  it("leaves focus where it is when something already holds it", async () => {
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    const { grid } = renderList();
    await wait();
    expect(document.activeElement).toBe(field);
    expect(quiet(grid)).toBe(false);
    field.remove();
  });
});
