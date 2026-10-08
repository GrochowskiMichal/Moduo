// Focus engine, pure core (TV-F1, specs/tasks-v2.md §3 + §5 + assumption 6).
// No timers, storage or DOM here: every function takes the record and the
// wall-clock `now` and returns a new record, so the shell (engine.ts) and the
// tests drive time explicitly.
//
// The model, in the spec's terms:
//  - the session is the sitting: a stopwatch or a pomodoro rhythm. Finishing or
//    switching tasks never resets it (F1-6).
//  - the task gets the work time while it's bound (`task`).
//  - the open stretch runs from `since`. Elapsed time is always computed from
//    `Date.now()` timestamps, never from counted ticks, so a throttled or
//    suspended webview loses nothing (F1-1). Ticks only repaint.
//  - credits are closed work time per task, kept until a flush confirms it was
//    saved (F1-7).
//  - away: a gap of more than 90 s between two looks at the clock (sleep, a
//    suspended app). Its work time is held, never credited silently, until the
//    person picks Keep / Discard / Count as break (F1-3). Pomodoro ends inside
//    the gap are caught up from timestamps, and a work block never starts by
//    itself while away (F1-4).

import { z } from "zod";
import type { FocusPrefs } from "../../lib/focus-prefs";

/** A gap longer than this between two looks at the clock means the app was away. */
export const AWAY_GAP_MS = 90_000;
/** A tab that hasn't looked at a running clock for this long has lost it.
 *  Shorter than AWAY_GAP_MS, so taking over from a closed tab isn't "away". */
export const OWNER_STALE_MS = 75_000;

const MINUTE_MS = 60_000;

export type FocusPhase = "work" | "break";
export type AwayChoice = "keep" | "discard" | "break";

/** The pomodoro intervals and rollover pref, read fresh at each boundary. */
export type FocusRhythm = Pick<
  FocusPrefs,
  "workMinutes" | "breakMinutes" | "longBreakMinutes" | "sessionsBeforeLongBreak" | "autoStartNext"
>;

export interface FocusTaskRef {
  id: string;
  title: string;
  bucketName: string | null;
  /** Credits flush only through the sink of this workspace. */
  workspaceId: string | null;
}

/** A pomodoro phase that ended, at its scheduled time (not when it was noticed). */
export interface FocusPhaseEnd {
  phase: FocusPhase;
  longBreak: boolean;
  lengthMs: number;
  at: number;
}

/** One stretch the app wasn't looking: held work time, waiting for an answer. */
export interface FocusAwayBlock {
  from: number;
  to: number;
  taskId: string | null;
  workspaceId: string | null;
  /** What Keep would credit: the work time inside the gap, up to the end of the
   *  work phase it was in (pomodoro), or all of it (stopwatch). */
  workMs: number;
  phaseEnds: FocusPhaseEnd[];
}

export interface FocusCredit {
  workspaceId: string | null;
  /** Work time not saved yet. */
  ms: number;
  /** The part handed to the sink and not confirmed yet. */
  inFlightMs: number;
  /** When that hand-off started. */
  inFlightAt: number | null;
}

/** A hand-off still unconfirmed after this long died with its page. */
export const FLIGHT_STALE_MS = 120_000;

/** Everything the engine persists (localStorage, `moduo:tasks:focus:<user>`). */
export interface FocusRecord {
  v: 1;
  /** The tab that runs the clock (credits, flushes, alerts). Other tabs mirror it. */
  owner: string | null;
  /** The last time the owner looked at the clock: the away-gap anchor. */
  seenAt: number;
  task: FocusTaskRef | null;
  tracking: boolean;
  pomodoro: boolean;
  phase: FocusPhase;
  longBreak: boolean;
  /** Completed work blocks this session (drives the long-break rhythm). */
  blocks: number;
  /** Length of the current phase. */
  phaseMs: number;
  /** How much of the current phase has run. */
  phaseDoneMs: number;
  /** Start of the open stretch; null = paused or idle. */
  since: number | null;
  /** Focused (work) time this sitting: the stopwatch clock. */
  sitMs: number;
  credits: Record<string, FocusCredit>;
  away: FocusAwayBlock[];
  /** When the last flush failed; null once a flush succeeds. */
  failedAt: number | null;
}

