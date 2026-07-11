import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetFocusSessionForTest,
  bindFocusTask,
  consumeFocusViewRequest,
  flushFocusSession,
  getFocusSession,
  previewFocusInterval,
  registerFocusFlushSink,
  requestFocusView,
  startFocus,
  stopFocus,
  toggleFocusPomodoro,
  toggleFocusRunning,
} from "./focus-session-store";
import { DEFAULT_FOCUS_PREFS } from "../../lib/focus-prefs";

// Drive the pomodoro intervals the store reads from persisted Focus prefs.
function setPrefs(patch: Partial<typeof DEFAULT_FOCUS_PREFS>): void {
  localStorage.setItem("moduo.focus", JSON.stringify({ ...DEFAULT_FOCUS_PREFS, ...patch }));
}

// A sink that records every (taskId, seconds) flush. `persist` models the real
// `addTimeSpent` contract: it returns whether the delta was actually persisted
// (false = task not in the loaded bundle → the store must retain & retry).
function recordingSink(persist = true) {
  const calls: Array<{ taskId: string; seconds: number }> = [];
  const sink = (taskId: string, seconds: number) => {
    calls.push({ taskId, seconds });
    return persist;
  };
  return { calls, sink };
}

beforeEach(() => {
  __resetFocusSessionForTest();
  localStorage.clear();
  setPrefs({ workMinutes: 1, breakMinutes: 1, longBreakMinutes: 2, sessionsBeforeLongBreak: 2 });
  vi.useFakeTimers();
});

afterEach(() => {
  __resetFocusSessionForTest();
  vi.useRealTimers();
});

describe("focus-session store — session lifecycle", () => {
  it("is idle at rest (no task, not tracking)", () => {
    const s = getFocusSession();
    expect(s.taskId).toBeNull();
    expect(s.tracking).toBe(false);
    expect(s.running).toBe(false);
  });

  it("bind then start begins an opt-in, running session on the bound task", () => {
    bindFocusTask("t1", "Write spec", "Inbox");
    expect(getFocusSession().tracking).toBe(false); // never auto-starts
    startFocus();
    const s = getFocusSession();
    expect(s.taskId).toBe("t1");
    expect(s.taskTitle).toBe("Write spec");
    expect(s.tracking).toBe(true);
    expect(s.running).toBe(true);
  });

  it("startFocus is a no-op without a bound task", () => {
    startFocus();
    expect(getFocusSession().tracking).toBe(false);
  });

  it("accrues work seconds and elapsed as the clock ticks", () => {
    bindFocusTask("t1", "A");
    startFocus();
    vi.advanceTimersByTime(5000);
    const s = getFocusSession();
    expect(s.sitElapsed).toBe(5);
    expect(s.accrued).toBe(5);
    expect(s.bigClock).toBe(5); // stopwatch (no pomodoro)
  });

  it("keeps ticking with zero subscribers (survives an unmounted /tasks)", () => {
    bindFocusTask("t1", "A");
    startFocus();
    // No React subscribers at all — the interval must still advance the store.
    vi.advanceTimersByTime(10_000);
    expect(getFocusSession().sitElapsed).toBe(10);
  });
});

