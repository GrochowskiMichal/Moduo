// Queue runs (TV-F2, specs/tasks-v2.md §3): the pure rules. A run works down
// my queue: Now is its first open task, Up next the rest. The clock stays on
// the device (the TV-F1 engine); `focus_runs` is the run's shared record, so it
// survives a reload, shows on my other devices and tells teammates "<name> is
// on this". Everything here takes `now` explicitly.

import {
  type FocusRunMode,
  type FocusRunPhase,
  type FocusRunStatus,
  isFocusRunMode,
  isFocusRunPhase,
  isFocusRunStatus,
} from "@contracts/vocabularies";
import type { Task, TaskQueueEntry } from "../tasks/model";
import type { FocusRunClock, FocusSession, FocusTaskRef } from "./engine-core";

export type { FocusRunMode, FocusRunPhase, FocusRunStatus };

/** My run, as `focus_runs` holds it (or as this device holds it until saved). */
export interface FocusRun {
  id: string;
  workspaceId: string;
  userId: string;
  status: FocusRunStatus;
  mode: FocusRunMode;
  startedAt: string;
  endedAt: string | null;
  /** The task the run is on: the head of my queue. */
  nowTaskId: string | null;
  /** Its title as this device last knew it (for the top-bar chip; never sent). */
  nowTitle?: string | null;
  phase: FocusRunPhase;
  /** When the current phase began, moved forward by pauses. */
  phaseStartedAt: string;
  /** The phase's length, seconds (pomodoro only). */
  phaseSeconds: number | null;
  pausedAt: string | null;
  blocksCompleted: number;
  /** Focused time this run, as of `seenAt`. */
  focusedSeconds: number;
  /** Tasks done in this run, in order. */
  doneTaskIds: string[];
  /** The device in control, since when, and its last write. */
  deviceId: string;
  controlAt: string;
  seenAt: string;
  /** Only on this device: the server doesn't have runs yet (its migration
   *  isn't applied), or the start hasn't been answered. */
  local?: boolean;
}

/** Who else is running which task right now ("<name> is on this"). */
export interface FocusClaim {
  userId: string;
  taskId: string;
}

/**
 * The runtime seam (src/lib/runtime.focus.web.ts). Each call degrades while
 * the migration isn't on the database: no run there (null), no claims, and
 * Keep all does nothing (null).
 */
