// TV-F7: the Focus screen on the one time engine (spec §7, AC8.1–8.5, 8.9).
// Carries the old Execute view's guarantees (Done / Skip move the session,
// even when another tab runs the clock) and adds Start, the pills, the
// subtasks' panel and keys, and the empty state's three ways in.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { DEFAULT_FOCUS_PREFS, type FocusPrefs } from "../../../lib/focus-prefs";
import {
  __resetFocusEngineForTest,
  attachFocusUser,
  createFocusEngine,
  FOCUS_STORAGE_PREFIX,
  type FocusEngine,
  getFocusSession,
  setFocusTimer,
} from "../../focus/engine";
import { makeTask } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task, TaskSession } from "../model";
import { FocusView } from "./focus-view";

const USER = "u1";
const WS = "ws-1";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: WS, bucketId: "b1", title: `Task ${id}`, position: id }),
    id,
    ...over,
  };
}

function fakeApi(
  queued: Task[],
  over: { all?: Task[]; sessions?: TaskSession[]; subtasks?: Map<string, Task[]> } = {},
) {
  const all = over.all ?? queued;
  const api = {
    loaded: true,
    tasks: all,
    queuedTasks: queued,
    queuedTaskIds: new Set(queued.map((t) => t.id)),
    buckets: [],
    sections: [],
    sessions: over.sessions ?? [],
    currentUserId: USER,
    blockedTaskIds: new Set<string>(),
    blockersByTask: new Map(),
    subtasksByParent: over.subtasks ?? new Map(),
    focusRefOf: (id: string) => {
      const t = all.find((x) => x.id === id);
      return t ? { id, title: t.title, bucketName: "Inbox", workspaceId: WS } : null;
    },
    markDone: rs.fn(),
    toggleDone: rs.fn(),
    moveQueuedToEnd: rs.fn(),
    addToQueue: rs.fn(),
    removeFromQueue: rs.fn(),
    reorderQueue: rs.fn(),
    focusOnTask: rs.fn(() => true),
  };
  return api as typeof api & TasksModuleApi;
}

function renderView(
  api: TasksModuleApi,
  handlers: { onOpenTask?: (id: string) => void; onSelectTask?: (id: string | null) => void } = {},
) {
  return render(
    <TooltipProvider>
      <FocusView
        api={api}
        workspaceId={WS}
        runtime={null}
        canEdit
        bucketNameById={() => "Inbox"}
        selectedTaskId={null}
        onSelectTask={handlers.onSelectTask ?? (() => {})}
        onOpenTask={handlers.onOpenTask ?? (() => {})}
        panelTaskId={null}
        onRequestCapture={() => {}}
        dndMode="internal"
      />
    </TooltipProvider>,
  );
}

let otherTab: FocusEngine | null = null;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

beforeEach(() => {
  localStorage.clear();
  __resetFocusEngineForTest({ alert: () => {} });
  attachFocusUser(USER);
});

afterEach(() => {
  cleanup();
  otherTab?.dispose();
  otherTab = null;
  __resetFocusEngineForTest();
});

const start = () => fireEvent.click(screen.getByRole("button", { name: /^Start/ }));

