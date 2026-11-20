// The one time engine's surface for every page (TV-F6, spec §6.10, §Assumptions
// #11): Focus (TV-F7 builds its screen on this), the top-bar timer (call 96),
// Calendar's ▶ on a block, Home's pomodoro, and later the time report
// (TV-D14). One clock: the engine on the device in control (engine.ts), the
// shared record of it for my other devices (run.ts), its saves through the one
// app-shell sink (time-sink.ts).
//
//  - `useFocusTimer()` reads the session wherever it runs: this device's clock,
//    or another device's run read through ("on your other device").
//  - Act through `focusOn`, `toggleFocusPause`, `stopFocusSession` (+ Undo)
//    and `changeFocusTimer`: each takes the run over first when another
//    device has it, so two devices never both count (AC8.11).
//  - `bigClock` is the one number per job (62): Pomodoro's countdown, the Now
//    task's own clock (Per task), or nothing (Off: no clock, nothing recorded).
//    Saved totals are the task's `timeSpentSeconds` in the shared store; the
//    seconds not saved yet are `accrued` (here only).

import type { FocusTimerMode } from "@contracts/vocabularies";
import { useSyncExternalStore } from "react";

import {
  bindFocusTask,
  canUndoFocusStop,
  type FocusAwaySummary,
  focusOnTask,
  type FocusTaskRef,
  getFocusSession,
  setFocusTimer,
  skipFocusBreak,
  STOP_UNDO_MS,
  stopFocus,
  subscribeFocusSession,
  toggleFocusRunning,
  useFocusSession,
} from "./engine";
import {
  getFocusRunState,
  isRunInControl,
  subscribeFocusRun,
  takeRunControl,
  type TaskRefResolver,
  undoStopKeepingRun,
  useFocusRunState,
  useRunReadThrough,
} from "./run";

export type { FocusTimerMode };
export { STOP_UNDO_MS };

/** What every surface shows of the session. */
export interface FocusTimerView {
  /** A session is on, here or on another of my devices. */
  active: boolean;
  /** Read through from another device (acting here takes it over). */
  elsewhere: boolean;
  running: boolean;
  timer: FocusTimerMode;
  phase: "work" | "break";
  longBreak: boolean;
  /** "work" · "break" · "long break". */
  phaseLabel: string;
  /** The number a clock shows (see the header). 0 under Off. */
  bigClock: number;
  /** The Per task clock: seconds on the Now task this session. */
  taskSeconds: number;
  /** The current Pomodoro phase's length, seconds (0 otherwise). */
  phaseSeconds: number;
  /** Focused time this session (the bottom line's "1h 12m"). */
  sessionSeconds: number;
  /** Seconds on the Now task not in its saved total yet (here only). */
  accrued: number;
  taskId: string | null;
  taskTitle: string;
  workspaceId: string | null;
  /** "While you were away" waiting for an answer (here only). */
  away: FocusAwaySummary | null;
  /** Some tracked time hasn't saved yet; it's being retried (here only). */
  unsaved: boolean;
}

/** The session, wherever it runs. Re-renders each second while it runs. */
export function useFocusTimer(): FocusTimerView {
  const session = useFocusSession();
  const { run } = useFocusRunState();
  const reading = useRunReadThrough(run);
  const here = session.tracking;
  if (here || !run || !reading) {
    return {
      active: session.tracking,
      elsewhere: false,
      running: session.running,
      timer: session.timer,
      phase: session.phase,
      longBreak: session.longBreak,
      phaseLabel: session.phaseLabel,
      bigClock: session.bigClock,
      taskSeconds: session.taskSeconds,
      phaseSeconds: session.timer === "pomodoro" ? session.phaseSeconds : 0,
      sessionSeconds: session.sitElapsed,
      accrued: session.accrued,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      workspaceId: session.workspaceId,
      away: session.away,
      unsaved: session.unsaved,
    };
  }
  const longBreak = reading.phase === "long_break";
  const phase = reading.phase === "work" ? "work" : "break";
  return {
    active: true,
    elsewhere: true,
    running: reading.running,
    timer: reading.timer,
    phase,
    longBreak,
    phaseLabel: phase === "work" ? "work" : longBreak ? "long break" : "break",
    bigClock: reading.bigClock,
    taskSeconds: reading.timer === "per_task" ? reading.phaseElapsed : 0,
    phaseSeconds: reading.timer === "pomodoro" ? (run.phaseSeconds ?? 0) : 0,
    sessionSeconds: reading.focusedSeconds,
    accrued: 0,
    taskId: run.nowTaskId,
    taskTitle: run.nowTitle ?? "",
    workspaceId: run.workspaceId,
    away: null,
    unsaved: session.unsaved,
  };
}

/** Which task the session is on and whether it runs, without the clock. */
export interface FocusTaskState {
  active: boolean;
  elsewhere: boolean;
  running: boolean;
  taskId: string | null;
  workspaceId: string | null;
  /** The session's Timer (Focus puts Pomodoro's pill in its header); null with none. */
  timer: FocusTimerMode | null;
}

const NO_TASK: FocusTaskState = {
  active: false,
  elsewhere: false,
  running: false,
  taskId: null,
  workspaceId: null,
  timer: null,
};
let cachedTaskState: FocusTaskState = NO_TASK;