export interface FocusAwaySummary {
  awaySeconds: number;
  /** Work time Keep would add. */
  heldSeconds: number;
  endedPhases: FocusPhaseEnd[];
}

/** What the UI reads. Field names predate TV-F1 (DF-11), so the Execute view and
 *  the chrome chip read it unchanged. */
export interface FocusSession {
  taskId: string | null;
  taskTitle: string;
  bucketName: string | null;
  tracking: boolean;
  running: boolean;
  pomodoro: boolean;
  phase: FocusPhase;
  longBreak: boolean;
  completedWork: number;
  /** Pomodoro countdown, seconds. */
  pomoLeft: number;
  /** Stopwatch, seconds: focused time this sitting. */
  sitElapsed: number;
  /** Work seconds on the bound task that aren't in its saved total yet. */
  accrued: number;
  phaseLabel: string;
  /** The number the big clock shows: pomodoro countdown, else stopwatch. */
  bigClock: number;
  /** Pending "while you were away" answer, or null. */
  away: FocusAwaySummary | null;
  /** A flush failed and is being retried: "not saved yet" (F1-7). */
  unsaved: boolean;
}

export const REST_SESSION: FocusSession = {
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
  away: null,
  unsaved: false,
};

export function blankRecord(now: number): FocusRecord {
  return {
    v: 1,
    owner: null,
    seenAt: now,
    task: null,
    tracking: false,
    pomodoro: false,
    phase: "work",
    longBreak: false,
    blocks: 0,
    phaseMs: 0,
    phaseDoneMs: 0,
    since: null,
    sitMs: 0,
    credits: {},
    away: [],
    failedAt: null,
  };
}

export function isRunning(r: FocusRecord): boolean {
  return r.tracking && r.since !== null;
}

function countsAsWork(r: FocusRecord): boolean {
  return !r.pomodoro || r.phase === "work";
}

function workLength(p: FocusRhythm): number {
  return p.workMinutes * MINUTE_MS;
}

function breakLength(p: FocusRhythm, long: boolean): number {
  return (long ? p.longBreakMinutes : p.breakMinutes) * MINUTE_MS;
}

function addCredit(
  credits: Record<string, FocusCredit>,
  taskId: string,
  workspaceId: string | null,
  ms: number,
): Record<string, FocusCredit> {
  if (ms <= 0) return credits;
  const prev = credits[taskId];
  return {
    ...credits,
    [taskId]: {
      workspaceId: prev?.workspaceId ?? workspaceId,
      ms: (prev?.ms ?? 0) + ms,
      inFlightMs: prev?.inFlightMs ?? 0,
      inFlightAt: prev?.inFlightAt ?? null,
    },
  };
}

/** Roll to the next pomodoro phase at its scheduled end `at`. */
function rollover(r: FocusRecord, at: number, p: FocusRhythm, away: boolean): FocusRecord {
  let next: FocusRecord;
  if (r.phase === "work") {
    const blocks = r.blocks + 1;
    const long = blocks % Math.max(1, p.sessionsBeforeLongBreak) === 0;
    next = {
      ...r,
      blocks,
      phase: "break",
      longBreak: long,
      phaseMs: breakLength(p, long),
      phaseDoneMs: 0,
    };
  } else {
    next = { ...r, phase: "work", longBreak: false, phaseMs: workLength(p), phaseDoneMs: 0 };
  }
  // A new work block never starts by itself while you're away (§5).
  const autoStart = p.autoStartNext && !(away && next.phase === "work");
  return { ...next, since: autoStart ? at : null };
}

interface Run {
  rec: FocusRecord;
  workMs: number;
  ends: FocusPhaseEnd[];
}