describe("Focus: the Now card and the session (AC8.2, AC8.3)", () => {
  it("shows the head of Up next with Start; Start puts the clock on it", () => {
    renderView(fakeApi([task("t1"), task("t2")]));
    const now = screen.getByRole("region", { name: "Now" });
    expect(within(now).getByText("Task t1")).toBeTruthy();
    expect(getFocusSession().tracking).toBe(false);
    start();
    expect(getFocusSession()).toMatchObject({ taskId: "t1", running: true, timer: "per_task" });
    // Per task: one pill on the card, with Pause inside it.
    const pill = document.querySelector('[data-slot="focus-task-pill"]') as HTMLElement;
    expect(pill.getAttribute("aria-label")).toMatch(/^Pause/);
    fireEvent.click(pill);
    expect(getFocusSession().running).toBe(false);
  });

  it("Done on the session's task moves the running session to the next one", () => {
    const api = fakeApi([task("t1"), task("t2")]);
    renderView(api);
    start();
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(api.markDone).toHaveBeenCalledWith("t1");
    expect(getFocusSession()).toMatchObject({ taskId: "t2", running: true });
  });

  it("Done on the last one ends the session (Up next ran out)", () => {
    const api = fakeApi([task("t1")]);
    renderView(api);
    start();
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(getFocusSession().tracking).toBe(false);
  });

  it("Skip sends it to the end of Up next and moves the session on", () => {
    const api = fakeApi([task("t1"), task("t2")]);
    renderView(api);
    start();
    fireEvent.click(screen.getByRole("button", { name: /^Skip/ }));
    expect(api.moveQueuedToEnd).toHaveBeenCalledWith("t1");
    expect(getFocusSession().taskId).toBe("t2");
  });

  it("Skip on the only one keeps the session on it", () => {
    const api = fakeApi([task("t1")]);
    renderView(api);
    start();
    fireEvent.click(screen.getByRole("button", { name: /^Skip/ }));
    expect(getFocusSession()).toMatchObject({ taskId: "t1", running: true });
  });

  it("Done and Skip never start a session", () => {
    const api = fakeApi([task("t1"), task("t2")]);
    renderView(api);
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(api.markDone).toHaveBeenCalledWith("t1");
    expect(getFocusSession().tracking).toBe(false);
  });

  it("Done here takes the clock from another tab and moves the session", () => {
    otherTab = createFocusEngine({
      storage: () => window.localStorage,
      now: () => Date.now(),
      readPrefs: () => ({ ...DEFAULT_FOCUS_PREFS, soundEnabled: false }) as FocusPrefs,
      alert: () => {},
      singleWindow: () => false,
      tabId: "other-tab",
      newKey: () => crypto.randomUUID(),
    });
    otherTab.attach(USER);
    otherTab.bind({ id: "t1", title: "Task t1", bucketName: "Inbox", workspaceId: WS });
    otherTab.start();
    renderView(fakeApi([task("t1"), task("t2")]));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: `${FOCUS_STORAGE_PREFIX}${USER}` }));
    });
    expect(getFocusSession()).toMatchObject({ taskId: "t1", running: true });
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(getFocusSession()).toMatchObject({ taskId: "t2", running: true });
    otherTab.tick();
    expect(otherTab.getSnapshot().taskId).toBe("t2");
  });

  it("Off: no pill and nothing to pause; Pomodoro: one pill in the header, none on the card", () => {
    renderView(fakeApi([task("t1")]));
    start();
    act(() => setFocusTimer("off"));
    expect(document.querySelector('[data-slot="focus-task-pill"]')).toBeNull();
    expect(document.querySelector('[data-slot="focus-pomodoro-pill"]')).toBeNull();
    act(() => setFocusTimer("pomodoro"));
    expect(document.querySelector('[data-slot="focus-task-pill"]')).toBeNull();
    const pill = document.querySelector('[data-slot="focus-pomodoro-pill"]') as HTMLElement;
    expect(pill.textContent).toMatch(/^Focus \d+:\d\d$/);
  });

  it("⏎ is Done for the focused task; S is Skip", () => {
    const api = fakeApi([task("t1"), task("t2")]);
    renderView(api);
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(api.markDone).toHaveBeenCalledWith("t1");
    fireEvent.keyDown(document.body, { key: "s" });
    expect(api.moveQueuedToEnd).toHaveBeenCalledWith("t1");
  });
});