export interface FocusRunRuntime {
  /** My latest run, open or ended, in any workspace (null: none yet). */
  latestRun(): Promise<FocusRun | null>;
  /** Start a run; any open run of mine ends first. Null: runs aren't on the server. */
  startRun(input: {
    workspaceId: string;
    deviceId: string;
    mode: FocusRunMode;
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
  /** "Keep all": my line-up counts as looked at. Answers my queue. */
  keepLineUp(workspaceId: string): Promise<TaskQueueEntry[] | null>;
}

/** What a device sends: the run's state as its clock has it now. */
export interface FocusRunSnapshot {
  status: "running" | "paused";
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

/** A `focus_runs` row → the model; null for anything that isn't one. */
export function focusRunRowToModel(row: unknown): FocusRun | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  const workspaceId = str(r.workspace_id);
  const userId = str(r.user_id);
  if (!id || !workspaceId || !userId) return null;
  if (!isFocusRunStatus(r.status) || !isFocusRunMode(r.mode) || !isFocusRunPhase(r.phase)) {
    return null;
  }
  const seenAt = str(r.seen_at) ?? new Date(0).toISOString();
  return {
    id,
    workspaceId,
    userId,
    status: r.status,
    mode: r.mode,
    startedAt: str(r.started_at) ?? seenAt,
    endedAt: str(r.ended_at),
    nowTaskId: str(r.now_task_id),
    nowTitle: typeof r.now_task_title === "string" ? r.now_task_title : null,
    phase: r.phase,
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
 * `now`. Elapsed phase time is turned into a start moment, so every device
 * computes the same countdown from it.
 */
export function runSnapshotFromSession(
  session: FocusSession,
  run: Pick<FocusRun, "mode" | "nowTaskId" | "doneTaskIds" | "pausedAt">,
  now: number,
): FocusRunSnapshot {
  const pomodoro = run.mode === "pomodoro";
  const phaseSeconds = pomodoro ? Math.max(1, session.phaseSeconds) : null;
  const elapsed = pomodoro
    ? Math.max(0, (phaseSeconds ?? 0) - session.pomoLeft)
    : Math.max(0, session.sitElapsed);
  const paused = !session.running;
  const pausedAtMs = paused ? (run.pausedAt ? Date.parse(run.pausedAt) : now) : now;
  return {
    status: paused ? "paused" : "running",
    nowTaskId: run.nowTaskId,
    phase: !pomodoro || session.phase === "work" ? "work" : session.longBreak ? "long_break" : "break",
    phaseStartedAt: new Date(pausedAtMs - elapsed * 1000).toISOString(),
    phaseSeconds,
    pausedAt: paused ? new Date(pausedAtMs).toISOString() : null,
    blocksCompleted: session.completedWork,
    focusedSeconds: Math.max(0, session.sitElapsed),
    doneTaskIds: run.doneTaskIds,
  };
}

/** A run's clock read from its record (another device's run, read through). */
export interface FocusRunReading {
  running: boolean;
  pomodoro: boolean;
  phase: FocusRunPhase;
  /** Seconds into the current phase (stopwatch: the focus clock). */
  phaseElapsed: number;
  /** Seconds left in the phase (pomodoro), else 0. */
  phaseLeft: number;
  /** The number a clock shows: the countdown, or the stopwatch. */
  bigClock: number;
  /** Focused time this run. */
  focusedSeconds: number;
}

export function readRunClock(run: FocusRun, now: number): FocusRunReading {
  const running = run.status === "running";
  const pomodoro = run.mode === "pomodoro";
  const at = running ? now : run.pausedAt ? Date.parse(run.pausedAt) : now;
  const phaseElapsed = Math.max(0, Math.floor((at - Date.parse(run.phaseStartedAt)) / 1000));
  const phaseLeft = pomodoro ? Math.max(0, (run.phaseSeconds ?? 0) - phaseElapsed) : 0;
  const sinceSeen =
    running && run.phase === "work" ? Math.max(0, Math.floor((now - Date.parse(run.seenAt)) / 1000)) : 0;
  const focusedSeconds = pomodoro ? run.focusedSeconds + sinceSeen : phaseElapsed;
  return {
    running,
    pomodoro,
    phase: run.phase,
    phaseElapsed,
    phaseLeft,
    bigClock: pomodoro ? phaseLeft : phaseElapsed,
    focusedSeconds,
  };
}

/** The run as the engine takes it over on this device (see adoptSession). */
export function runClockForAdopt(run: FocusRun, task: FocusTaskRef | null, now: number): FocusRunClock {
  const reading = readRunClock(run, now);
  return {
    task,
    pomodoro: reading.pomodoro,
    running: reading.running,
    phase: run.phase === "work" ? "work" : "break",
    longBreak: run.phase === "long_break",
    blocks: run.blocksCompleted,
    phaseMs: (run.phaseSeconds ?? 0) * 1000,
    phaseDoneMs: reading.phaseElapsed * 1000,
    sitMs: reading.focusedSeconds * 1000,
  };
}

/** The open tasks of my queue, in order: Now is the first. */
export function openQueued(queued: Task[]): Task[] {
  return queued.filter((t) => t.status !== "done" && t.status !== "archived");
}

/** Now: the first open task of my queue that's saved (not a `tmp-` id). */
export function runNowTask(queued: Task[]): Task | null {
  return openQueued(queued).find((t) => !t.id.startsWith("tmp-")) ?? null;
}

/** "2 of 7 done": done this run, out of done + still lined up. */
export function runProgress(run: Pick<FocusRun, "doneTaskIds">, queued: Task[]): {
  done: number;
  total: number;
} {
  const open = openQueued(queued).filter((t) => !run.doneTaskIds.includes(t.id)).length;
  const done = run.doneTaskIds.length;
  return { done, total: done + open };
}

// ── the line-up ──────────────────────────────────────────────────────────────

/** A line-up untouched this long asks "still want all of these?". */
export const STALE_LINE_UP_DAYS = 3;
const DAY_MS = 86_400_000;

/** When I last touched my line-up: the newest add, move or Keep all. */
export function lineUpTouchedAt(mine: TaskQueueEntry[]): number | null {
  let newest: number | null = null;
  for (const e of mine) {
    for (const at of [e.updatedAt, e.queuedAt]) {
      const ms = Date.parse(at);
      if (Number.isFinite(ms) && (newest === null || ms > newest)) newest = ms;
    }
  }
  return newest;
}

/** Whole days since the line-up was touched, when that's stale; else null. */
export function staleLineUpDays(touchedAt: number | null, now: number): number | null {
  if (touchedAt === null) return null;
  const days = Math.floor((now - touchedAt) / DAY_MS);
  return days >= STALE_LINE_UP_DAYS ? days : null;
}

/** The capacity mirror: how much is lined up (factual, no threshold). */
export function lineUpCapacity(tasks: Task[]): {
  count: number;
  minutes: number;
  withoutEstimate: number;
} {
  const open = openQueued(tasks);
  let minutes = 0;
  let withoutEstimate = 0;
  for (const t of open) {
    if (t.durationMinutes && t.durationMinutes > 0) minutes += t.durationMinutes;
    else withoutEstimate += 1;
  }
  return { count: open.length, minutes, withoutEstimate };
}

/** "5h 20m", "45m", "2h". */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/** "7 · ~5h 20m lined up · 2 without estimate". */
export function capacityLabel(c: ReturnType<typeof lineUpCapacity>): string {
  if (c.count === 0) return "";
  const parts = [String(c.count)];
  if (c.minutes > 0) parts.push(`~${formatMinutes(c.minutes)} lined up`);
  else parts.push("lined up");
  if (c.minutes > 0 && c.withoutEstimate > 0) parts.push(`${c.withoutEstimate} without estimate`);
  return parts.join(" · ");
}

/** "18:42", "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1h 12m", "18m", "40s". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