/**
 * Advance the running clock to `until`, rolling pomodoro phases at their
 * scheduled ends. The work time is returned, not credited: the caller sends it
 * to the task (live) or into an away block (`away`).
 */
function runUntil(rec: FocusRecord, until: number, p: FocusRhythm, away: boolean): Run {
  let r = rec;
  let workMs = 0;
  const ends: FocusPhaseEnd[] = [];
  // Each pass ends a phase or stops at `until`; phases are ≥ 1 min, so this
  // bound is never reached in practice.
  for (let pass = 0; pass < 1000 && r.since !== null && r.tracking; pass++) {
    const since: number = r.since;
    const end = r.pomodoro
      ? since + Math.max(0, r.phaseMs - r.phaseDoneMs)
      : Number.POSITIVE_INFINITY;
    const stop = Math.min(end, until);
    const d = Math.max(0, stop - since);
    if (countsAsWork(r)) workMs += d;
    r = {
      ...r,
      since: Math.max(since, stop),
      phaseDoneMs: r.pomodoro ? Math.min(r.phaseMs, r.phaseDoneMs + d) : 0,
    };
    if (end > until) break;
    ends.push({ phase: r.phase, longBreak: r.longBreak, lengthMs: r.phaseMs, at: end });
    r = rollover(r, end, p, away);
  }
  return { rec: r, workMs, ends };
}

function creditRun(base: FocusRecord, run: Run): Run {
  const task = base.task;
  if (!task || run.workMs <= 0) return run;
  return {
    ...run,
    rec: {
      ...run.rec,
      credits: addCredit(run.rec.credits, task.id, task.workspaceId, run.workMs),
      sitMs: run.rec.sitMs + run.workMs,
    },
  };
}

export interface Observed {
  rec: FocusRecord;
  /** Phase ends that happened while someone was looking: these get a chime and,
   *  in the background, a notification. Ends caught up in an away gap don't. */
  liveEnds: FocusPhaseEnd[];
}

/**
 * Bring the record up to `now`: credit the time since the last look, roll
 * pomodoro phases, and turn a gap of more than AWAY_GAP_MS into an away block.
 * The clock owner calls this on every tick and before every action.
 */
export function observe(rec: FocusRecord, now: number, p: FocusRhythm): Observed {
  if (!isRunning(rec)) return { rec: { ...rec, seenAt: now }, liveEnds: [] };
  if (now < rec.seenAt) {
    // The wall clock moved backwards: keep what was seen, restart the stretch here.
    const seen = creditRun(rec, runUntil(rec, rec.seenAt, p, false));
    const restarted = seen.rec.since === null ? seen.rec : { ...seen.rec, since: now };
    return { rec: { ...restarted, seenAt: now }, liveEnds: seen.ends };
  }
  if (now - rec.seenAt <= AWAY_GAP_MS) {
    const live = creditRun(rec, runUntil(rec, now, p, false));
    return { rec: { ...live.rec, seenAt: now }, liveEnds: live.ends };
  }
  // Away. Credit up to the last look, then replay the gap with its work held.
  const before = creditRun(rec, runUntil(rec, rec.seenAt, p, false));
  const gap = runUntil(before.rec, now, p, true);
  let next: FocusRecord = { ...gap.rec, seenAt: now };
  const held = rec.task ? gap.workMs : 0;
  if (held > 0 || gap.ends.length > 0) {
    next = {
      ...next,
      away: [
        ...next.away,
        {
          from: rec.seenAt,
          to: now,
          taskId: rec.task?.id ?? null,
          workspaceId: rec.task?.workspaceId ?? null,
          workMs: held,
          phaseEnds: gap.ends,
        },
      ],
    };
  }
  return { rec: next, liveEnds: before.ends };
}

// ── actions (call on a record already observed at `now`) ─────────────────────