describe("focus-session store — flushing", () => {
  it("pause flushes accrued work to the sink and stops the clock", () => {
    const { calls, sink } = recordingSink();
    registerFocusFlushSink(sink);
    bindFocusTask("t1", "A");
    startFocus();
    vi.advanceTimersByTime(3000);
    toggleFocusRunning(); // pause
    expect(getFocusSession().running).toBe(false);
    expect(calls).toEqual([{ taskId: "t1", seconds: 3 }]);
    expect(getFocusSession().accrued).toBe(0);
  });

  it("stop flushes and returns to a resting state on the same task", () => {
    const { calls, sink } = recordingSink();
    registerFocusFlushSink(sink);
    bindFocusTask("t1", "A");
    startFocus();
    vi.advanceTimersByTime(4000);
    stopFocus();
    const s = getFocusSession();
    expect(calls).toEqual([{ taskId: "t1", seconds: 4 }]);
    expect(s.tracking).toBe(false);
    expect(s.sitElapsed).toBe(0);
    expect(s.taskId).toBe("t1"); // stays bound — card re-offers Track time
  });

  it("the 60s safety net flushes without pausing", () => {
    const { calls, sink } = recordingSink();
    registerFocusFlushSink(sink);
    bindFocusTask("t1", "A");
    startFocus();
    vi.advanceTimersByTime(60_000);
    // Order-independent: the tick(60) and the 60s flush land on the same instant,
    // so the 60 tracked seconds may bank as one call or split — either way every
    // banked + still-accrued second is accounted for and none double-counted.
    const banked = calls.reduce((sum, c) => sum + c.seconds, 0);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.every((c) => c.taskId === "t1")).toBe(true);
    expect(banked + getFocusSession().accrued).toBe(60);
    expect(getFocusSession().running).toBe(true); // still going
  });

  it("with no sink, accrued time is held (never lost) and drains on register", () => {
    bindFocusTask("t1", "A");
    startFocus();
    vi.advanceTimersByTime(7000);
    toggleFocusRunning(); // pause — no sink yet, so accrued is held
    expect(getFocusSession().accrued).toBe(7);
    const { calls, sink } = recordingSink();
    registerFocusFlushSink(sink); // registering drains the backlog
    expect(calls).toEqual([{ taskId: "t1", seconds: 7 }]);
    expect(getFocusSession().accrued).toBe(0);
  });

  it("retains accrued when the sink can't persist yet, and banks it on the next drain", () => {
    // Models a /tasks remount where the register-time drain fires BEFORE load()
    // has populated the bundle: the sink drops the write (returns false), so the
    // away-accrued time must be RETAINED — not silently zeroed (the DF-11 blocker).
    bindFocusTask("t1", "A");
    startFocus();
    vi.advanceTimersByTime(45_000);
    toggleFocusRunning(); // pause — accrued = 45, no sink yet

    const notLoaded = recordingSink(false); // bundle not loaded → drops
    registerFocusFlushSink(notLoaded.sink); // drain-on-register hits empty bundle
    expect(notLoaded.calls).toEqual([{ taskId: "t1", seconds: 45 }]);
    expect(getFocusSession().accrued).toBe(45); // RETAINED, not lost

    const loaded = recordingSink(true); // bundle now loaded → persists
    registerFocusFlushSink(loaded.sink);
    flushFocusSession(); // the post-load drain
    // 45 banked (register-time drain + explicit drain both fire against the
    // loaded sink; only one persists non-zero, the other no-ops at accrued 0).
    expect(loaded.calls.reduce((s, c) => s + c.seconds, 0)).toBe(45);
    expect(getFocusSession().accrued).toBe(0);
  });

  it("unregister banks accrued-so-far before the sink disappears (nav away)", () => {
    const { calls, sink } = recordingSink();
    const unregister = registerFocusFlushSink(sink);
    bindFocusTask("t1", "A");
    startFocus();
    vi.advanceTimersByTime(9000);
    unregister(); // /tasks unmounts mid-session
    expect(calls).toEqual([{ taskId: "t1", seconds: 9 }]);
    expect(getFocusSession().running).toBe(true); // session keeps running
  });
});

