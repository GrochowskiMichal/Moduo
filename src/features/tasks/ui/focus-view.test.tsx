// TV-F7: the Focus screen on the one time engine (spec §7, AC8.1–8.5, 8.9).
// Carries the old Execute view's guarantees (Done / Skip move the session,
// even when another tab runs the clock) and adds Start, the pills, the
// subtasks' panel and keys, and the empty state's three ways in.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { DEFAULT_FOCUS_PREFS, type FocusPrefs, useFocusPrefs } from "../../../lib/focus-prefs";
import {
  __resetFocusEngineForTest,
  attachFocusUser,
  bindFocusTask,
  createFocusEngine,
  FOCUS_STORAGE_PREFIX,
  type FocusEngine,
  getFocusSession,
  setFocusTimer,
  startFocus,
} from "../../focus/engine";
import { setRunNotice } from "../../focus/run";
import type { AgentSession } from "../../spine/agent-session";
import { WorkspaceContext, type WorkspaceContextValue } from "../../workspaces/workspace-context";
import { makeTask } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task, TaskSession, TaskWaitingEntry } from "../model";
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
  over: {
    all?: Task[];
    sessions?: TaskSession[];
    subtasks?: Map<string, Task[]>;
    waiting?: TaskWaitingEntry[];
    agentSessions?: AgentSession[];
  } = {},
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
    waiting: over.waiting ?? [],
    reminders: [],
    agentSessions: over.agentSessions ?? [],
    addWaiting: rs.fn(() => "w-new"),
    removeWaiting: rs.fn(),
    addReminder: rs.fn(),
    removeReminder: rs.fn(),
    arrangeQueue: rs.fn(() => true),
    setTaskStatus: rs.fn(),
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
    toggleQueue: rs.fn(),
  };
  return api as typeof api & TasksModuleApi;
}

function renderView(
  api: TasksModuleApi,
  handlers: {
    onOpenTask?: (id: string) => void;
    onSelectTask?: (id: string | null) => void;
    onShowInFlight?: () => void;
  } = {},
) {
  return render(
    <WorkspaceContext.Provider value={{ members: MEMBERS } as unknown as WorkspaceContextValue}>
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
          onShowInFlight={handlers.onShowInFlight}
        />
      </TooltipProvider>
    </WorkspaceContext.Provider>,
  );
}

const MEMBERS = [
  { userId: USER, displayName: "Maciej", isActive: true, removedAt: null, perms: ["tasks.edit"] },
];

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

  it("⏎ is Done for the focused task; S is Skip — while the screen holds focus", () => {
    const api = fakeApi([task("t1"), task("t2")]);
    renderView(api);
    const screenRoot = document.querySelector('[data-slot="focus-view"]') as HTMLElement;
    // Opening with nothing else focused gives the screen focus.
    expect(document.activeElement).toBe(screenRoot);
    fireEvent.keyDown(screenRoot, { key: "Enter" });
    expect(api.markDone).toHaveBeenCalledWith("t1");
    fireEvent.keyDown(screenRoot, { key: "s" });
    expect(api.moveQueuedToEnd).toHaveBeenCalledWith("t1");
  });

  it("keys from outside the screen are never its own (⏎ has no Undo)", () => {
    const api = fakeApi([task("t1"), task("t2")]);
    renderView(api);
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "s" });
    expect(api.markDone).not.toHaveBeenCalled();
    expect(api.moveQueuedToEnd).not.toHaveBeenCalled();
  });

  it("Start hands focus to the pill once its button is gone (a second ⏎ pauses)", () => {
    renderView(fakeApi([task("t1"), task("t2")]));
    const startButton = screen.getByRole("button", { name: /^Start/ });
    startButton.focus();
    fireEvent.click(startButton);
    expect(document.activeElement).toBe(document.querySelector('[data-slot="focus-task-pill"]'));
  });
});

