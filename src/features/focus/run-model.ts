// Focus runs, the pure rules (salvaged from #323, re-cut in TV-F6). A run is
// my Focus session's shared record: the clock stays on the device (the engine,
// engine.ts), and `focus_runs` carries the session to my other devices and
// tells teammates "<name> is on this". Everything here takes `now` explicitly.
//
// The timer (62a): per_task · pomodoro · off. Per task, `phase_started_at`
// is when the clock on the Now task began (moved forward by pauses), so another
// device reads the task's own clock; Pomodoro, when the phase began; Off has no
// clock. `focused_seconds` is the session's focused time either way.

import {
  type FocusRunPhase,
  type FocusRunStatus,
  type FocusTimerMode,
  isFocusRunPhase,
  isFocusRunStatus,
  isFocusTimerMode,
} from "@contracts/vocabularies";
import type { Truncation } from "../../lib/paged-select";
import type { TaskQueueEntry } from "../tasks/model";
import type { FocusRunClock, FocusSession, FocusTaskRef } from "./engine-core";

export type { FocusRunPhase, FocusRunStatus, FocusTimerMode };

/** My run, as `focus_runs` holds it (or as this device holds it until saved). */
export interface FocusRun {
  id: string;
  workspaceId: string;
  userId: string;
  status: FocusRunStatus;
  mode: FocusTimerMode;
  startedAt: string;
  endedAt: string | null;
  /** The task the run is on: the head of my Up next. */
  nowTaskId: string | null;
  /** Its title as this device last knew it (the top-bar timer; never sent). */
  nowTitle?: string | null;
  phase: FocusRunPhase;
  /** Per task: when the Now task's clock began; Pomodoro: when the phase did.
   *  Moved forward by pauses. */
  phaseStartedAt: string;
  /** The phase's length, seconds (Pomodoro only). */
  phaseSeconds: number | null;
  pausedAt: string | null;
  blocksCompleted: number;
  /** Focused time this run, as of `seenAt`. */
  focusedSeconds: number;
  /** Tasks done in this run, in order ("2 done · Show"). */
  doneTaskIds: string[];
  /** The device in control, since when, and its last write. */
  deviceId: string;
  controlAt: string;
  seenAt: string;
  /** Only on this device: the start hasn't been answered (or runs aren't on
   *  the server yet). */
  local?: boolean;
}

/** Who else is on which task right now ("<name> is on this"). */
export interface FocusClaim {
  userId: string;
  taskId: string;
}

/**
 * The runtime seam (src/lib/runtime.focus.web.ts). Each call degrades while
 * the migration isn't on the database: no run there (null), no claims.
 */
export interface FocusRunRuntime {
  /** My latest run, open or ended, in any workspace (null: none yet). */
  latestRun(): Promise<FocusRun | null>;
  /** Start a run; any open run of mine ends first. Null: runs aren't on the server. */
  startRun(input: {
    workspaceId: string;
    deviceId: string;
    mode: FocusTimerMode;
    state: Partial<FocusRunSnapshot>;
  }): Promise<FocusRun | null>;
  /** Save this device's state of my run. A device not in control gets the row
   *  back unchanged unless it `take`s control. */
  saveRun(input: {
    runId: string;
    deviceId: string;
    take: boolean;
    state: Partial<FocusRunSnapshot>;
  }): Promise<FocusRun | null>;
  /** End my run from any of my devices, with the final numbers. */
  endRun(input: {
    runId: string;
    deviceId: string;
    state: Partial<FocusRunSnapshot>;
  }): Promise<FocusRun | null>;
  /** Teammates on tasks I can see, right now. */
  listClaims(workspaceId: string): Promise<FocusClaim[]>;
  /** My runs in a workspace, newest first (the data export). */
  listMyRuns(workspaceId: string): Promise<{ runs: FocusRun[]; truncated: Truncation[] }>;
  /** "Keep all" for a stale line-up: my queue counts as looked at. */
  keepLineUp(workspaceId: string): Promise<TaskQueueEntry[] | null>;
  /**
   * Give back seconds this device saved on a task after another device took
   * the run over (they were counted there too): one negative adjustment
   * through `tasks_op_track_time`, under `key` so a resend counts once.
   */
  giveBackTime(input: {
    workspaceId: string;
    taskId: string;
    seconds: number;
    key: string;
  }): Promise<void>;
}

