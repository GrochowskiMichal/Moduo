// tasks-v2 Q1-1/Q1-2 on the real TaskListView + TaskRow: a row's buttons keep
// their Space/Enter (no keyboard drag, no list action), list keys hand focus
// back to the list, and keys typed in a row's popover never reach the list.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
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
    tasks,
    queuedTaskIds: new Set(queue ? ["a", "b", "c"] : []),
    queueClaims: new Map(),
    subtasksByParent: new Map(),
    subtaskProgressByTask: new Map(),
    tagsByTask: new Map(),
    blockedTaskIds: new Set(),
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
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
          onGroupByChange={() => {}}
          buckets={[]}
          inbox={inbox}
          bucketNameById={() => "Work"}
          canEdit
          onRequestCapture={() => {}}
          selectedTaskId={selected}
          onSelectTask={setSelected}
          reorderable={queue}
          onReorder={() => {}}
          nestable={!queue}
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
    const toggle = rowOf("Beta").querySelector<HTMLElement>('[aria-label="Remove from queue"]')!;
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
    // The due editor is the kit's date picker now (DS-6), not a native date
    // input: aim the keys at whatever it focused on open.
    const popover = document.querySelector<HTMLElement>('[data-slot="popover-content"]')!;
    const input = document.activeElement as HTMLElement;
    expect(popover.contains(input)).toBe(true);

    fireEvent.keyDown(input, SPACE);
    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Backspace", code: "Backspace", metaKey: true });

    expect(api.toggleDone).not.toHaveBeenCalled();
    expect(api.deleteTask).not.toHaveBeenCalled();
    expect(selectedTitle()).toBe("Alpha");
  });
});
