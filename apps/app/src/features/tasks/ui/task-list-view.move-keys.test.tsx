// TV-U4 on the real TaskListView: `>` nests under the row above, `<` brings a
// subtask out right after its parent, ⌥⇧↑/↓ move in the manual order — each
// one drop with its Undo label — and a sorted project, or a view across
// projects, refuses the move with the right words (default m, default k).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

const toastMock = rs.hoisted(() =>
  Object.assign(
    rs.fn((..._args: unknown[]) => "toast"),
    { dismiss: rs.fn(), error: rs.fn() },
  ),
);
rs.mock("sonner", () => ({ toast: toastMock }));
rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import type { TaskOrder } from "../display";
import { makeTask } from "../helpers";
import type { Task } from "../model";
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
  toastMock.mockClear();
});

function task(id: string, title: string, position: string, extra: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "p1", title, position }),
    id,
    ...extra,
  };
}

const A = task("a", "Alpha", "0000000010");
const S = task("s", "Sub", "0000000015", { parentId: "a" });
const B = task("b", "Bravo", "0000000020");
const C = task("c", "Charlie", "0000000030", { bucketId: "p2" });

async function renderList(opts: {
  selection?: string;
  order?: TaskOrder;
  selected: string;
  tasks?: Task[];
  subtasks?: "nested" | "flat";
  children?: Task[];
}) {
  const tasks = opts.tasks ?? [A, S, B];
  // Alpha's subtasks live in the store beside the scope's tasks (the
  // workspace has them whether this view lists them or not).
  const children = opts.children ?? [S];
  const dropTask = rs.fn(async () => true);
  const onManualOrder = rs.fn();
  const commands = {
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
    patchTask: rs.fn(),
    deleteTask: rs.fn(),
    setTaskParent: rs.fn(),
    skipOccurrence: rs.fn(),
    dropTask,
  };
  function Harness() {
    const [selected, setSelected] = useState<string | null>(opts.selected);
    return (
      <TooltipProvider>
        <TaskListView
          tasks={tasks}
          scopeTitle="Work"
          selection={opts.selection ?? "p1"}
          view="list"
          onViewChange={() => {}}
          groupBy="none"
          buckets={[]}
          inbox={null}
          bucketNameById={(id) => (id === "p2" ? "Website" : "Work")}
          canEdit
          onRequestCapture={() => {}}
          selectedTaskId={selected}
          onSelectTask={setSelected}
          order={opts.order ?? "manual"}
          subtasks={opts.subtasks ?? "flat"}
          onManualOrder={onManualOrder}
        />
      </TooltipProvider>
    );
  }
  await renderWithTasks(<Harness />, {
    seed: { tasks: [...tasks, ...children.filter((c) => !tasks.includes(c))] },
    workspaceId: "w",
    commands,
  });
  return { dropTask, onManualOrder, grid: screen.getByRole("grid") };
}

const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

describe("the move keys (TV-U4)", () => {
  it("`>` makes the selected task a subtask of the row above", async () => {
    const { dropTask, grid } = await renderList({ selected: "b", tasks: [A, B] });
    await wait();
    fireEvent.keyDown(grid, { key: ">", shiftKey: true });
    expect(dropTask).toHaveBeenCalledWith({ taskId: "b", parentId: "a" }, "Moved under “Alpha”");
  });

  it("`>` under a task in another project moves it there", async () => {
    const { dropTask, grid } = await renderList({ selection: "all", selected: "b", tasks: [C, B] });
    await wait();
    fireEvent.keyDown(grid, { key: ">", shiftKey: true });
    expect(dropTask).toHaveBeenCalledWith(
      { taskId: "b", parentId: "c", bucketId: "p2" },
      "Moved under “Charlie”",
    );
  });

  it("`<` brings a subtask out, right after its parent", async () => {
    const { dropTask, grid } = await renderList({ selected: "s" });
    await wait();
    fireEvent.keyDown(grid, { key: "<", shiftKey: true });
    const [write, label] = dropTask.mock.calls[0] as unknown as [
      { taskId: string; parentId: null; position: string },
      string,
    ];
    expect(label).toBe("Moved out of “Alpha”");
    expect(write.parentId).toBeNull();
    expect(write.position > A.position && write.position < B.position).toBe(true);
  });

  it("⌥⇧↓ / ⌥⇧↑ move one place in the manual order", async () => {
    const { dropTask, grid } = await renderList({ selected: "a", tasks: [A, B] });
    await wait();
    fireEvent.keyDown(grid, { key: "ArrowDown", altKey: true, shiftKey: true });
    const [down, downLabel] = dropTask.mock.calls[0] as unknown as [{ position: string }, string];
    expect(downLabel).toBe("Moved down");
    expect(down.position > B.position).toBe(true);
  });

  it("a sorted project asks to switch back instead", async () => {
    const { dropTask, onManualOrder, grid } = await renderList({
      selected: "b",
      tasks: [A, B],
      order: "due",
    });
    await wait();
    fireEvent.keyDown(grid, { key: "ArrowUp", altKey: true, shiftKey: true });
    expect(dropTask).not.toHaveBeenCalled();
    const [label, opts] = toastMock.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(label).toBe("Sorted by due date");
    expect(opts.action.label).toBe("Back to manual order");
    opts.action.onClick();
    expect(onManualOrder).toHaveBeenCalled();
  });

  it("a nested subtask moves among its siblings in any view order (TV-U10)", async () => {
    const S2 = task("s2", "Sub two", "0000000017", { parentId: "a" });
    for (const view of [
      { order: "due" as const },
      { selection: "mine", order: "manual" as const },
    ]) {
      const { dropTask, grid } = await renderList({
        ...view,
        selected: "s2",
        tasks: [A, S, S2, B],
        children: [S, S2],
        subtasks: "nested",
      });
      await wait();
      fireEvent.keyDown(grid, { key: "ArrowUp", altKey: true, shiftKey: true });
      const [write, label] = dropTask.mock.calls[0] as unknown as [
        { taskId: string; position: string },
        string,
      ];
      expect(label).toBe("Moved up");
      expect(write.taskId).toBe("s2");
      expect(write.position > A.position && write.position < S.position).toBe(true);
      cleanup();
    }
  });

  it("a view across projects has no manual order to move in", async () => {
    const { dropTask, grid } = await renderList({
      selection: "mine",
      selected: "b",
      tasks: [A, B],
    });
    await wait();
    fireEvent.keyDown(grid, { key: "ArrowUp", altKey: true, shiftKey: true });
    expect(dropTask).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith("Tasks keep their order inside each project.");
  });
});
