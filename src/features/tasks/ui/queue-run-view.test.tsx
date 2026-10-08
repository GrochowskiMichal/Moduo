// The Queue view (TV-F2): the line-up (capacity, stale line, mode, Start run /
// ⌘↵) and the run (Now, Up next, ⏎ = Done, Skip, End run). F2-1, F2-2.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({
    assignees: [{ userId: "u1", name: "Me", avatarUrl: null, isMe: true, canTakeTasks: true }],
    currentUserId: "u1",
    byId: () => null,
  }),
  previewAssign: async () => null,
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { __resetFocusEngineForTest, attachFocusUser, getFocusSession } from "../../focus/engine";
import { __resetQueueRunForTest, attachRunUser, getQueueRunState } from "../../focus/run";
import type { FocusRunRuntime } from "../../focus/run-model";
import { makeTask } from "../helpers";
import { useQueueRun } from "../hooks/use-queue-run";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task, TaskQueueEntry } from "../model";
import { __resetLineUpKeptForTest, QueueRunView } from "./queue-run-view";

const WS = "w1";
const DAY = 86_400_000;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

const offline: FocusRunRuntime = {
  latestRun: async () => null,
  startRun: async () => null,
  saveRun: async () => null,
  endRun: async () => null,
  listClaims: async () => [],
  keepLineUp: async () => null,
};

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: WS, bucketId: "b1", title: `Task ${id}`, position: id }),
    id,
    ...over,
  };
}

function entry(taskId: string, ageDays: number): TaskQueueEntry {
  const at = new Date(Date.now() - ageDays * DAY).toISOString();
  return {
    id: `q-${taskId}`,
    workspaceId: WS,
    userId: "u1",
    taskId,
    position: taskId,
    queuedAt: at,
    updatedAt: at,
  };
}

function makeApi(queued: Task[], ageDays = 0) {
  return {
    loading: false,
    error: null,
    tasks: queued,
    queuedTasks: queued,
    myQueueEntries: queued.map((t) => entry(t.id, ageDays)),
    queueClaims: new Map<string, string[]>(),
    queuedTaskIds: new Set(queued.map((t) => t.id)),
    tagsByTask: new Map(),
    subtasksByParent: new Map(),
    markDone: rs.fn(),
    moveQueuedToEnd: rs.fn(),
    removeFromQueue: rs.fn(),
    reorderQueue: rs.fn(),
    keepLineUp: rs.fn(),
    captureToQueue: rs.fn(),
    toggleDone: rs.fn(),
    logTimeAdjustment: rs.fn(),
    setTimeSpent: rs.fn(),
    toggleQueue: rs.fn(),
    loadActivity: rs.fn(async () => []),
    currentUserId: "u1",
  } as unknown as TasksModuleApi;
}

function Harness({ api }: { api: TasksModuleApi }) {
  const queueRun = useQueueRun({ api, workspaceId: WS, bucketNameById: () => "Inbox" });
  return (
    <TooltipProvider>
      <QueueRunView
        api={api}
        queueRun={queueRun}
        workspaceId={WS}
        runtime={null}
        otherRunWorkspaceName={null}
        bucketNameById={() => "Inbox"}
        parentTitleFor={() => null}
        blockedNoteFor={() => null}
        canEdit
        selectedTaskId={null}
        onSelectTask={() => {}}
        onRequestCapture={() => {}}
        dndMode="internal"
      />
    </TooltipProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  __resetLineUpKeptForTest();
  __resetFocusEngineForTest({ alert: () => {} });
  __resetQueueRunForTest();
  attachFocusUser("u1");
  attachRunUser("u1", { focus: offline }, { subscribe: null });
});

afterEach(() => {
  cleanup();
  __resetQueueRunForTest();
  __resetFocusEngineForTest();
});

