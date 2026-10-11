// TV-D4 on the real TaskRow: a task in someone else's queue shows their claim
// (D4-2), my own queued task shows my toggle, and rows in My tasks leave the
// assignee avatar out (D4-4).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const PEOPLE = {
  u1: { userId: "u1", name: "Me", avatarUrl: null, isMe: true, canTakeTasks: true },
  u2: { userId: "u2", name: "Mike", avatarUrl: null, isMe: false, canTakeTasks: true },
  u3: { userId: "u3", name: "Ola", avatarUrl: null, isMe: false, canTakeTasks: true },
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

import { TooltipProvider } from "../../../components/ui/tooltip";
import { makeTask } from "../helpers";
import type { Task } from "../model";
import { QueueToggle } from "./queue-toggle";
import { type TaskFacts, taskFactsOf } from "./row-facts";
import { TaskBoardView } from "./task-board-view";
import { CardBody } from "./task-card";
import { TaskListView } from "./task-list-view";
import { TaskRow } from "./task-row";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "b1", title: `Task ${id}`, position: id }),
    id,
    assigneeId: "u1",
    ...over,
  };
}

function api(queued: string[], claims: Record<string, string[]>) {
  return {
    loaded: true,
    queuedTaskIds: new Set(queued),
    queueClaims: new Map(Object.entries(claims)),
    toggleQueue: rs.fn(),
  };
}

/** A row's facts with nothing on it but the queue. */
function facts(a: ReturnType<typeof api>, t: Task): TaskFacts {
  return taskFactsOf(t, {
    ...a,
    blockedTaskIds: new Set(),
    blockersByTask: new Map(),
    tagsByTask: new Map(),
    subtaskProgressByTask: new Map(),
    statusById: new Map(),
  });
}

const noActions = {
  toggleDone: rs.fn(),
  patchTask: rs.fn(),
  toggleQueue: rs.fn(),
  skipOccurrence: rs.fn(),
  setTaskParent: rs.fn(),
  deleteTask: rs.fn(),
} as never;

function renderToggle(t: Task, a: ReturnType<typeof api>, canEdit = true) {
  return render(
    <TooltipProvider>
      <QueueToggle
        task={t}
        queued={a.queuedTaskIds.has(t.id)}
        claims={a.queueClaims.get(t.id) ?? []}
        onToggle={a.toggleQueue}
        canEdit={canEdit}
      />
    </TooltipProvider>,
  );
}

