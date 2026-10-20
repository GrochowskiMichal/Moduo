// AT-3 on the real List and Board: files dropped on a row or a card attach to
// that task, with the shared drop look on the target (AT3-1); the quiet 📎
// count after a title, hidden at 0 (AT3-3).

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

const PEOPLE = {
  u1: {
    userId: "u1",
    name: "You",
    fullName: "Alex Rivera",
    avatarUrl: null,
    isMe: true,
    canTakeTasks: true,
  },
} as const;

rs.mock("../assignees", () => ({
  useAssignees: () => ({
    assignees: Object.values(PEOPLE),
    currentUserId: "u1",
    byId: (id: string | null) => (id ? (PEOPLE[id as keyof typeof PEOPLE] ?? null) : null),
  }),
  previewAssign: async () => null,
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

const attached: Array<Record<string, unknown>> = [];
rs.mock("../../attachments/attach-to-task", () => ({
  attachFilesToTask: async (input: Record<string, unknown>) => {
    attached.push(input);
  },
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { resetTagStore } from "../../tags/store";
import { makeTask } from "../helpers";
import type { Tag, Task } from "../model";
import { type FakeTasksSeed, tagLink } from "../testing/fake-tasks";
import { renderWithTasks } from "../testing/render-with-tasks";
import { fileDropTaskId } from "./row-drop";
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
beforeEach(() => {
  attached.length = 0;
});
afterEach(() => {
  cleanup();
  // The tag store is per workspace, not per render: no tags carry over.
  resetTagStore();
});

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "b1", title: `Task ${id}`, position: id }),
    id,
    assigneeId: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** The List over a store holding these tasks (or `seed`'s rows), as the page has it (A4). */
async function renderList(tasks: Task[], opts: { canEdit?: boolean; seed?: FakeTasksSeed } = {}) {
  const onSelectTask = rs.fn();
  const view = await renderWithTasks(
    <TooltipProvider>
      <TaskListView
        tasks={tasks}
        scopeTitle="Work"
        selection="b1"
        view="list"
        onViewChange={() => {}}
        groupBy="none"
        buckets={[]}
        inbox={null}
        bucketNameById={() => "Work"}
        canEdit={opts.canEdit ?? true}
        onRequestCapture={() => {}}
        selectedTaskId={null}
        onSelectTask={onSelectTask}
      />
    </TooltipProvider>,
    { seed: opts.seed ?? { tasks }, workspaceId: "w" },
  );
  return { onSelectTask, store: view.store };
}

async function renderBoard(tasks: Task[]) {
  await renderWithTasks(
    <TooltipProvider>
      <TaskBoardView
        tasks={tasks}
        scopeTitle="Work"
        selection="b1"
        view="board"
        onViewChange={() => {}}
        boardGroupBy="status"
        buckets={[]}
        inbox={null}
        bucketNameById={() => "Work"}
        canEdit
        onRequestCapture={() => {}}
        selectedTaskId={null}
        onSelectTask={() => {}}
      />
    </TooltipProvider>,
    { seed: { tasks }, workspaceId: "w" },
  );
}

const STAMP = "2026-01-01T00:00:00.000Z";
const file = (id: string, taskId: string) => ({
  id,
  taskId,
  status: "ready",
  updatedAt: STAMP,
  deletedAt: null,
});
const comment = (id: string, taskId: string) => ({ id, taskId, updatedAt: STAMP, deletedAt: null });
const tag = (id: string, name: string): Tag => ({
  id,
  workspaceId: "w",
  ownerId: "u1",
  name,
  color: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  deletedAt: null,
});

const shot = () => new File([new Uint8Array(4)], "shot.png", { type: "image/png" });

/** A drag carrying files, as the browser hands it to dragover/drop. */
function fileDrag(files: File[]) {
  return {
    dataTransfer: {
      types: ["Files"],
      files,
      items: files.map((f) => ({ kind: "file", getAsFile: () => f })),
      dropEffect: "none",
    },
  };
}

/** A text drag (not files): the rows ignore it. */
const textDrag = { dataTransfer: { types: ["text/plain"], files: [], items: [] } };

const rowEl = (title: string) => screen.getByText(title).closest("[data-task-id]") as HTMLElement;
const lit = (el: HTMLElement) => el.className.includes("ring-primary/60");

describe("fileDropTaskId (AT3-1: hit-testing the row under the pointer)", () => {
  it("finds the nearest row or card around the pointer's target", () => {
    const row = document.createElement("div");
    row.setAttribute("data-task-id", "t1");
    const inner = document.createElement("span");
    row.appendChild(inner);
    document.body.appendChild(row);
    expect(fileDropTaskId(inner)).toBe("t1");
    expect(fileDropTaskId(row)).toBe("t1");
    expect(fileDropTaskId(document.body)).toBeNull();
    expect(fileDropTaskId(null)).toBeNull();
    row.remove();
  });
});

describe("List rows take file drops (AT3-1)", () => {
  it("lights the row under a file drag, moves with it, and attaches the drop to that task", async () => {
    const { onSelectTask } = await renderList([task("a"), task("b")]);
    const b = rowEl("Task b");
    fireEvent.dragOver(screen.getByText("Task a"), fileDrag([shot()]));
    expect(lit(rowEl("Task a"))).toBe(true);
    expect(lit(b)).toBe(false);
    fireEvent.dragOver(screen.getByText("Task b"), fileDrag([shot()]));
    expect(lit(rowEl("Task a"))).toBe(false);
    expect(lit(rowEl("Task b"))).toBe(true);
    fireEvent.drop(screen.getByText("Task b"), fileDrag([shot()]));
    await Promise.resolve();
    expect(lit(rowEl("Task b"))).toBe(false);
    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({
      workspaceId: "w",
      taskId: "b",
      title: "Task b",
      userId: "u1",
    });
    const call = attached[0] as { files: File[]; onOpen: () => void };
    expect(call.files[0]?.name).toBe("shot.png");
    // "Open" in the toast selects the task (its strip shows the upload).
    call.onOpen();
    expect(onSelectTask).toHaveBeenCalledWith("b");
  });

  it("ignores a drag that carries no files", async () => {
    await renderList([task("a")]);
    fireEvent.dragOver(screen.getByText("Task a"), textDrag);
    expect(lit(rowEl("Task a"))).toBe(false);
    fireEvent.drop(screen.getByText("Task a"), textDrag);
    expect(attached).toHaveLength(0);
  });

  it("takes no files where the view is read-only", async () => {
    await renderList([task("a")], { canEdit: false });
    fireEvent.dragOver(screen.getByText("Task a"), fileDrag([shot()]));
    expect(lit(rowEl("Task a"))).toBe(false);
    fireEvent.drop(screen.getByText("Task a"), fileDrag([shot()]));
    expect(attached).toHaveLength(0);
  });

  it("a drop on a task still waiting to sync waits with it", async () => {
    // Captured offline: the task waits in the store's outbox, not on the server.
    const { store } = await renderList([task("a")], { seed: {} });
    await act(async () => {
      store.wentOffline();
      await store.sendCreate(task("a"));
    });
    expect(store.getSnapshot().pendingTaskIds.has("a")).toBe(true);
    fireEvent.drop(screen.getByText("Task a"), fileDrag([shot()]));
    await Promise.resolve();
    expect(attached[0]).toMatchObject({ taskId: "a", awaitTask: true });
  });
});

describe("Board cards take file drops (AT3-1)", () => {
  it("lights the card under a file drag and attaches the drop to it", async () => {
    await renderBoard([task("a"), task("b")]);
    fireEvent.dragOver(screen.getByText("Task b"), fileDrag([shot()]));
    expect(lit(rowEl("Task b"))).toBe(true);
    expect(lit(rowEl("Task a"))).toBe(false);
    fireEvent.drop(screen.getByText("Task b"), fileDrag([shot()]));
    await Promise.resolve();
    expect(attached[0]).toMatchObject({ taskId: "b" });
  });
});

describe("The 📎 mark on rows (AT3-3)", () => {
  it("shows the file count after the tags, hidden at 0", async () => {
    const a = task("a");
    await renderList([a, task("b")], {
      seed: {
        tasks: [a, task("b")],
        attachments: [file("f1", "a"), file("f2", "a")],
        comments: [comment("c1", "a"), comment("c2", "a"), comment("c3", "a")],
        tags: [tag("t1", "ui"), tag("t2", "bug")],
        tagLinks: [tagLink("t1", "a", "w"), tagLink("t2", "a", "w")],
      },
    });
    const row = rowEl("Task a");
    expect(screen.getByText("2 files").className).toContain("sr-only");
    // Tags, then files, then comments (tasks-v3 §4).
    const text = row.textContent ?? "";
    expect(text.indexOf("2 tags")).toBeLessThan(text.indexOf("2 files"));
    expect(text.indexOf("2 files")).toBeLessThan(text.indexOf("3 comments"));
    expect(rowEl("Task b").textContent).not.toMatch(/file/);
  });
});