function taskStateNow(): FocusTaskState {
  const s = getFocusSession();
  const { run } = getFocusRunState();
  const next: FocusTaskState = s.tracking
    ? {
        active: true,
        elsewhere: false,
        running: s.running,
        taskId: s.taskId,
        workspaceId: s.workspaceId,
        timer: s.timer,
      }
    : run
      ? {
          active: true,
          elsewhere: true,
          running: run.status === "running",
          taskId: run.nowTaskId,
          workspaceId: run.workspaceId,
          timer: run.mode,
        }
      : NO_TASK;
  const c = cachedTaskState;
  if (
    c.active === next.active &&
    c.elsewhere === next.elsewhere &&
    c.running === next.running &&
    c.taskId === next.taskId &&
    c.workspaceId === next.workspaceId &&
    c.timer === next.timer
  ) {
    return c;
  }
  cachedTaskState = next;
  return next;
}

function subscribeTaskState(listener: () => void): () => void {
  const a = subscribeFocusSession(listener);
  const b = subscribeFocusRun(listener);
  return () => {
    a();
    b();
  };
}

/**
 * The session's task and whether it runs, for pages that mark it (a Calendar
 * block, a row) without redrawing every second like `useFocusTimer`.
 */
export function useFocusTaskState(): FocusTaskState {
  return useSyncExternalStore(subscribeTaskState, taskStateNow, taskStateNow);
}

/** Another device runs my session: this device takes it over first. */
function takeOverIfElsewhere(resolveTask?: TaskRefResolver): void {
  const { run } = getFocusRunState();
  if (!run) return;
  if (isRunInControl(run) && getFocusSession().tracking) return;
  takeRunControl(resolveTask);
}

/**
 * "Focus on this" (⇧F, Calendar's ▶ on a block, Home's Start; call 66): the
 * task gets the clock now. A session on (here or elsewhere) moves to it with
 * its rhythm; none starts one with `timer` (the person's default, from Focus
 * prefs). The caller puts the task on top of Up next (`addToQueue(id, "top")`).
 */
export function focusOn(
  task: FocusTaskRef,
  opts: { timer: FocusTimerMode; resolveTask?: TaskRefResolver },
): void {
  takeOverIfElsewhere(opts.resolveTask);
  focusOnTask(task, opts.timer);
}

/**
 * Act on the session here: when another device runs it, this device takes it
 * over first (Focus's Done counts the task on the device that runs the clock).
 */
export function takeOverFocus(resolveTask?: TaskRefResolver): void {
  takeOverIfElsewhere(resolveTask);
}

/**
 * Done or Skip on the task the session is on (Focus's Now card, TV-F7): the
 * session moves to `task` with its rhythm, running or paused as it was; null
 * ends it (Up next ran out). Takes the run over first when another device has
 * it. Without a session nothing happens: Done and Skip never start one.
 */
export function moveFocusTo(task: FocusTaskRef | null, resolveTask?: TaskRefResolver): void {
  const { run } = getFocusRunState();
  if (!getFocusSession().tracking && !run) return;
  takeOverIfElsewhere(resolveTask);
  bindFocusTask(task);
}

/** Pause or resume, wherever the session runs (Pause lives in the pill, 62). */
export function toggleFocusPause(resolveTask?: TaskRefResolver): void {
  const { run } = getFocusRunState();
  if (!getFocusSession().tracking && !run) return;
  takeOverIfElsewhere(resolveTask);
  toggleFocusRunning();
}

/**
 * Skip Pomodoro's break (Focus's between-tasks offer, TV-F8): a work block
 * starts now. Takes the run over first when another device has it.
 */
export function skipFocusBreakHere(resolveTask?: TaskRefResolver): void {
  const { run } = getFocusRunState();
  if (!getFocusSession().tracking && !run) return;
  takeOverIfElsewhere(resolveTask);
  skipFocusBreak();
}

/**
 * Stop the session (⋯ and the top-bar timer, never next to Pause, 62a). True
 * when it stopped: show "Stopped · Undo" for STOP_UNDO_MS and call
 * `undoFocusStop` from it. The run ends everywhere once the window passes.
 */
export function stopFocusSession(resolveTask?: TaskRefResolver): boolean {
  const { run } = getFocusRunState();
  if (!getFocusSession().tracking && !run) return false;
  takeOverIfElsewhere(resolveTask);
  return stopFocus();
}

/** Undo a Stop inside its window: the clock reads as if it never stopped. */
export function undoFocusStop(): boolean {
  return undoStopKeepingRun();
}

/** Whether "Stopped · Undo" can still bring the session back. */
export function canUndoStop(): boolean {
  return canUndoFocusStop();
}

/**
 * Change the running session's timer (Focus's ⋯ → Timer ▸). The caller also
 * saves it as the person's default (`useFocusPrefs().setPrefs({ timer })`): the
 * menu changes it everywhere (63).
 */
export function changeFocusTimer(timer: FocusTimerMode, resolveTask?: TaskRefResolver): void {
  const { run } = getFocusRunState();
  if (run && !getFocusSession().tracking) takeOverIfElsewhere(resolveTask);
  setFocusTimer(timer);
}