/** Start tracking the bound task: a fresh sitting. Needs a task. */
export function startSession(r: FocusRecord, now: number, p: FocusRhythm): FocusRecord {
  if (!r.task) return r;
  return {
    ...r,
    tracking: true,
    since: now,
    seenAt: now,
    phase: "work",
    longBreak: false,
    blocks: 0,
    phaseMs: workLength(p),
    phaseDoneMs: 0,
    sitMs: 0,
    away: [],
  };
}

export function pauseSession(r: FocusRecord, now: number): FocusRecord {
  return isRunning(r) ? { ...r, since: null, seenAt: now } : r;
}

export function resumeSession(r: FocusRecord, now: number): FocusRecord {
  return r.tracking && r.since === null ? { ...r, since: now, seenAt: now } : r;
}

/** Stop tracking. The task stays bound and the pomodoro choice stays; an
 *  unanswered away block is discarded (no inflated totals, §5). */
export function stopSession(r: FocusRecord, now: number, p: FocusRhythm): FocusRecord {
  return {
    ...r,
    tracking: false,
    since: null,
    seenAt: now,
    phase: "work",
    longBreak: false,
    blocks: 0,
    phaseMs: workLength(p),
    phaseDoneMs: 0,
    sitMs: 0,
    away: [],
  };
}

/**
 * Bind the task that gets the work time. The same task only refreshes its
 * label. A different task keeps the session as it is (phase, block count,
 * pomodoro, running): the rhythm belongs to the sitting (F1-6). Null ends the
 * session (the queue emptied).
 */
export function bindTask(
  r: FocusRecord,
  task: FocusTaskRef | null,
  now: number,
  p: FocusRhythm,
): FocusRecord {
  if (task === null) return { ...stopSession(r, now, p), task: null };
  if (r.task?.id === task.id) {
    const same =
      r.task.title === task.title &&
      r.task.bucketName === task.bucketName &&
      r.task.workspaceId === task.workspaceId;
    return same ? r : { ...r, task };
  }
  return { ...r, task };
}

/** Switch stopwatch ↔ pomodoro; the rhythm starts over with a work block. */
export function togglePomodoro(r: FocusRecord, now: number, p: FocusRhythm): FocusRecord {
  return {
    ...r,
    pomodoro: !r.pomodoro,
    phase: "work",
    longBreak: false,
    blocks: 0,
    phaseMs: workLength(p),
    phaseDoneMs: 0,
    since: isRunning(r) ? now : r.since,
  };
}

/** While paused, show edited intervals right away (Settings → Focus, the ⋯ menu). */
export function previewInterval(r: FocusRecord, p: FocusRhythm): FocusRecord {
  if (!r.tracking || isRunning(r)) return r;
  const len = r.phase === "work" ? workLength(p) : breakLength(p, r.longBreak);
  if (len === r.phaseMs) return r;
  return { ...r, phaseMs: len, phaseDoneMs: Math.min(r.phaseDoneMs, len) };
}

/**
 * Answer "while you were away":
 *  - keep: the held work time goes to the task it accrued on;
 *  - discard: nothing is credited;
 *  - break: nothing is credited, the away time was the break, and a pomodoro
 *    starts a fresh work block now.
 */
export function resolveAway(
  r: FocusRecord,
  choice: AwayChoice,
  now: number,
  p: FocusRhythm,
): FocusRecord {
  if (r.away.length === 0) return r;
  let next: FocusRecord = { ...r, away: [] };
  if (choice === "keep") {
    for (const block of r.away) {
      if (!block.taskId || block.workMs <= 0) continue;
      next = {
        ...next,
        credits: addCredit(next.credits, block.taskId, block.workspaceId, block.workMs),
        sitMs: next.sitMs + block.workMs,
      };
    }
  } else if (choice === "break" && r.tracking && r.pomodoro) {
    next = {
      ...next,
      phase: "work",
      longBreak: false,
      phaseMs: workLength(p),
      phaseDoneMs: 0,
      since: now,
      seenAt: now,
    };
  }
  return next;
}

// ── flushing ──────────────────────────────────────────────────────────────────

export interface FlushItem {
  taskId: string;
  seconds: number;
}

