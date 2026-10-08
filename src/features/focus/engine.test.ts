import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import { DEFAULT_FOCUS_PREFS, type FocusPrefs } from "../../lib/focus-prefs";
import { moduoCacheKeysToClear } from "../settings/advanced";
import {
  __resetFocusEngineForTest,
  attachFocusUser,
  bindFocusTask,
  createFocusEngine,
  FOCUS_STORAGE_PREFIX,
  type FocusEngine,
  type FocusFlushSink,
  type FocusPhaseEnd,
  flushFocusSession,
  getFocusSession,
  previewFocusInterval,
  registerFocusFlushSink,
  resolveFocusAway,
  startFocus,
  stopFocus,
  toggleFocusPomodoro,
  toggleFocusRunning,
} from "./engine";
import { parseRecord } from "./engine-core";
import type { FocusPhaseNext } from "./phase-alert";

const USER = "user-1";
const WS = "ws-1";
const KEY = `${FOCUS_STORAGE_PREFIX}${USER}`;
const MIN = 60_000;

const BASE_PREFS: Partial<FocusPrefs> = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoStartNext: false,
  soundEnabled: false,
};

// The intervals and rollover pref the engine reads at each phase boundary.
function setPrefs(patch: Partial<FocusPrefs> = {}): void {
  localStorage.setItem(
    "moduo.focus",
    JSON.stringify({ ...DEFAULT_FOCUS_PREFS, ...BASE_PREFS, ...patch }),
  );
}

function task(id: string, workspaceId = WS) {
  return { id, title: `Task ${id}`, bucketName: "Inbox", workspaceId };
}

/** A sink that records every hand-off; `result` models the Tasks write. */
function recordingSink(result: () => boolean | Promise<boolean> = () => true) {
  const calls: Array<{ taskId: string; seconds: number }> = [];
  const sink: FocusFlushSink = (taskId, seconds) => {
    calls.push({ taskId, seconds });
    return result();
  };
  const total = (taskId?: string) =>
    calls.filter((c) => !taskId || c.taskId === taskId).reduce((sum, c) => sum + c.seconds, 0);
  return { calls, sink, total };
}

/** The wall clock moves but no timer fires: a suspended webview, a sleeping machine. */
function wallJump(ms: number): void {
  rs.setSystemTime(Date.now() + ms);
}