describe("QueueToggle (D4-1, D4-2)", () => {
  it("is my plain toggle when nobody has the task queued", () => {
    const a = api([], {});
    renderToggle(task("t1"), a);
    const button = screen.getByRole("button", { name: "Add to queue" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(a.toggleQueue).toHaveBeenCalledWith("t1");
  });

  it("shows Mike's claim when the task is in his queue, and still adds it to mine", () => {
    const a = api([], { t1: ["u2"] });
    renderToggle(task("t1"), a);
    const button = screen.getByRole("button", { name: "Add to queue. In Mike’s queue" });
    // The ringed avatar stands in for the queue icon.
    expect(button.querySelector('[data-slot="avatar"]')).toBeTruthy();
    fireEvent.click(button);
    expect(a.toggleQueue).toHaveBeenCalledWith("t1");
  });

  it("names everyone who has it queued", () => {
    renderToggle(task("t1"), api([], { t1: ["u2", "u3"] }));
    expect(
      screen.getByRole("button", { name: "Add to queue. In Mike’s and Ola’s queues" }),
    ).toBeTruthy();
  });

  it("when it's in mine too, shows my toggle with Mike's claim beside it", () => {
    const { container } = renderToggle(task("t1"), api(["t1"], { t1: ["u2"] }));
    const button = screen.getByRole("button", { name: "Remove from queue. Also in Mike’s queue" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.querySelector('[data-slot="avatar"]')).toBeNull();
    // The claim stays visible next to the toggle (decoration: the label says it).
    const beside = container.querySelector('[aria-hidden="true"] [data-slot="avatar"]');
    expect(beside).toBeTruthy();
  });

  it("gives done and archived tasks no queue mark (they can't be queued)", () => {
    const { container } = renderToggle(task("t1", { status: "done" }), api([], { t1: ["u2"] }));
    expect(container.textContent).toBe("");
    cleanup();
    const archived = renderToggle(task("t2", { status: "archived" }), api([], {}));
    expect(archived.container.textContent).toBe("");
  });

  it("view-only members see the claim without an action", () => {
    renderToggle(task("t1"), api([], { t1: ["u2"] }), false);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("img", { name: "In Mike’s queue" })).toBeTruthy();
  });

  it("renders nothing for a view-only member when nobody has it queued", () => {
    const { container } = renderToggle(task("t1"), api([], {}), false);
    expect(container.textContent).toBe("");
  });
});

describe("TaskRow in My tasks (D4-4)", () => {
  function renderRow(showAssignee: boolean) {
    const t = task("t1", { assigneeId: "u1" });
    return render(
      <TooltipProvider>
        <TaskRow
          task={t}
          bucketName="Work"
          inboxId={null}
          showBucket={false}
          selected={false}
          editing={false}
          command={null}
          canEdit={false}
          onSelect={() => {}}
          onStartEdit={() => {}}
          onEndEdit={() => {}}
          onClearCommand={() => {}}
          onRequestCommand={() => {}}
          showAssignee={showAssignee}
          facts={facts(api([], {}), t)}
          actions={noActions}
        />
      </TooltipProvider>,
    );
  }

  it("shows the assignee avatar elsewhere in a team workspace", () => {
    renderRow(true);
    expect(screen.getByLabelText("Assignee: Me")).toBeTruthy();
  });

  it("leaves it out in My tasks", () => {
    renderRow(false);
    expect(screen.queryByLabelText("Assignee: Me")).toBeNull();
  });
});

describe("List, Board and cards in My tasks (D4-4)", () => {
  const tasks = [task("t1"), task("t2", { bucketId: "b2" })];
  const viewApi = {
    tasks,
    subtasksByParent: new Map(),
    subtaskProgressByTask: new Map(),
    tagsByTask: new Map(),
    blockedTaskIds: new Set(),
    blockersByTask: new Map(),
    statusById: new Map(),
    toggleDone: rs.fn(),
    patchTask: rs.fn(),
    deleteTask: rs.fn(),
    setTaskParent: rs.fn(),
    skipOccurrence: rs.fn(),
    ...api([], {}),
  };
  const shared = (selection: string) => ({
    tasks,
    scopeTitle: selection === "mine" ? "My tasks" : "All",
    selection,
    view: "list" as const,
    onViewChange: () => {},
    buckets: [],
    inbox: null,
    bucketNameById: () => "Work",
    canEdit: true,
    onRequestCapture: () => {},
    selectedTaskId: null,
    onSelectTask: () => {},
    api: viewApi as never,
  });
  const avatars = () => screen.queryAllByLabelText(/^Assignee:/).length;

  it("the List leaves the avatar out in My tasks and keeps it in All", () => {
    render(
      <TooltipProvider>
        <TaskListView {...shared("mine")} groupBy="none" />
      </TooltipProvider>,
    );
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(avatars()).toBe(0);
    cleanup();
    render(
      <TooltipProvider>
        <TaskListView {...shared("all")} groupBy="none" />
      </TooltipProvider>,
    );
    expect(avatars()).toBe(2);
  });

  it("the Board leaves the avatar out in My tasks and keeps it in All", () => {
    render(
      <TooltipProvider>
        <TaskBoardView {...shared("mine")} boardGroupBy="status" />
      </TooltipProvider>,
    );
    expect(screen.getByText("Task t1")).toBeTruthy();
    expect(avatars()).toBe(0);
    cleanup();
    render(
      <TooltipProvider>
        <TaskBoardView {...shared("all")} boardGroupBy="status" />
      </TooltipProvider>,
    );
    expect(avatars()).toBe(2);
  });

  it("a card body follows showAssignee", () => {
    const body = (showAssignee: boolean) => (
      <TooltipProvider>
        <CardBody
          task={tasks[0]}
          bucketName="Work"
          inboxId={null}
          showBucket={false}
          showAssignee={showAssignee}
          canEdit={false}
          facts={facts(api([], {}), tasks[0])}
          parentTitle={null}
          actions={noActions}
        />
      </TooltipProvider>
    );
    render(body(false));
    expect(avatars()).toBe(0);
    cleanup();
    render(body(true));
    expect(avatars()).toBe(1);
  });
});