/** What a device sends: the run's state as its clock has it now. */
export interface FocusRunSnapshot {
  status: "running" | "paused";
  mode: FocusTimerMode;
  nowTaskId: string | null;
  phase: FocusRunPhase;
  phaseStartedAt: string;
  phaseSeconds: number | null;
  pausedAt: string | null;
  blocksCompleted: number;
  focusedSeconds: number;
  doneTaskIds: string[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function int(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** A `focus_runs` row → the model; null for anything that isn't one. A run
 *  with a timer this build doesn't know reads as Per task. */
export function focusRunRowToModel(row: unknown): FocusRun | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  const workspaceId = str(r.workspace_id);
  const userId = str(r.user_id);
  if (!id || !workspaceId || !userId) return null;
  if (!isFocusRunStatus(r.status) || !isFocusRunPhase(r.phase)) return null;
  const mode: FocusTimerMode = isFocusTimerMode(r.mode) ? r.mode : "per_task";
  const seenAt = str(r.seen_at) ?? new Date(0).toISOString();
  return {
    id,
    workspaceId,
    userId,
    status: r.status,
    mode,
    startedAt: str(r.started_at) ?? seenAt,
    endedAt: str(r.ended_at),
    nowTaskId: str(r.now_task_id),
    nowTitle: typeof r.now_task_title === "string" ? r.now_task_title : null,
    phase: mode === "pomodoro" ? r.phase : "work",
    phaseStartedAt: str(r.phase_started_at) ?? seenAt,
    phaseSeconds: r.phase_seconds == null ? null : int(r.phase_seconds),
    pausedAt: str(r.paused_at),
    blocksCompleted: Math.max(0, int(r.blocks_completed)),
    focusedSeconds: Math.max(0, int(r.focused_seconds)),
    doneTaskIds: Array.isArray(r.done_task_ids)
      ? r.done_task_ids.filter((x): x is string => typeof x === "string")
      : [],
    deviceId: str(r.device_id) ?? "",
    controlAt: str(r.control_at) ?? seenAt,
    seenAt,
  };
}

/** The snapshot as the ops take it (`p_state`). */
export function runSnapshotToState(s: Partial<FocusRunSnapshot>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.status !== undefined) out.status = s.status;
  if (s.mode !== undefined) out.mode = s.mode;
  if (s.nowTaskId !== undefined) out.now_task_id = s.nowTaskId;
  if (s.phase !== undefined) out.phase = s.phase;
  if (s.phaseStartedAt !== undefined) out.phase_started_at = s.phaseStartedAt;
  if (s.phaseSeconds !== undefined) out.phase_seconds = s.phaseSeconds;
  if (s.pausedAt !== undefined) out.paused_at = s.pausedAt;
  if (s.blocksCompleted !== undefined) out.blocks_completed = s.blocksCompleted;
  if (s.focusedSeconds !== undefined) out.focused_seconds = s.focusedSeconds;
  if (s.doneTaskIds !== undefined) out.done_task_ids = s.doneTaskIds;
  return out;
}

/**
 * The run's state as this device's clock (the engine session) has it at
 * `now`. Elapsed time is turned into a start moment, so every device computes
 * the same clock from it.
 */
export function runSnapshotFromSession(
  session: FocusSession,
  run: Pick<FocusRun, "nowTaskId" | "doneTaskIds" | "pausedAt">,
  now: number,
): FocusRunSnapshot {
  const mode = session.timer;
  const pomodoro = mode === "pomodoro";
  const phaseSeconds = pomodoro ? Math.max(1, session.phaseSeconds) : null;
  const elapsed = pomodoro
    ? Math.max(0, (phaseSeconds ?? 0) - session.pomoLeft)
    : mode === "per_task"
      ? Math.max(0, session.taskSeconds)
      : 0;
  const paused = !session.running;
  const pausedAtMs = paused ? (run.pausedAt ? Date.parse(run.pausedAt) : now) : now;
  return {
    status: paused ? "paused" : "running",
    mode,
    nowTaskId: run.nowTaskId,
    phase:
      !pomodoro || session.phase === "work" ? "work" : session.longBreak ? "long_break" : "break",
    phaseStartedAt: new Date(pausedAtMs - elapsed * 1000).toISOString(),
    phaseSeconds,
    pausedAt: paused ? new Date(pausedAtMs).toISOString() : null,
    blocksCompleted: session.completedWork,
    focusedSeconds: Math.max(0, session.sitElapsed),
    doneTaskIds: run.doneTaskIds,
  };
}

/** How far past the device's last save a read-through clock keeps counting:
 *  the claims window (focus_claims, 3 minutes). */
export const READ_THROUGH_MAX_S = 180;

/** A run's clock read from its record (another device's run, read through). */
export interface FocusRunReading {
  running: boolean;
  timer: FocusTimerMode;
  phase: FocusRunPhase;
  /** Seconds into the current phase (Per task: the Now task's clock). */
  phaseElapsed: number;
  /** Seconds left in the phase (Pomodoro), else 0. */
  phaseLeft: number;
  /** The number a clock shows: the countdown, the task's clock, or 0 (Off). */
  bigClock: number;
  /** Focused time this run. */
  focusedSeconds: number;
}

export function readRunClock(run: FocusRun, now: number): FocusRunReading {
  const running = run.status === "running";
  const timer = run.mode;
  const at = running ? now : run.pausedAt ? Date.parse(run.pausedAt) : now;
  const rawElapsed = Math.max(0, Math.floor((at - Date.parse(run.phaseStartedAt)) / 1000));
  // A device that slept or died keeps no clock: past its last save plus the
  // claims window nothing more counts (never an inflated number).
  const seen = Date.parse(run.seenAt);
  const liveFor = running ? Math.max(0, Math.floor((now - seen) / 1000)) : 0;
  const overrun = Math.max(0, liveFor - READ_THROUGH_MAX_S);
  const phaseElapsed = timer === "off" ? 0 : Math.max(0, rawElapsed - overrun);
  const phaseLeft = timer === "pomodoro" ? Math.max(0, (run.phaseSeconds ?? 0) - phaseElapsed) : 0;
  const sinceSeen =
    running && run.phase === "work" && timer !== "off" ? Math.min(READ_THROUGH_MAX_S, liveFor) : 0;
  const focusedSeconds = run.focusedSeconds + sinceSeen;
  return {
    running,
    timer,
    phase: run.phase,
    phaseElapsed,
    phaseLeft,
    bigClock: timer === "pomodoro" ? phaseLeft : timer === "per_task" ? phaseElapsed : 0,
    focusedSeconds,
  };
}

/** The run as the engine takes it over on this device (see adoptSession). */
export function runClockForAdopt(
  run: FocusRun,
  task: FocusTaskRef | null,
  now: number,
): FocusRunClock {
  const reading = readRunClock(run, now);
  return {
    task,
    timer: run.mode,
    running: reading.running,
    phase: run.phase === "work" ? "work" : "break",
    longBreak: run.phase === "long_break",
    blocks: run.blocksCompleted,
    phaseMs: (run.phaseSeconds ?? 0) * 1000,
    phaseDoneMs: run.mode === "pomodoro" ? reading.phaseElapsed * 1000 : 0,
    taskMs: run.mode === "per_task" ? reading.phaseElapsed * 1000 : 0,
    sitMs: reading.focusedSeconds * 1000,
  };
}

// ── Where the session goes next (the run rules) ──────────────────────────────

/** What the follower knows about a task: whether it's still open, and whose
 *  hand closed it. */
export interface FollowTask {
  id: string;
  open: boolean;
  completedBy?: string | null;
}

/** Why Now left the session when nobody pressed anything on this device. */
export type FocusLeftReason = "completed" | "gone" | null;

export type FollowStep =
  | { kind: "stay" }
  | { kind: "move"; taskId: string; left: FocusLeftReason; leftTaskId: string }
  | { kind: "end"; left: FocusLeftReason; leftTaskId: string };

/**
 * The run rules for a session whose Now task changed under it (#323's
 * use-queue-run, now app-wide): while Now is open and still mine to work, the
 * session stays. Done or Won't do (here or by someone else), deleted,
 * unshared, or taken out of my Up next: the session moves to the next open
 * task of my Up next with its rhythm, or ends by itself when nothing is left
 * (62: "a session also ends by itself when Up next runs out").
 *
 * `myQueue` is my line-up in order (task ids); `task(id)` answers what the
 * store holds, or undefined when it doesn't have the task. `complete` says
 * whether a missing task can be told apart from a closed one not loaded yet
 * (closed tasks arrive after the open ones). `wasQueued`: Now was in my Up
 * next at some point this session, so its leaving it is a Remove (a session
 * on a task that was never lined up isn't moved for that).
 */
export function followStep(input: {
  nowTaskId: string;
  myQueue: readonly string[];
  task: (id: string) => FollowTask | undefined;
  selfId: string | null;
  complete: boolean;
  wasQueued: boolean;
}): FollowStep {
  const { nowTaskId, myQueue, task, selfId, complete, wasQueued } = input;
  const now = task(nowTaskId);
  const queued = myQueue.includes(nowTaskId);
  if (now?.open && (queued || !wasQueued)) return { kind: "stay" };
  // Not loaded yet, and the list may still bring it: wait.
  if (!now && !complete) return { kind: "stay" };
  const left: FocusLeftReason = !now
    ? "gone"
    : !now.open && now.completedBy && now.completedBy !== selfId
      ? "completed"
      : null;
  const next = myQueue.find((id) => id !== nowTaskId && !id.startsWith("tmp-") && task(id)?.open);
  if (next) return { kind: "move", taskId: next, left, leftTaskId: nowTaskId };
  return { kind: "end", left, leftTaskId: nowTaskId };
}