/** Away for `ms`, then the first tick after waking. */
function sleepThrough(ms: number): void {
  wallJump(ms);
  rs.advanceTimersByTime(1000);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

let alerts: Array<{ end: FocusPhaseEnd; next: FocusPhaseNext }>;

/** A new page load: a fresh engine (new tab id) over the same localStorage. */
function newPage(): void {
  __resetFocusEngineForTest({ alert: (end, next) => alerts.push({ end, next }) });
  attachFocusUser(USER);
}

beforeEach(() => {
  rs.useFakeTimers();
  localStorage.clear();
  alerts = [];
  setPrefs();
  newPage();
});

afterEach(() => {
  __resetFocusEngineForTest();
  rs.useRealTimers();
});

describe("focus engine — session lifecycle", () => {
  it("is idle at rest", () => {
    const s = getFocusSession();
    expect(s.taskId).toBeNull();
    expect(s.tracking).toBe(false);
    expect(s.running).toBe(false);
    expect(s.away).toBeNull();
  });

  it("bind then start begins an opt-in, running session on the bound task", () => {
    bindFocusTask(task("t1"));
    expect(getFocusSession().tracking).toBe(false); // never auto-starts
    startFocus();
    expect(getFocusSession()).toMatchObject({
      taskId: "t1",
      taskTitle: "Task t1",
      bucketName: "Inbox",
      tracking: true,
      running: true,
    });
  });

  it("startFocus is a no-op without a bound task", () => {
    startFocus();
    expect(getFocusSession().tracking).toBe(false);
  });

  it("accrues work seconds as wall-clock time passes", () => {
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(5000);
    expect(getFocusSession()).toMatchObject({ sitElapsed: 5, accrued: 5, bigClock: 5 });
  });

  it("pause saves and stops the clock; resume carries on", () => {
    const { calls, sink } = recordingSink();
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(3000);
    toggleFocusRunning();
    expect(getFocusSession()).toMatchObject({ running: false, accrued: 0 });
    expect(calls).toEqual([{ taskId: "t1", seconds: 3 }]);
    rs.advanceTimersByTime(60_000); // paused: nothing accrues
    toggleFocusRunning();
    rs.advanceTimersByTime(2000);
    expect(getFocusSession()).toMatchObject({ running: true, sitElapsed: 5, accrued: 2 });
  });

  it("stop saves and returns to rest on the same task", () => {
    const { calls, sink } = recordingSink();
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(4000);
    stopFocus();
    expect(calls).toEqual([{ taskId: "t1", seconds: 4 }]);
    expect(getFocusSession()).toMatchObject({ taskId: "t1", tracking: false, sitElapsed: 0 });
  });

  it("binding the same task again (a remount, a rename) never resets a live session", () => {
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(5000);
    bindFocusTask(task("t1"));
    bindFocusTask({ ...task("t1"), title: "Renamed" });
    expect(getFocusSession()).toMatchObject({ taskTitle: "Renamed", running: true, sitElapsed: 5 });
  });
});

describe("F1-1 — background accuracy", () => {
  it("wall-clock accrual under throttled ticks", () => {
    const { sink, total } = recordingSink();
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    startFocus();
    // A hidden or covered window: the timer fires once a minute, not every second.
    for (let minute = 0; minute < 10; minute++) {
      wallJump(59_000);
      rs.advanceTimersByTime(1000);
    }
    expect(getFocusSession()).toMatchObject({ away: null, sitElapsed: 600 });
    toggleFocusRunning();
    expect(total("t1")).toBe(600);
  });

  it("looking at the window again catches the clock up at once", () => {
    bindFocusTask(task("t1"));
    startFocus();
    wallJump(45_000); // no tick fired
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getFocusSession().sitElapsed).toBe(45);
  });
});

describe("F1-2 — survives a reload or restart", () => {
  it("rehydrates from persisted state", () => {
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(5 * MIN);
    window.dispatchEvent(new Event("pagehide")); // a reload hands the clock over
    newPage();
    expect(getFocusSession()).toMatchObject({
      taskId: "t1",
      tracking: true,
      running: true,
      sitElapsed: 300,
      accrued: 300,
      away: null,
    });
    rs.advanceTimersByTime(MIN);
    expect(getFocusSession().sitElapsed).toBe(360);
  });

  it("after a crash (no pagehide) the new page shows the clock, then takes it over", () => {
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(30_000);
    newPage();
    expect(getFocusSession().sitElapsed).toBe(30);
    rs.advanceTimersByTime(80_000);
    expect(getFocusSession()).toMatchObject({ sitElapsed: 110, away: null });
  });

  it("restarting more than 90 s later holds the gap instead of crediting it", () => {
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(MIN);
    window.dispatchEvent(new Event("pagehide"));
    wallJump(10 * MIN); // the app was closed
    newPage();
    const s = getFocusSession();
    expect(s.accrued).toBe(60);
    expect(s.away).toMatchObject({ awaySeconds: 600, heldSeconds: 600 });
  });

  it("keeps pomodoro progress through a reload", () => {
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    rs.advanceTimersByTime(10 * MIN);
    window.dispatchEvent(new Event("pagehide"));
    newPage();
    expect(getFocusSession()).toMatchObject({ pomodoro: true, phase: "work", pomoLeft: 15 * 60 });
  });

  it("is stored under moduo:tasks:focus:<user>, which a cache reset keeps", () => {
    bindFocusTask(task("t1"));
    startFocus();
    expect(parseRecord(localStorage.getItem(KEY))?.task?.id).toBe("t1");
    expect(moduoCacheKeysToClear(Object.keys(localStorage))).not.toContain(KEY);
  });

  it("belongs to the signed-in person", () => {
    bindFocusTask(task("t1"));
    startFocus();
    attachFocusUser("user-2");
    expect(getFocusSession().tracking).toBe(false);
    attachFocusUser(USER);
    expect(getFocusSession()).toMatchObject({ taskId: "t1", tracking: true });
  });

  it("ignores a malformed stored record", () => {
    localStorage.setItem(KEY, "{not json");
    newPage();
    expect(getFocusSession().tracking).toBe(false);
  });
});