describe("the line-up", () => {
  it("numbers my queue, mirrors its size, and Start run starts the run (F2-1)", () => {
    const api = makeApi([task("t1", { durationMinutes: 45 }), task("t2")]);
    render(<Harness api={api} />);
    expect(screen.getByText("2 · ~45m lined up · 1 without estimate")).not.toBeNull();
    expect(screen.getByText("Task t1")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Start run/ }));
    expect(screen.getByRole("heading", { name: "Task t1" })).not.toBeNull();
    expect(screen.getByText(/Running · 0 of 2 done/)).not.toBeNull();
    expect(getFocusSession()).toMatchObject({ taskId: "t1", running: true });
  });

  it("⌘↵ starts a run from the Queue", () => {
    render(<Harness api={makeApi([task("t1")])} />);
    act(() => {
      fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    });
    expect(getQueueRunState().run?.nowTaskId).toBe("t1");
  });

  it("an empty queue can't start a run", () => {
    render(<Harness api={makeApi([])} />);
    expect(screen.getByText("Nothing lined up.")).not.toBeNull();
    expect((screen.getByRole("button", { name: /Start run/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("Pomodoro or Stopwatch is remembered and used by the next run", () => {
    render(<Harness api={makeApi([task("t1")])} />);
    fireEvent.click(screen.getByRole("radio", { name: "Stopwatch" }));
    expect(JSON.parse(localStorage.getItem("moduo.focus") ?? "{}").runMode).toBe("stopwatch");
    fireEvent.click(screen.getByRole("button", { name: /Start run/ }));
    expect(getFocusSession().pomodoro).toBe(false);
    expect(getQueueRunState().run?.mode).toBe("stopwatch");
  });

  it("a line-up untouched for days asks once; Keep all marks it looked at", () => {
    const api = makeApi([task("t1"), task("t2")], 4);
    render(<Harness api={api} />);
    expect(screen.getByText(/Lined up 4 days ago/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep all" }));
    expect(api.keepLineUp).toHaveBeenCalled();
    expect(screen.queryByText(/Lined up 4 days ago/)).toBeNull();
  });

  it("Review offers Remove on each row, and Done keeps the rest", () => {
    const api = makeApi([task("t3"), task("t4")], 5);
    render(<Harness api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Remove from queue" })[0]);
    expect(api.removeFromQueue).toHaveBeenCalledWith("t3");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(api.keepLineUp).toHaveBeenCalled();
  });

  it("a fresh line-up doesn't ask", () => {
    render(<Harness api={makeApi([task("t1")], 1)} />);
    expect(screen.queryByText(/Lined up/)).toBeNull();
  });
});

describe("the run (F2-1, F2-2)", () => {
  it("shows Now and Up next; ⏎ is Done", () => {
    const api = makeApi([task("t1"), task("t2"), task("t3")]);
    render(<Harness api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /Start run/ }));
    expect(screen.getByText("Up next")).not.toBeNull();
    expect(screen.getByText("Task t2")).not.toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(api.markDone).toHaveBeenCalledWith("t1");
    expect(getFocusSession().taskId).toBe("t2");
  });

  it("Skip sends Now to the end; End run goes back to the line-up", () => {
    const api = makeApi([task("t1"), task("t2")]);
    render(<Harness api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /Start run/ }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(api.moveQueuedToEnd).toHaveBeenCalledWith("t1");
    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    expect(screen.getByRole("button", { name: /Start run/ })).not.toBeNull();
    expect(screen.getByText(/Run ended · 0 done/)).not.toBeNull();
    expect(getFocusSession().tracking).toBe(false);
  });

  it("Pause and Resume", () => {
    render(<Harness api={makeApi([task("t1")])} />);
    fireEvent.click(screen.getByRole("button", { name: /Start run/ }));
    fireEvent.click(screen.getByRole("button", { name: "Pause run" }));
    expect(screen.getByText(/Paused · 0 of 1 done/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume run" }));
    expect(screen.getByText(/Running · 0 of 1 done/)).not.toBeNull();
  });
});