/** Take whole seconds of every unsaved credit in `workspaceId`, marked in flight. */
export function takeFlushBatch(
  r: FocusRecord,
  workspaceId: string | null,
  now: number,
): { rec: FocusRecord; items: FlushItem[] } {
  const items: FlushItem[] = [];
  let credits = r.credits;
  for (const [taskId, c] of Object.entries(r.credits)) {
    if (c.workspaceId !== workspaceId || c.inFlightMs > 0) continue;
    const seconds = Math.floor(c.ms / 1000);
    if (seconds < 1) continue;
    credits = {
      ...credits,
      [taskId]: { ...c, ms: c.ms - seconds * 1000, inFlightMs: seconds * 1000, inFlightAt: now },
    };
    items.push({ taskId, seconds });
  }
  return items.length ? { rec: { ...r, credits }, items } : { rec: r, items };
}

/** Settle one flushed item: confirmed → gone; not persisted → back to unsaved. */
export function settleFlush(r: FocusRecord, item: FlushItem, persisted: boolean): FocusRecord {
  const c = r.credits[item.taskId];
  if (!c) return r;
  const flight = Math.min(c.inFlightMs, item.seconds * 1000);
  const inFlightMs = c.inFlightMs - flight;
  const next: FocusCredit = {
    ...c,
    ms: persisted ? c.ms : c.ms + flight,
    inFlightMs,
    inFlightAt: inFlightMs > 0 ? c.inFlightAt : null,
  };
  const credits = Object.fromEntries(
    Object.entries(r.credits).filter(([id]) => id !== item.taskId),
  );
  if (next.ms > 0 || next.inFlightMs > 0) credits[item.taskId] = next;
  return { ...r, credits };
}

/** A hand-off that died with an earlier page (a reload or crash mid-save) can't
 *  be confirmed any more: once it's stale, count it as unsaved again. Hand-offs
 *  this page is still waiting on (`liveTaskIds`) are never touched. */
export function reviveDeadFlights(
  r: FocusRecord,
  liveTaskIds: ReadonlySet<string>,
  now: number,
): FocusRecord {
  let changed = false;
  const credits: Record<string, FocusCredit> = {};
  for (const [taskId, c] of Object.entries(r.credits)) {
    const dead =
      c.inFlightMs > 0 && !liveTaskIds.has(taskId) && now - (c.inFlightAt ?? 0) > FLIGHT_STALE_MS;
    if (dead) {
      credits[taskId] = { ...c, ms: c.ms + c.inFlightMs, inFlightMs: 0, inFlightAt: null };
      changed = true;
    } else {
      credits[taskId] = c;
    }
  }
  return changed ? { ...r, credits } : r;
}

export function hasUnsaved(r: FocusRecord): boolean {
  return Object.values(r.credits).some((c) => c.ms >= 1000 || c.inFlightMs > 0);
}

// ── reading ───────────────────────────────────────────────────────────────────

function phaseLabelOf(phase: FocusPhase, longBreak: boolean): string {
  return phase === "work" ? "work" : longBreak ? "long break" : "break";
}

function awaySummary(blocks: FocusAwayBlock[]): FocusAwaySummary | null {
  if (blocks.length === 0) return null;
  let awayMs = 0;
  let heldMs = 0;
  const endedPhases: FocusPhaseEnd[] = [];
  for (const b of blocks) {
    awayMs += Math.max(0, b.to - b.from);
    heldMs += b.workMs;
    endedPhases.push(...b.phaseEnds);
  }
  return {
    awaySeconds: Math.round(awayMs / 1000),
    heldSeconds: Math.floor(heldMs / 1000),
    endedPhases,
  };
}

/**
 * What the UI shows at `now`. A running clock is projected forward without
 * writing anything, so a tab that only mirrors the owner shows the same time.
 */