describe("F1-3 — away", () => {
  function awayAfter30s(): void {
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(30_000);
    sleepThrough(10 * MIN);
  }

  it("gap > 90 s raises away, nothing credited", () => {
    awayAfter30s();
    const s = getFocusSession();
    expect(s.accrued).toBe(30);
    expect(s.away).toEqual({ awaySeconds: 601, heldSeconds: 601, endedPhases: [] });
    expect(s.running).toBe(true); // the clock carries on from the wake-up
    rs.advanceTimersByTime(5000);
    expect(getFocusSession().accrued).toBe(35);
  });

  it("a gap of 90 s or less is just time", () => {
    bindFocusTask(task("t1"));
    startFocus();
    sleepThrough(89_000);
    expect(getFocusSession()).toMatchObject({ away: null, accrued: 90 });
  });

  it("Keep credits the held time to the task", () => {
    awayAfter30s();
    resolveFocusAway("keep");
    expect(getFocusSession()).toMatchObject({ away: null, accrued: 631, sitElapsed: 631 });
  });

  it("Discard drops it", () => {
    awayAfter30s();
    resolveFocusAway("discard");
    expect(getFocusSession()).toMatchObject({ away: null, accrued: 30 });
  });

  it("Count as break drops it and starts a fresh focus block", () => {
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    rs.advanceTimersByTime(10 * MIN);
    sleepThrough(5 * MIN);
    expect(getFocusSession().pomoLeft).toBe(25 * 60 - 15 * 60 - 1);
    resolveFocusAway("break");
    expect(getFocusSession()).toMatchObject({
      away: null,
      accrued: 600,
      phase: "work",
      running: true,
      pomoLeft: 25 * 60,
    });
  });

  it("an unanswered away block is discarded when the session stops", () => {
    const { sink, total } = recordingSink();
    registerFocusFlushSink(WS, sink);
    awayAfter30s();
    stopFocus();
    expect(total("t1")).toBe(30);
    expect(getFocusSession().away).toBeNull();
  });

  it("a second gap adds to the same prompt", () => {
    awayAfter30s();
    rs.advanceTimersByTime(10_000);
    sleepThrough(2 * MIN);
    expect(getFocusSession().away).toMatchObject({ awaySeconds: 601 + 121, heldSeconds: 722 });
  });

  it("a clock that jumps backwards loses nothing and credits nothing extra", () => {
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(20_000);
    wallJump(-10 * MIN);
    rs.advanceTimersByTime(5000);
    expect(getFocusSession()).toMatchObject({ away: null, accrued: 24 });
  });
});

