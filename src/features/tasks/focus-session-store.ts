// App-level Focus-session store (DF-11). The Execute/Focus timer used to live in
// component-local state inside execute-view.tsx, so a running session died the
// moment you navigated away from /tasks — the "focus dies on nav" critique
// blocker (CC-14). This lifts the authoritative session to a module-level
// `useSyncExternalStore` store (the focus-prefs.ts idiom) so:
//
//  1. The session survives navigation AND the AppChrome remount churn (a boot
//     footgun — component state in that subtree doesn't survive; gotchas §Routes).
//     State lives outside React entirely, so nothing that mounts/unmounts touches it.
//  2. A quiet chrome chip can mirror the running session from anywhere (it just
//     subscribes) — a passive indicator, never a second live tracker (the
//     2026-06-16 "live tracker stays Focus-only" lock — the chip links back to
//     Focus, it does not control the clock).
//  3. The 1 Hz tick keeps running while /tasks is unmounted, so elapsed + accrued
//     keep advancing; time flushes to the task through a sink the Tasks module
//     registers while it's mounted (and drains on return).
//
// The pomodoro/accrual behaviour is ported verbatim from the old `useFocusTimer`
// (opt-in stopwatch, never auto-starts; work seconds accrue, breaks don't; the
// big clock counts up as a stopwatch or down as a pomodoro; intervals / rhythm /
// auto-start / chime come from the persisted Focus prefs).

import { useSyncExternalStore } from "react";

import { readLocalFocusPrefs, type FocusPrefs } from "../../lib/focus-prefs";
import { areSoundsEnabled } from "../../lib/preferences";

// Persist accrued time periodically so a crash/reload loses at most this much.
const FLUSH_INTERVAL_SECONDS = 60;

/** The chrome chip requests "take me to Focus" via this event (already-mounted
 *  /tasks case). A one-shot flag (below) covers the not-yet-mounted case. */
export const FOCUS_VIEW_REQUEST_EVENT = "moduo:tasks:focus-view";

export type FocusPhase = "work" | "break";

export interface FocusSession {
  /** The task being focused. null = no session (nothing to show/track). */
  taskId: string | null;
  /** Task title — carried so the chrome chip needn't read the Tasks bundle. */
  taskTitle: string;
  /** Bucket name for quiet chip context (may be empty). */
  bucketName: string | null;
  /** Timer is open (the card shows the running/paused clock). */
  tracking: boolean;
  /** The clock is ticking (vs paused). */
  running: boolean;
  /** Pomodoro rhythm on (big clock counts down; work/break rollover). */
  pomodoro: boolean;
  phase: FocusPhase;
  /** The current break is a long break (after `sessionsBeforeLongBreak` blocks). */
  longBreak: boolean;
  /** Completed work blocks this session (drives the long-break rhythm). */
  completedWork: number;
  /** Pomodoro countdown, seconds. */
  pomoLeft: number;
  /** Stopwatch elapsed, seconds (counts the sitting up). */
  sitElapsed: number;
  /** Unflushed WORK seconds since the last flush — shown as the accruing total
   *  and drained into the task's persisted `timeSpentSeconds` by the sink. */
  accrued: number;
  // ── derived (computed on every commit so consumers stay trivial) ──
  /** "work" · "break" · "long break" — the pomodoro phase label. */
  phaseLabel: string;
  /** The number the big clock shows: pomodoro countdown, else stopwatch. */
  bigClock: number;
}

/** Flush sink: fold `seconds` of tracked work into `taskId`'s persisted total.
 *  Registered by the Tasks module while it's mounted (it owns the write path).
 *  Returns whether it actually persisted — `false` means "not now" (e.g. the
 *  bundle hasn't loaded yet), so the store RETAINS the seconds and retries. */
type FlushSink = (taskId: string, seconds: number) => boolean;

const REST: FocusSession = {
  taskId: null,
  taskTitle: "",
  bucketName: null,
  tracking: false,
  running: false,
  pomodoro: false,
  phase: "work",
  longBreak: false,
  completedWork: 0,
  pomoLeft: 0,
  sitElapsed: 0,
  accrued: 0,
  phaseLabel: "work",
  bigClock: 0,
};

// ── module state ──────────────────────────────────────────────────────────────
let session: FocusSession = REST;
const listeners = new Set<() => void>();
let tickHandle: number | null = null;
let flushHandle: number | null = null;
let flushSink: FlushSink | null = null;
// One-shot "open Focus" request (chip click → /tasks mount reads it). See event above.
let focusViewRequested = false;

