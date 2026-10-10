// The row's context menu on the real TaskListView. Its "Rename", "Schedule…",
// "Set due date…" and "Move to bucket…" used to open their editor or popover
// and lose it a tick later, when the closing menu handed focus back to the list.
// Also covers the other ways in (s/d/b, a click on a chip), Esc handing focus
// back to the list, and the title editor saving once on Enter and not on Esc.

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

/** The real list in "All", where every row shows its bucket pill. */
function renderList({ canEdit = true }: { canEdit?: boolean } = {}) {
  const tasks = [task("a", "Alpha"), task("b", "Beta", { dueDate: "2026-10-20T00:00:00.000Z" })];
  const api = {
    tasks,
    queuedTaskIds: new Set(),
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
          scopeTitle="All"
          selection="all"
          view="list"
          onViewChange={() => {}}
          groupBy="none"
          onGroupByChange={() => {}}
          buckets={[]}
          inbox={inbox}
          bucketNameById={() => "Work"}
          canEdit={canEdit}
          onRequestCapture={() => {}}
          selectedTaskId={selected}
          onSelectTask={setSelected}
          api={api as never}
        />
      </TooltipProvider>
    );
  }
  render(
    <>
      <Harness />
      <input aria-label="Elsewhere" />
    </>,
  );
  return { api, grid: screen.getByRole("grid") };
}

// Long enough for the menu to unmount and for Radix's focus return (a 0 ms timer).
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));
const rowOf = (title: string) =>
  screen.getByRole("button", { name: title }).closest('[role="row"]') as HTMLElement;
// The date editors are popovers; the bucket picker is a radio menu (DS-6).
const popover = () =>
  document.querySelector<HTMLElement>(
    '[data-slot="popover-content"], [data-slot="dropdown-menu-content"]',
  );
const rowMenu = () => document.querySelector('[data-slot="context-menu-content"]');
const pressEscape = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" });

async function chooseFromRowMenu(title: string, item: string) {
  fireEvent.contextMenu(rowOf(title));
  await settle();
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
  await settle();
}

// What each popover shows: its field label, or the bucket list's only option.
const POPOVERS = [
  { item: "Schedule…", key: "s", text: "Scheduled time" },
  { item: "Set due date…", key: "d", text: "Due date" },
  { item: "Move to bucket…", key: "b", text: "Inbox" },
] as const;

describe("TaskRow context menu", () => {
  for (const { item, text } of POPOVERS) {
    it(`"${item}" opens its popover and it stays open once the menu has closed`, async () => {
      renderList();
      await settle();

      await chooseFromRowMenu("Alpha", item);

      expect(rowMenu()).toBeNull();
      expect(popover()?.textContent).toContain(text);
      expect(popover()?.contains(document.activeElement)).toBe(true);
    });
  }

  it('"Rename" opens the title editor and it stays open until Enter, which saves once', async () => {
    const { api, grid } = renderList();
    await settle();

    await chooseFromRowMenu("Alpha", "Rename");

    const input = screen.getByDisplayValue("Alpha");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Alpha renamed" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await settle();
    expect(api.patchTask).toHaveBeenCalledTimes(1);
    expect(api.patchTask).toHaveBeenCalledWith("a", { title: "Alpha renamed" });
    expect(document.activeElement).toBe(grid);
  });

  it("Esc in the title editor throws the draft away", async () => {
    const { api, grid } = renderList();
    await settle();
    await chooseFromRowMenu("Alpha", "Rename");

    const input = screen.getByDisplayValue("Alpha");
    fireEvent.change(input, { target: { value: "Not this" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
    await settle();

    expect(api.patchTask).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Not this")).toBeNull();
    expect(document.activeElement).toBe(grid);
  });

  it("Esc closes a popover opened from the menu and hands focus back to the list", async () => {
    const { grid } = renderList();
    await settle();
    await chooseFromRowMenu("Alpha", "Set due date…");
    expect(popover()).not.toBeNull();

    pressEscape();
    await settle();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(grid);

    // Closing the menu without a choice opens nothing and returns focus as before.
    fireEvent.contextMenu(rowOf("Alpha"));
    await settle();
    pressEscape();
    await settle();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(grid);
  });

  it("an item that acts in place still hands focus back to the list", async () => {
    const { api, grid } = renderList();
    await settle();

    await chooseFromRowMenu("Beta", "Mark done");

    expect(api.toggleDone).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(grid);
  });
});

describe("TaskRow popovers: the other ways in", () => {
  for (const { key, text } of POPOVERS) {
    it(`"${key}" opens the selected row's popover; Esc hands focus back to the list`, async () => {
      const { grid } = renderList();
      await settle();
      grid.focus();

      fireEvent.keyDown(grid, { key, code: `Key${key.toUpperCase()}` });
      await settle();
      expect(popover()?.textContent).toContain(text);
      expect(popover()?.contains(document.activeElement)).toBe(true);

      pressEscape();
      await settle();
      expect(popover()).toBeNull();
      expect(document.activeElement).toBe(grid);
    });
  }

  it("a click on a chip opens its popover; Esc hands focus back to the list", async () => {
    const { grid } = renderList();
    await settle();
    const chip = rowOf("Beta").querySelector<HTMLElement>('[aria-label^="Due "]')!;

    chip.focus(); // Chromium focuses a clicked button
    fireEvent.click(chip);
    await settle();
    expect(popover()?.textContent).toContain("Due date");
    expect(popover()?.contains(document.activeElement)).toBe(true);

    pressEscape();
    await settle();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(grid);
  });

  it("a second click on the chip closes its popover, and focus stays with the list", async () => {
    const { grid } = renderList();
    await settle();
    const chip = rowOf("Beta").querySelector<HTMLElement>('[aria-label^="Due "]')!;
    fireEvent.click(chip);
    await settle();
    expect(popover()).not.toBeNull();

    // The whole mouse sequence: Radix waits for the click to dismiss, and
    // Chromium focuses the chip on mousedown.
    fireEvent.pointerDown(chip, { button: 0, pointerType: "mouse" });
    fireEvent.mouseDown(chip, { button: 0 });
    chip.focus();
    fireEvent.pointerUp(chip, { button: 0, pointerType: "mouse" });
    fireEvent.mouseUp(chip, { button: 0 });
    fireEvent.click(chip, { button: 0 });
    await settle();

    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(grid);
  });

  it("clicking into another field closes the popover and leaves focus there", async () => {
    renderList();
    await settle();
    const chip = rowOf("Beta").querySelector<HTMLElement>('[aria-label^="Due "]')!;
    fireEvent.click(chip);
    await settle();
    const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" });

    fireEvent.pointerDown(elsewhere, { button: 0, pointerType: "mouse" });
    fireEvent.mouseDown(elsewhere, { button: 0 });
    elsewhere.focus();
    fireEvent.pointerUp(elsewhere, { button: 0, pointerType: "mouse" });
    fireEvent.mouseUp(elsewhere, { button: 0 });
    fireEvent.click(elsewhere, { button: 0 });
    await settle();

    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe("TaskRow read-only", () => {
  it("a chip opens nothing and right-click opens no menu", async () => {
    renderList({ canEdit: false });
    await settle();
    const chip = rowOf("Beta").querySelector<HTMLElement>('[aria-label^="Due "]')!;

    fireEvent.click(chip);
    fireEvent.contextMenu(rowOf("Beta"));
    await settle();

    expect(popover()).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