describe("F1-4 — pomodoro catch-up", () => {
  it("pomodoro catch-up never auto-starts while away", () => {
    setPrefs({ autoStartNext: true });
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    const t0 = Date.now();
    rs.advanceTimersByTime(10 * MIN);
    sleepThrough(50 * MIN);
    const s = getFocusSession();
    // The work block ended at 25m and the break at 30m — both while away — and
    // the next work block waits for you instead of starting by itself.
    expect(s).toMatchObject({ phase: "work", running: false, pomoLeft: 25 * 60, completedWork: 1 });
    expect(s.accrued).toBe(600);
    expect(s.away?.heldSeconds).toBe(15 * 60); // only up to the block's scheduled end
    expect(s.away?.endedPhases.map((e) => [e.phase, e.at - t0])).toEqual([
      ["work", 25 * MIN],
      ["break", 30 * MIN],
    ]);
    expect(alerts).toHaveLength(0); // caught-up ends never chime or notify
  });

  it("with auto-start off, a block that ends while away waits at the break", () => {
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    rs.advanceTimersByTime(10 * MIN);
    sleepThrough(50 * MIN);
    const s = getFocusSession();
    expect(s).toMatchObject({ phase: "break", running: false, pomoLeft: 5 * 60, completedWork: 1 });
    expect(s.away?.endedPhases).toHaveLength(1);
    resolveFocusAway("keep");
    expect(getFocusSession().accrued).toBe(25 * 60);
  });

  it("a phase end while you're there alerts once and banks the finished block", () => {
    setPrefs({ workMinutes: 1, breakMinutes: 1, autoStartNext: true });
    const { sink, total } = recordingSink();
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    rs.advanceTimersByTime(MIN);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.end.phase).toBe("work");
    expect(alerts[0]?.next).toMatchObject({ phase: "break", running: true, lengthMs: MIN });
    expect(total("t1")).toBe(60);
    rs.advanceTimersByTime(30_000);
    expect(getFocusSession()).toMatchObject({ phase: "break", accrued: 0 }); // breaks don't accrue
  });

  it("a throttled tick still rolls the phase at its scheduled time", () => {
    setPrefs({ workMinutes: 1, breakMinutes: 5, autoStartNext: true });
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    wallJump(80_000);
    rs.advanceTimersByTime(1000);
    // Work ended at 60 s, not when the late tick noticed (81 s).
    expect(getFocusSession()).toMatchObject({ phase: "break", accrued: 60, pomoLeft: 5 * 60 - 21 });
    expect(alerts).toHaveLength(1);
  });

  it("pauses at rollover unless auto-start is on", () => {
    setPrefs({ workMinutes: 1, breakMinutes: 1 });
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    rs.advanceTimersByTime(MIN);
    expect(getFocusSession()).toMatchObject({ phase: "break", running: false, pomoLeft: 60 });
  });

  it("previewFocusInterval shows an edited length on the paused clock", () => {
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    toggleFocusRunning();
    previewFocusInterval({ ...DEFAULT_FOCUS_PREFS, ...BASE_PREFS, workMinutes: 45 } as FocusPrefs);
    expect(getFocusSession().pomoLeft).toBe(45 * 60);
  });

  it("previewing unchanged intervals (a remount) keeps a paused block's progress", () => {
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    rs.advanceTimersByTime(10 * MIN);
    toggleFocusRunning();
    previewFocusInterval({ ...DEFAULT_FOCUS_PREFS, ...BASE_PREFS } as FocusPrefs);
    expect(getFocusSession().pomoLeft).toBe(15 * 60);
  });
});

describe("F1-6 — the rhythm belongs to the session", () => {
  it("task switch keeps rhythm", () => {
    const { sink, total } = recordingSink();
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    rs.advanceTimersByTime(10 * MIN);
    bindFocusTask(task("t2")); // t1 marked done → the next task
    expect(getFocusSession()).toMatchObject({
      taskId: "t2",
      tracking: true,
      running: true,
      pomodoro: true,
      phase: "work",
      completedWork: 0,
      pomoLeft: 15 * 60,
    });
    expect(total("t1")).toBe(600);
    rs.advanceTimersByTime(5 * MIN);
    toggleFocusRunning();
    expect(total("t2")).toBe(300);
    expect(getFocusSession().pomoLeft).toBe(10 * 60);
  });

  it("counts blocks toward the long break across tasks", () => {
    setPrefs({ workMinutes: 1, breakMinutes: 1, sessionsBeforeLongBreak: 2, autoStartNext: true });
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    rs.advanceTimersByTime(MIN); // block 1 on t1
    bindFocusTask(task("t2"));
    rs.advanceTimersByTime(2 * MIN); // break, then block 2 on t2
    expect(getFocusSession()).toMatchObject({ phase: "break", longBreak: true, completedWork: 2 });
  });

  it("a stopwatch keeps counting the sitting across tasks", () => {
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(30_000);
    bindFocusTask(task("t2"));
    rs.advanceTimersByTime(10_000);
    expect(getFocusSession()).toMatchObject({ taskId: "t2", sitElapsed: 40, accrued: 10 });
  });

  it("binding null ends the session (queue emptied) but keeps the pomodoro choice", () => {
    const { sink, total } = recordingSink();
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    toggleFocusPomodoro();
    startFocus();
    rs.advanceTimersByTime(2000);
    bindFocusTask(null);
    expect(total("t1")).toBe(2);
    expect(getFocusSession()).toMatchObject({ taskId: null, tracking: false, pomodoro: true });
  });
});