function phaseLabelOf(s: Pick<FocusSession, "phase" | "longBreak">): string {
  return s.phase === "work" ? "work" : s.longBreak ? "long break" : "break";
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Merge a partial into the session, recompute derived fields, publish. */
function commit(patch: Partial<FocusSession>): void {
  const next = { ...session, ...patch };
  next.phaseLabel = phaseLabelOf(next);
  next.bigClock = next.pomodoro ? next.pomoLeft : next.sitElapsed;
  session = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): FocusSession {
  return session;
}

// ── flushing ──────────────────────────────────────────────────────────────────

/** Drain accrued work seconds into the task via the sink. No sink (Tasks
 *  unmounted) → the seconds stay accrued and drain when a sink re-registers, so
 *  navigating away never loses tracked time (it just flushes later). The sink
 *  reports whether it persisted: a `false` (bundle not loaded yet) RETAINS the
 *  seconds so the next drain — `flushFocusSession()` once loaded — banks them. */
function flush(): void {
  if (session.accrued < 1 || !session.taskId) return;
  if (!flushSink) return; // held until the Tasks module re-registers its sink
  const persisted = flushSink(session.taskId, session.accrued);
  if (persisted) commit({ accrued: 0 });
}

/** Drain any retained accrued seconds — call once the Tasks bundle has loaded so
 *  a register-time drain that hit an empty bundle finally banks (DF-11 BLOCKER). */
export function flushFocusSession(): void {
  flush();
}

function stopTimers(): void {
  if (tickHandle !== null) {
    window.clearInterval(tickHandle);
    tickHandle = null;
  }
  if (flushHandle !== null) {
    window.clearInterval(flushHandle);
    flushHandle = null;
  }
}

/** Advance one second. Ported from the old `useFocusTimer` tick + rollover: the
 *  stopwatch always counts up; work seconds accrue (breaks don't); a pomodoro
 *  countdown decrements and rolls over at zero. Runs even with zero subscribers
 *  (i.e. while /tasks is unmounted) — that's the whole point. */
function tick(): void {
  const isWork = !session.pomodoro || session.phase === "work";
  const patch: Partial<FocusSession> = {
    sitElapsed: session.sitElapsed + 1,
  };
  if (isWork) patch.accrued = session.accrued + 1;
  if (session.pomodoro) patch.pomoLeft = Math.max(0, session.pomoLeft - 1);
  commit(patch);
  if (session.pomodoro && session.pomoLeft === 0) rollover();
}

/** Pomodoro rollover: work → (long?) break → work on the persisted intervals.
 *  A finished work block banks its seconds and bumps the long-break counter;
 *  chime + auto-start (or pause-to-resume-by-hand) follow the prefs. */
function rollover(): void {
  const p = readLocalFocusPrefs();
  if (session.phase === "work") {
    flush(); // bank the finished work block before the break
    const nextCount = session.completedWork + 1;
    const isLong = nextCount % p.sessionsBeforeLongBreak === 0;
    commit({
      completedWork: nextCount,
      longBreak: isLong,
      phase: "break",
      pomoLeft: (isLong ? p.longBreakMinutes : p.breakMinutes) * 60,
    });
  } else {
    commit({
      longBreak: false,
      phase: "work",
      pomoLeft: p.workMinutes * 60,
    });
  }
  // The Focus chime respects both its own toggle and the app-wide sound master
  // switch (Settings → Preferences, DF-19f).
  if (p.soundEnabled && areSoundsEnabled()) playChime();
  if (!p.autoStartNext) setRunning(false);
}

/** Start/stop the 1 Hz tick + the crash-safety flush interval in lockstep with
 *  `running`. Flushing on pause is handled by the callers (parity with the old
 *  hook: pause flushes, the interval is only the periodic safety net). */
function setRunning(running: boolean): void {
  if (running === session.running) return;
  if (running) {
    commit({ running: true });
    stopTimers();
    tickHandle = window.setInterval(tick, 1000);
    flushHandle = window.setInterval(flush, FLUSH_INTERVAL_SECONDS * 1000);
  } else {
    commit({ running: false });
    stopTimers();
  }
}

// ── actions ───────────────────────────────────────────────────────────────────

/**
 * Bind the session to a task (the Execute view's "current" task). Same task →
 * refresh its label only (a rename mid-focus). Different task (or null) → flush
 * the prior task's accrued seconds and reset to the resting state bound to the
 * new one (never auto-starts). Mirrors the old hook's task-change effect; the
 * caller gates this on `!loading` so a transient empty bundle can't clear a live
 * session on remount.
 */
export function bindFocusTask(
  taskId: string | null,
  taskTitle = "",
  bucketName: string | null = null,
): void {
  if (taskId !== null && taskId === session.taskId) {
    if (taskTitle !== session.taskTitle || bucketName !== session.bucketName) {
      commit({ taskTitle, bucketName });
    }
    return;
  }
  flush(); // bank the prior task before we leave it
  setRunning(false);
  session = { ...REST, taskId, taskTitle, bucketName };
  session.phaseLabel = phaseLabelOf(session);
  session.bigClock = 0;
  emit();
}

/** Start tracking (opt-in — never auto-called). Needs a bound task. */
export function startFocus(): void {
  if (!session.taskId) return;
  const p = readLocalFocusPrefs();
  commit({
    tracking: true,
    sitElapsed: 0,
    accrued: 0,
    phase: "work",
    longBreak: false,
    completedWork: 0,
    pomoLeft: p.workMinutes * 60,
  });
  setRunning(true);
}

/** Pause / resume. Pause flushes the accrued seconds (parity with the old hook). */
export function toggleFocusRunning(): void {
  if (!session.tracking) return;
  if (session.running) {
    setRunning(false);
    flush();
  } else {
    setRunning(true);
  }
}

/** Stop tracking: flush, then reset the clock to resting (task stays bound so
 *  the card can re-offer "Track time" on the same task). */
export function stopFocus(): void {
  flush();
  setRunning(false);
  const p = readLocalFocusPrefs();
  commit({
    tracking: false,
    sitElapsed: 0,
    accrued: 0,
    phase: "work",
    longBreak: false,
    completedWork: 0,
    pomoLeft: p.workMinutes * 60,
  });
}

/** Toggle the pomodoro rhythm; resets the phase/counters like the old hook. */
export function toggleFocusPomodoro(): void {
  const p = readLocalFocusPrefs();
  commit({
    pomodoro: !session.pomodoro,
    phase: "work",
    longBreak: false,
    completedWork: 0,
    pomoLeft: p.workMinutes * 60,
  });
}

/**
 * Live-preview the pomodoro interval while idle: when not running, `pomoLeft`
 * just previews the current phase's full interval, so editing Work/Break in
 * Settings → Focus (or the ⋯ popover) updates the big clock immediately instead
 * of only on the next start. No-op while running (never disturb a live count).
 */
export function previewFocusInterval(prefs: FocusPrefs): void {
  if (session.running || !session.tracking) return;
  const seconds =
    session.phase === "work"
      ? prefs.workMinutes * 60
      : (session.longBreak ? prefs.longBreakMinutes : prefs.breakMinutes) * 60;
  if (seconds !== session.pomoLeft) commit({ pomoLeft: seconds });
}

/**
 * Register the flush sink (the Tasks module's `addTimeSpent`). Immediately drains
 * any backlog accrued while no sink was attached (i.e. accrued off-screen), and
 * flushes once more on unregister so navigating away banks time up to that point.
 * Returns the unregister fn for an effect cleanup.
 */
export function registerFocusFlushSink(sink: FlushSink): () => void {
  flushSink = sink;
  flush(); // drain anything accrued while unmounted
  return () => {
    if (flushSink !== sink) return;
    flush(); // bank accrued-so-far before the sink disappears
    flushSink = null;
  };
}

/** Chip → "open Focus". Sets a one-shot flag (consumed on the /tasks mount that
 *  wasn't listening yet) and fires an event (heard by an already-mounted /tasks). */
export function requestFocusView(): void {
  focusViewRequested = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FOCUS_VIEW_REQUEST_EVENT));
  }
}

/** Read-and-clear the one-shot "open Focus" flag. */
export function consumeFocusViewRequest(): boolean {
  const requested = focusViewRequested;
  focusViewRequested = false;
  return requested;
}

// ── React binding ─────────────────────────────────────────────────────────────

/** Subscribe to the live Focus session. Re-renders each second while running. */
export function useFocusSession(): FocusSession {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-reactive read of the current session (tests / imperative callers). */
export function getFocusSession(): FocusSession {
  return session;
}

/** Reset everything — test seam only. */
export function __resetFocusSessionForTest(): void {
  stopTimers();
  flushSink = null;
  focusViewRequested = false;
  session = REST;
  listeners.clear();
}

// ── chime ─────────────────────────────────────────────────────────────────────

/** A short end-of-interval chime via Web Audio — no asset, gated by the sound
 *  pref. Silent where Web Audio is unavailable. */
function playChime(): void {
  if (typeof window === "undefined") return;
  const Ctx =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.42);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio unavailable — silent */
  }
}