describe("Focus: subtasks open their own details (AC8.5, call 65a)", () => {
  const parent = task("p");
  const subs = [task("s1", { parentId: "p" }), task("s2", { parentId: "p", status: "done" })];

  it("lists them as a checklist; a click opens that subtask in the panel", () => {
    const onOpenTask = rs.fn();
    const api = fakeApi([parent], { all: [parent, ...subs], subtasks: new Map([["p", subs]]) });
    renderView(api, { onOpenTask });
    const list = document.querySelector('[data-slot="focus-subtasks"]') as HTMLElement;
    expect(within(list).getByText("1/2")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: /^Task s1: open its details$/ }));
    expect(onOpenTask).toHaveBeenCalledWith("s1");
    // Checking one off goes through the module.
    fireEvent.click(within(list).getAllByRole("button", { name: "Mark as done" })[0]);
    expect(api.toggleDone).toHaveBeenCalledWith(subs[0]);
  });

  it("⇧F on a subtask makes it the focus", () => {
    const api = fakeApi([parent], { all: [parent, ...subs], subtasks: new Map([["p", subs]]) });
    renderView(api);
    const row = screen.getByRole("button", { name: /^Task s1: open its details$/ });
    fireEvent.keyDown(row, { key: "F", shiftKey: true });
    expect(api.focusOnTask).toHaveBeenCalledWith("s1");
  });
});

describe("Focus: Up next (AC8.2)", () => {
  it("numbers the rest of the line-up and sums the estimates", () => {
    renderView(
      fakeApi([
        task("t1"),
        task("t2", { estimateMinutes: 10 }),
        task("t3", { estimateMinutes: 20, bucketId: "b2" }),
      ]),
    );
    const upNext = screen.getByRole("region", { name: "Up next" });
    expect(upNext.textContent).toContain("Up next · 2 · ~30m");
    expect(within(upNext).getByText("Task t2")).toBeTruthy();
    expect(within(upNext).queryByText("Task t1")).toBeNull();
  });

  it("the last one says so", () => {
    renderView(fakeApi([task("t1")]));
    expect(screen.getByText("Last one. Nothing else is lined up.")).toBeTruthy();
  });
});

describe("Focus: the empty state teaches three ways in (AC8.9, call 66)", () => {
  it("offers today's scheduled tasks as rows: + adds one, Line up all adds them", () => {
    const day = new Date();
    const at = (h: number) =>
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).toISOString();
    const a = task("a");
    const b = task("b");
    const api = fakeApi([], {
      all: [a, b],
      sessions: [
        {
          id: "s1",
          workspaceId: WS,
          taskId: "a",
          userId: USER,
          startsAt: at(1),
          endsAt: at(2),
          updatedAt: at(0),
        },
        {
          id: "s2",
          workspaceId: WS,
          taskId: "b",
          userId: USER,
          startsAt: at(0),
          endsAt: at(1),
          updatedAt: at(0),
        },
      ],
    });
    const onSelectTask = rs.fn();
    renderView(api, { onSelectTask });
    expect(screen.getByText("Line up what you’ll do next, then press Start.")).toBeTruthy();
    expect(screen.getByText(/on any task to add it here/)).toBeTruthy();
    expect(screen.getByText(/on a task to focus on it alone/)).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "Scheduled today" })).getAllByRole(
      "listitem",
    );
    // In time order: b at midnight, then a.
    expect(rows.map((r) => r.getAttribute("data-task-id"))).toEqual(["b", "a"]);
    fireEvent.click(within(rows[1]).getByRole("button", { name: /^Task a/ }));
    expect(onSelectTask).toHaveBeenCalledWith("a");
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Add to Focus" }));
    expect(api.addToQueue).toHaveBeenCalledWith("a", "end");
    fireEvent.click(screen.getByRole("button", { name: "Line up all 2" }));
    expect(api.addToQueue).toHaveBeenCalledWith("b", "end");
  });

  it("with nothing scheduled, says how to get there", () => {
    renderView(fakeApi([]));
    expect(screen.getByText(/tasks you schedule for today show up here/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Scheduled today" })).toBeNull();
  });
});