describe("F1-7 — tracked time is never lost", () => {
  it("failed flush retains seconds", async () => {
    let saved = false;
    const { calls, sink } = recordingSink(() => Promise.resolve(saved));
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(30_000);
    toggleFocusRunning(); // pause → the save fails
    await settle();
    expect(getFocusSession()).toMatchObject({ accrued: 30, unsaved: true });
    saved = true;
    await rs.advanceTimersByTimeAsync(15_000); // the retry
    expect(getFocusSession()).toMatchObject({ accrued: 0, unsaved: false });
    expect(calls).toEqual([
      { taskId: "t1", seconds: 30 },
      { taskId: "t1", seconds: 30 },
    ]);
  });

  it("a rejected save is kept and retried the same way", async () => {
    let fail = true;
    const { total, sink } = recordingSink(() =>
      fail ? Promise.reject(new Error("offline")) : Promise.resolve(true),
    );
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(20_000);
    stopFocus();
    await settle();
    expect(getFocusSession()).toMatchObject({ accrued: 20, unsaved: true });
    fail = false;
    await rs.advanceTimersByTimeAsync(15_000);
    expect(getFocusSession()).toMatchObject({ accrued: 0, unsaved: false });
    expect(total("t1")).toBe(40); // 20 failed + 20 saved
  });

  it("a retry that can't run yet (bundle reloading) keeps 'not saved yet' and keeps retrying", async () => {
    let answer: () => boolean | Promise<boolean> = () => Promise.resolve(false);
    const { total, sink } = recordingSink(() => answer());
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(30_000);
    toggleFocusRunning(); // the save fails
    await settle();
    answer = () => false; // the retry finds the bundle reloading
    await rs.advanceTimersByTimeAsync(15_000);
    expect(getFocusSession()).toMatchObject({ accrued: 30, unsaved: true });
    answer = () => Promise.resolve(true);
    await rs.advanceTimersByTimeAsync(30_000); // the next retry saves it
    expect(getFocusSession()).toMatchObject({ accrued: 0, unsaved: false });
    expect(total("t1")).toBe(90); // failed + deferred + saved hand-offs of the same 30 s
  });

  it("seconds being saved aren't shown twice, and survive a reload mid-save", async () => {
    let finish: (ok: boolean) => void = () => {};
    const { sink } = recordingSink(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(30_000);
    toggleFocusRunning();
    // In flight: the Tasks module already shows them in the task's total.
    expect(getFocusSession().accrued).toBe(0);
    // The page reloads before the save confirms: once the hand-off is stale,
    // the seconds count as unsaved again rather than vanishing.
    newPage();
    rs.advanceTimersByTime(121_000);
    const retry = recordingSink();
    registerFocusFlushSink(WS, retry.sink);
    expect(retry.total("t1")).toBe(30);
    finish(true);
  });

  it("with no sink, accrued time is held and drains on register", () => {
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(7000);
    toggleFocusRunning();
    expect(getFocusSession().accrued).toBe(7);
    const { calls, sink } = recordingSink();
    registerFocusFlushSink(WS, sink);
    expect(calls).toEqual([{ taskId: "t1", seconds: 7 }]);
    expect(getFocusSession().accrued).toBe(0);
  });

  it("a sink that can't save yet (bundle loading) keeps the seconds without flagging them", () => {
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(45_000);
    toggleFocusRunning();
    const loading = recordingSink(() => false);
    registerFocusFlushSink(WS, loading.sink);
    expect(loading.calls).toEqual([{ taskId: "t1", seconds: 45 }]);
    expect(getFocusSession()).toMatchObject({ accrued: 45, unsaved: false });
    const loaded = recordingSink();
    registerFocusFlushSink(WS, loaded.sink);
    flushFocusSession(); // the post-load drain
    expect(loaded.total("t1")).toBe(45);
    expect(getFocusSession().accrued).toBe(0);
  });

  it("unregistering banks the time so far before the sink goes (navigating away)", () => {
    const { calls, sink } = recordingSink();
    const unregister = registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(9000);
    unregister();
    expect(calls).toEqual([{ taskId: "t1", seconds: 9 }]);
    expect(getFocusSession().running).toBe(true);
  });

  it("time on another workspace's task waits for that workspace's sink", () => {
    const here = recordingSink();
    registerFocusFlushSink(WS, here.sink);
    bindFocusTask(task("t9", "ws-2"));
    startFocus();
    rs.advanceTimersByTime(30_000);
    toggleFocusRunning();
    expect(here.calls).toHaveLength(0);
    expect(getFocusSession().accrued).toBe(30);
    const there = recordingSink();
    registerFocusFlushSink("ws-2", there.sink);
    expect(there.calls).toEqual([{ taskId: "t9", seconds: 30 }]);
  });

  it("the 60 s safety net saves while running", () => {
    const { total, sink } = recordingSink();
    registerFocusFlushSink(WS, sink);
    bindFocusTask(task("t1"));
    startFocus();
    rs.advanceTimersByTime(2 * MIN);
    expect(total("t1")).toBe(120);
    expect(getFocusSession().running).toBe(true);
  });
});

// Two engines over one storage behave like two browser tabs.
describe("focus engine — several tabs", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
  }

  function openTab(storage: ReturnType<typeof memoryStorage>, tabId: string): FocusEngine {
    const engine = createFocusEngine({
      storage: () => storage,
      now: () => Date.now(),
      readPrefs: () => ({ ...DEFAULT_FOCUS_PREFS, ...BASE_PREFS }) as FocusPrefs,
      alert: () => {},
      singleWindow: () => false,
      tabId,
    });
    engine.attach(USER);
    return engine;
  }

  let tabs: FocusEngine[] = [];
  afterEach(() => {
    for (const t of tabs) t.dispose();
    tabs = [];
  });

  it("a second tab mirrors the clock and never saves it twice", () => {
    const storage = memoryStorage();
    const a = openTab(storage, "a");
    const b = openTab(storage, "b");
    tabs = [a, b];
    const sa = recordingSink();
    const sb = recordingSink();
    a.registerSink(WS, sa.sink);
    b.registerSink(WS, sb.sink);
    a.bind(task("t1"));
    a.start();
    b.storageChanged(KEY); // the browser's storage event
    rs.advanceTimersByTime(2 * MIN);
    expect(b.getSnapshot()).toMatchObject({ running: true, sitElapsed: 120 });
    a.toggleRunning();
    expect(sa.total("t1")).toBe(120);
    expect(sb.calls).toHaveLength(0);
  });

  it("acting in the mirror takes the clock over", () => {
    const storage = memoryStorage();
    const a = openTab(storage, "a");
    const b = openTab(storage, "b");
    tabs = [a, b];
    const sa = recordingSink();
    const sb = recordingSink();
    a.registerSink(WS, sa.sink);
    b.registerSink(WS, sb.sink);
    a.bind(task("t1"));
    a.start();
    b.storageChanged(KEY);
    rs.advanceTimersByTime(30_000);
    b.toggleRunning(); // pause, from the other tab
    rs.advanceTimersByTime(MIN);
    expect(sb.total("t1")).toBe(30);
    expect(sa.calls).toHaveLength(0);
    expect(a.getSnapshot()).toMatchObject({ running: false });
  });

  it("a closing tab hands its clock over with no away gap", () => {
    const storage = memoryStorage();
    const a = openTab(storage, "a");
    const b = openTab(storage, "b");
    tabs = [a, b];
    a.bind(task("t1"));
    a.start();
    b.storageChanged(KEY);
    rs.advanceTimersByTime(30_000);
    a.release(); // pagehide
    a.dispose();
    rs.advanceTimersByTime(30_000);
    expect(b.getSnapshot()).toMatchObject({ running: true, sitElapsed: 60, away: null });
  });
});