export function snapshotOf(rec: FocusRecord, now: number, p: FocusRhythm): FocusSession {
  const r =
    isRunning(rec) && now >= rec.seenAt && now - rec.seenAt <= AWAY_GAP_MS
      ? creditRun(rec, runUntil(rec, now, p, false)).rec
      : rec;
  const credit = r.task ? r.credits[r.task.id] : undefined;
  const pomoLeft = Math.round(Math.max(0, r.phaseMs - r.phaseDoneMs) / 1000);
  const sitElapsed = Math.round(r.sitMs / 1000);
  return {
    taskId: r.task?.id ?? null,
    taskTitle: r.task?.title ?? "",
    bucketName: r.task?.bucketName ?? null,
    tracking: r.tracking,
    running: isRunning(r),
    pomodoro: r.pomodoro,
    phase: r.phase,
    longBreak: r.longBreak,
    completedWork: r.blocks,
    pomoLeft,
    sitElapsed,
    accrued: Math.floor((credit?.ms ?? 0) / 1000),
    phaseLabel: phaseLabelOf(r.phase, r.longBreak),
    bigClock: r.pomodoro ? pomoLeft : sitElapsed,
    away: awaySummary(r.away),
    unsaved: r.failedAt !== null && hasUnsaved(r),
  };
}

function sameAway(a: FocusAwaySummary | null, b: FocusAwaySummary | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.awaySeconds === b.awaySeconds &&
    a.heldSeconds === b.heldSeconds &&
    a.endedPhases.length === b.endedPhases.length &&
    a.endedPhases.every(
      (e, i) => e.at === b.endedPhases[i]?.at && e.phase === b.endedPhases[i]?.phase,
    )
  );
}

/** Field-wise equality, so an unchanged second doesn't re-render subscribers. */
export function sameSession(a: FocusSession, b: FocusSession): boolean {
  return (
    a.taskId === b.taskId &&
    a.taskTitle === b.taskTitle &&
    a.bucketName === b.bucketName &&
    a.tracking === b.tracking &&
    a.running === b.running &&
    a.pomodoro === b.pomodoro &&
    a.phase === b.phase &&
    a.longBreak === b.longBreak &&
    a.completedWork === b.completedWork &&
    a.pomoLeft === b.pomoLeft &&
    a.sitElapsed === b.sitElapsed &&
    a.accrued === b.accrued &&
    a.unsaved === b.unsaved &&
    sameAway(a.away, b.away)
  );
}

// ── persistence shape ─────────────────────────────────────────────────────────

const phaseSchema = z.enum(["work", "break"]);
const phaseEndSchema = z.object({
  phase: phaseSchema,
  longBreak: z.boolean(),
  lengthMs: z.number(),
  at: z.number(),
});
const recordSchema = z.object({
  v: z.literal(1),
  owner: z.string().nullable(),
  seenAt: z.number(),
  task: z
    .object({
      id: z.string().min(1),
      title: z.string(),
      bucketName: z.string().nullable(),
      workspaceId: z.string().nullable(),
    })
    .nullable(),
  tracking: z.boolean(),
  pomodoro: z.boolean(),
  phase: phaseSchema,
  longBreak: z.boolean(),
  blocks: z.number().int().nonnegative(),
  phaseMs: z.number().nonnegative(),
  phaseDoneMs: z.number().nonnegative(),
  since: z.number().nullable(),
  sitMs: z.number().nonnegative(),
  credits: z.record(
    z.string(),
    z.object({
      workspaceId: z.string().nullable(),
      ms: z.number().nonnegative(),
      inFlightMs: z.number().nonnegative(),
      inFlightAt: z.number().nullable(),
    }),
  ),
  away: z.array(
    z.object({
      from: z.number(),
      to: z.number(),
      taskId: z.string().nullable(),
      workspaceId: z.string().nullable(),
      workMs: z.number().nonnegative(),
      phaseEnds: z.array(phaseEndSchema),
    }),
  ),
  failedAt: z.number().nullable(),
});

/** Parse a stored record; anything malformed or from another version is null. */
export function parseRecord(raw: string | null): FocusRecord | null {
  if (!raw) return null;
  try {
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