describe("Focus: the session moving on by itself (F6-6)", () => {
  afterEach(() => act(() => setRunNotice(null)));

  it("says why the card changed until you act or dismiss it", () => {
    const api = fakeApi([task("t1"), task("t2")]);
    renderView(api);
    act(() => setRunNotice("Mike completed “Task t0”."));
    expect(screen.getByText("Mike completed “Task t0”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(screen.queryByText("Mike completed “Task t0”.")).toBeNull();
    act(() => setRunNotice("“Task t9” was deleted or is no longer shared with you."));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(document.querySelector('[data-slot="focus-notice"]')).toBeNull();
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
  it("moves a row with ⌥⇧↑ around a Now that isn't first in the line-up, with Undo", () => {
    // N, X, C, D lined up; the session is on X (a capture went on top of it).
    const api = fakeApi([task("n"), task("x"), task("c"), task("d")]);
    act(() => {
      bindFocusTask({ id: "x", title: "Task x", bucketName: "Inbox", workspaceId: WS });
      startFocus();
    });
    renderView(api);
    expect(within(screen.getByRole("region", { name: "Now" })).getByText("Task x")).toBeTruthy();
    const d = screen.getByRole("button", { name: "Task d" });
    fireEvent.keyDown(d, { key: "ArrowUp", altKey: true, shiftKey: true });
    // Up next N, C, D → N, D, C: D goes right after N; Now (X) stays Now.
    expect(api.reorderQueue).toHaveBeenCalledWith(["n", "d", "x", "c"], expect.any(Function));
  });

  it("removes a row from Focus, with Undo", () => {
    const api = fakeApi([task("t1"), task("t2")]);
    renderView(api);
    fireEvent.click(screen.getByRole("button", { name: "Remove from Focus" }));
    expect(api.removeFromQueue).toHaveBeenCalledWith("t2");
  });

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
    // One "+" goes through the page's guarded toggle (a blocked task offers its frontier).
    expect(api.toggleQueue).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "Line up all 2" }));
    expect(api.addToQueue).toHaveBeenCalledWith("b", "end");
  });

  it("with nothing scheduled, says how to get there", () => {
    renderView(fakeApi([]));
    expect(screen.getByText(/tasks you schedule for today show up here/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Scheduled today" })).toBeNull();
  });
});

// TV-F8: between tasks, Arrange, Hand off and In flight (AC8.6–8.8, call 5).
describe("Focus: along the way, Arrange, Hand off (TV-F8)", () => {
  const acme = (id: string, over: Partial<Task> = {}) => task(id, { bucketId: "acme", ...over });
  const web = (id: string, over: Partial<Task> = {}) => task(id, { bucketId: "web", ...over });

  it("Done before a project change offers one quick task from the project you're leaving", () => {
    const invoice = acme("invoice", { title: "Send invoice", estimateMinutes: 5 });
    const api = fakeApi([acme("logo"), web("site")], {
      all: [acme("logo"), web("site"), invoice],
    });
    renderView(api);
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    const offer = screen.getByRole("region", { name: "Along the way" });
    expect(within(offer).getByText(/Send invoice/)).toBeTruthy();
    // It holds Now's place; Take it lines it up at the top.
    expect(screen.queryByRole("region", { name: "Now" })).toBeNull();
    fireEvent.click(within(offer).getByRole("button", { name: /^Take it/ }));
    expect(api.addToQueue).toHaveBeenCalledWith("invoice", "top");
    expect(screen.getByRole("region", { name: "Now" })).toBeTruthy();
  });

  it("after Esc on the offer the screen keeps the keys: S skips the new Now", () => {
    const invoice = acme("invoice", { estimateMinutes: 5 });
    const api = fakeApi([acme("logo"), web("site"), web("nav")], {
      all: [acme("logo"), web("site"), web("nav"), invoice],
    });
    renderView(api);
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    const offer = screen.getByRole("region", { name: "Along the way" });
    expect(document.activeElement).toBe(within(offer).getByRole("button", { name: /^Take it/ }));
    fireEvent.keyDown(document.activeElement ?? offer, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Along the way" })).toBeNull();
    // Focus went back to the screen, not to <body>.
    const root = document.querySelector('[data-slot="focus-view"]') as HTMLElement;
    expect(root.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? root, { key: "s" });
    expect(api.moveQueuedToEnd).toHaveBeenCalled();
  });

  it("⏎ never takes the Shrink · Move · Let go ask", () => {
    const invoice = acme("invoice", { estimateMinutes: 5 });
    localStorage.setItem("moduo:tasks:along:u1:ws-1", JSON.stringify({ invoice: 3 }));
    const api = fakeApi([acme("logo"), web("site")], {
      all: [acme("logo"), web("site"), invoice],
    });
    renderView(api);
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(screen.getByRole("button", { name: "Let go" })).toBeTruthy();
    const root = document.querySelector('[data-slot="focus-view"]') as HTMLElement;
    root.focus();
    fireEvent.keyDown(root, { key: "Enter" });
    expect(api.addToQueue).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Along the way" })).toBeTruthy();
  });

  it("Esc is Not now; three Not-nows turn the next offer into Shrink · Move · Let go", () => {
    const invoice = acme("invoice", { title: "Send invoice", estimateMinutes: 5 });
    for (let i = 0; i < 4; i++) {
      const api = fakeApi([acme("logo"), web("site")], {
        all: [acme("logo"), web("site"), invoice],
      });
      const view = renderView(api);
      fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
      const offer = screen.getByRole("region", { name: "Along the way" });
      if (i < 3) {
        expect(within(offer).queryByRole("button", { name: "Let go" })).toBeNull();
        fireEvent.keyDown(document.activeElement ?? offer, { key: "Escape" });
        expect(screen.queryByRole("region", { name: "Along the way" })).toBeNull();
      } else {
        fireEvent.click(within(offer).getByRole("button", { name: "Let go" }));
        expect(api.setTaskStatus).toHaveBeenCalledWith("invoice", { category: "wont_do" });
      }
      view.unmount();
    }
  });

  it("the switch turns the offer off", () => {
    const invoice = acme("invoice", { estimateMinutes: 5 });
    const api = fakeApi([acme("logo"), web("site")], {
      all: [acme("logo"), web("site"), invoice],
    });
    // Settings (or ⋯) turned it off: the shared prefs store, as they write it.
    let set: ((patch: Partial<FocusPrefs>) => void) | null = null;
    function Prefs() {
      set = useFocusPrefs().setPrefs;
      return null;
    }
    render(<Prefs />);
    renderView(api);
    act(() => set?.({ alongTheWay: false }));
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(screen.queryByRole("region", { name: "Along the way" })).toBeNull();
    act(() => set?.({ alongTheWay: true }));
  });

  it("Arrange by project shows when it saves two switches or more, and arranges the line-up", () => {
    // Now a (Acme); Up next b c d e alternate: 4 switches, 1 once arranged.
    const api = fakeApi([acme("a"), web("b"), acme("c"), web("d"), acme("e")]);
    renderView(api);
    const arrange = screen.getByRole("button", { name: /Arrange by project\s*· 3 fewer switches/ });
    fireEvent.click(arrange);
    // Now's project first, your order kept inside each.
    expect(api.arrangeQueue).toHaveBeenCalledWith(["a", "c", "e", "b", "d"], expect.any(Function));
  });

  it("no Arrange when it would save fewer than two", () => {
    renderView(fakeApi([acme("a"), web("b"), acme("c")]));
    expect(screen.queryByRole("button", { name: /Arrange by project/ })).toBeNull();
  });

  it("W hands off: it waits on what you typed, and the session moves on", () => {
    const api = fakeApi([acme("t1"), acme("t2")]);
    renderView(api);
    start();
    const root = document.querySelector('[data-slot="focus-view"]') as HTMLElement;
    root.focus();
    fireEvent.keyDown(root, { key: "w" });
    // The popover opens on "Waiting on…", focused.
    const input = screen.getByPlaceholderText("Waiting on…");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "the client’s logo files" } });
    fireEvent.click(screen.getByRole("option", { name: /the client’s logo files/ }));
    const form = document.querySelector('[data-slot="focus-hand-off"]') as HTMLElement;
    fireEvent.click(within(form).getByRole("button", { name: /^Hand off/ }));
    expect(api.addWaiting).toHaveBeenCalledWith("t1", {
      kind: "text",
      label: "the client’s logo files",
    });
    expect(api.addReminder).not.toHaveBeenCalled();
    expect(getFocusSession().taskId).toBe("t2");
  });

  it("after ten timed tasks Up next says your usual pace (AC8.10)", () => {
    const finished = Array.from({ length: 10 }, (_, i) =>
      task(`d${i}`, {
        status: "done",
        completedBy: USER,
        completedAt: "2026-10-01T10:00:00Z",
        estimateMinutes: 30,
        timeSpentSeconds: 45 * 60,
      }),
    );
    const queued = [task("t1", { estimateMinutes: 20 }), task("t2", { estimateMinutes: 40 })];
    renderView(fakeApi(queued, { all: [...queued, ...finished] }));
    // Up next is t2 (40m) at a 1.5× pace.
    expect(document.querySelector('[data-slot="focus-pace"]')?.textContent).toContain(
      "≈ 1h at your usual pace",
    );
  });

  it("an agent on the Now task shows as one status line under its title (52, AC3.4)", () => {
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: "s1",
      workspaceId: WS,
      taskId: "t1",
      userId: USER,
      agent: "Claude",
      state: "working",
      note: "Writing tests",
      step: 3,
      steps: 5,
      links: [],
      earlier: [],
      summaryAt: null,
      summaryPostedAt: null,
      startedAt: now,
      updatedAt: now,
      stoppedAt: null,
    };
    renderView(fakeApi([task("t1"), task("t2")], { agentSessions: [session] }));
    const card = screen.getByRole("region", { name: "Now" });
    // Status, not conversation: "Claude · Writing tests · step 3 of 5 · just now".
    expect(within(card).getByText("Claude · Writing tests · step 3 of 5 · just now")).toBeTruthy();
  });

  it("a long agent note shortens, never pushing Focus sideways (MOD-119)", () => {
    const now = new Date().toISOString();
    const note = `Prod desktop build published to ${"the-release-channel-".repeat(8)}latest`;
    const session: AgentSession = {
      id: "s1",
      workspaceId: WS,
      taskId: "t1",
      userId: USER,
      agent: "Claude",
      state: "needs_you",
      note,
      step: null,
      steps: null,
      links: [],
      earlier: [],
      summaryAt: null,
      summaryPostedAt: null,
      startedAt: now,
      updatedAt: now,
      stoppedAt: null,
    };
    renderView(fakeApi([task("t1"), task("t2")], { agentSessions: [session] }));
    const card = screen.getByRole("region", { name: "Now" });
    const line = card.querySelector('[data-slot="agent-session-line"]') as HTMLElement;
    // It may wrap, but the note's item is never wider than the line.
    expect(line.className).toContain("flex-wrap");
    expect(line.className).toContain("min-w-0");
    // The full text on hover; the words that can run long cut with an ellipsis.
    const shortened = line.querySelector(".truncate") as HTMLElement;
    expect(shortened.getAttribute("title")).toBe(`Claude · Needs you: ${note} · just now`);
    expect(shortened.textContent).toContain(note);
    expect(shortened.className).toContain("min-w-0");
    expect(shortened.className).toContain("max-w-full");
    // And the screen itself never scrolls sideways.
    const scroller = document.querySelector('[data-slot="focus-view"] .pane-scroll') as HTMLElement;
    expect(scroller.className).toContain("min-w-0");
    expect(scroller.className).toContain("overflow-x-clip");
  });

  it("a lined-up task that waits is In flight, not Up next; the line opens the panel", () => {
    const onShowInFlight = rs.fn();
    const waiting: TaskWaitingEntry = {
      id: "w1",
      workspaceId: WS,
      taskId: "t2",
      kind: "text",
      ref: null,
      label: "Sam",
      since: new Date().toISOString(),
      createdBy: USER,
      updatedAt: "",
    };
    renderView(fakeApi([task("t1"), task("t2"), task("t3")], { waiting: [waiting] }), {
      onShowInFlight,
    });
    const upNext = screen.getByRole("region", { name: "Up next" });
    expect(within(upNext).queryByText("Task t2")).toBeNull();
    expect(within(upNext).getByText("Task t3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /1 in flight/ }));
    expect(onShowInFlight).toHaveBeenCalled();
  });
});