describe("focus-session store — task binding", () => {
  it("binding a different task flushes the prior task and resets", () => {
    const { calls, sink } = recordingSink();
    registerFocusFlushSink(sink);
    bindFocusTask("t1", "A");
    startFocus();
    vi.advanceTimersByTime(6000);
    bindFocusTask("t2", "B"); // e.g. marked t1 done → advance to t2
    expect(calls).toEqual([{ taskId: "t1", seconds: 6 }]);
    const s = getFocusSession();
    expect(s.taskId).toBe("t2");
    expect(s.tracking).toBe(false); // fresh task, opt-in again
    expect(s.sitElapsed).toBe(0);
  });

  it("binding the same task keeps a running session intact (return from nav)", () => {
    bindFocusTask("t1", "A", "Inbox");
    startFocus();
    vi.advanceTimersByTime(5000);
    bindFocusTask("t1", "A", "Inbox"); // Execute remounts, re-binds the same task
    const s = getFocusSession();
    expect(s.running).toBe(true);
    expect(s.sitElapsed).toBe(5); // uninterrupted
  });

  it("binding the same task refreshes a renamed title without resetting", () => {
    bindFocusTask("t1", "A");
    startFocus();
    vi.advanceTimersByTime(3000);
    bindFocusTask("t1", "A renamed");
    const s = getFocusSession();
    expect(s.taskTitle).toBe("A renamed");
    expect(s.sitElapsed).toBe(3);
    expect(s.running).toBe(true);
  });

  it("binding null ends the session (queue emptied)", () => {
    const { calls, sink } = recordingSink();
    registerFocusFlushSink(sink);
    bindFocusTask("t1", "A");
    startFocus();
    vi.advanceTimersByTime(2000);
    bindFocusTask(null);
    expect(calls).toEqual([{ taskId: "t1", seconds: 2 }]);
    expect(getFocusSession().taskId).toBeNull();
    expect(getFocusSession().tracking).toBe(false);
  });
});

describe("focus-session store — pomodoro", () => {
  it("rolls work → break at the interval, banking the work block", () => {
    const { calls, sink } = recordingSink();
    registerFocusFlushSink(sink);
    bindFocusTask("t1", "A");
    toggleFocusPomodoro(); // pomodoro on (workMinutes=1 → 60s)
    startFocus();
    expect(getFocusSession().pomoLeft).toBe(60);
    vi.advanceTimersByTime(60_000); // one work block
    const s = getFocusSession();
    expect(s.phase).toBe("break");
    expect(s.pomoLeft).toBe(60); // breakMinutes=1
    expect(s.completedWork).toBe(1);
    // Banked at rollover (may split with the coincident 60s safety flush).
    expect(calls.reduce((sum, c) => sum + c.seconds, 0)).toBe(60);
    expect(s.accrued).toBe(0);
  });

  it("does not accrue work time during a break", () => {
    bindFocusTask("t1", "A");
    toggleFocusPomodoro();
    startFocus();
    setPrefs({ workMinutes: 1, breakMinutes: 1, autoStartNext: true });
    vi.advanceTimersByTime(60_000); // finish work → break (accrued flushed to held 0)
    const accruedAtBreakStart = getFocusSession().accrued;
    vi.advanceTimersByTime(10_000); // 10s into the break
    expect(getFocusSession().phase).toBe("break");
    expect(getFocusSession().accrued).toBe(accruedAtBreakStart); // unchanged during break
  });

  it("pauses at rollover unless auto-start is enabled", () => {
    setPrefs({ workMinutes: 1, breakMinutes: 1, autoStartNext: false });
    bindFocusTask("t1", "A");
    toggleFocusPomodoro();
    startFocus();
    vi.advanceTimersByTime(60_000);
    expect(getFocusSession().running).toBe(false); // pauses for a manual resume
  });

  it("previewFocusInterval updates the idle clock when work length changes", () => {
    bindFocusTask("t1", "A");
    toggleFocusPomodoro();
    startFocus();
    toggleFocusRunning(); // pause (idle preview allowed)
    previewFocusInterval({ ...DEFAULT_FOCUS_PREFS, workMinutes: 45 });
    expect(getFocusSession().pomoLeft).toBe(45 * 60);
  });
});

describe("focus-session store — open-Focus request", () => {
  it("requestFocusView sets a one-shot flag consumed once", () => {
    expect(consumeFocusViewRequest()).toBe(false);
    requestFocusView();
    expect(consumeFocusViewRequest()).toBe(true);
    expect(consumeFocusViewRequest()).toBe(false); // one-shot
  });

  it("requestFocusView dispatches the window event for a mounted /tasks", () => {
    const handler = vi.fn();
    window.addEventListener("moduo:tasks:focus-view", handler);
    requestFocusView();
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("moduo:tasks:focus-view", handler);
  });
});
