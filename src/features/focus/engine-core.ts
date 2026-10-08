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
  /** The catch-up left the clock waiting (a phase ended and nothing auto-started). */
  parked: boolean;
}

export interface FocusCredit {
  workspaceId: string | null;
  /** Work time not saved yet. */
  ms: number;
  /** The part handed to the sink and not confirmed yet: one save, sent under
   *  `flightKey`. Until it's confirmed it is only ever sent again as it is
   *  (same seconds, same key), so the server can tell a resend from new time. */
  inFlightMs: number;
  /** When that hand-off started; null = waiting to be sent again (its answer
   *  never came, or it failed). */
  inFlightAt: number | null;
  /** The save's idempotency key (TV-D3). Missing on records written before. */
  flightKey?: string | null;
  /** When the seconds in that save were last earned: the stretch's end, kept
   *  for every resend. */
  flightEarnedAt?: number | null;
  /** When saving this task's time last failed; cleared once it's saved. */
  failedAt: number | null;
  /** When time was last added. A complete task list loaded after this that
   *  lacks the task means the task is gone. */
  earnedAt: number;
}

/** How a hand-off to the sink ended: saved; not now (silent); failed (shows
 *  "not saved yet" and retries); or gone (the task can never take the time —
 *  the seconds are dropped). */
export type FlushOutcome = "saved" | "later" | "failed" | "gone";

/** Seconds held for a save that has to be sent again. */
function parkedMs(c: FocusCredit): number {
  return c.inFlightAt === null ? c.inFlightMs : 0;
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
  /** The end of the last stretch credited to the task as live work (a run on
   *  another device that took control at T gets back what was credited after
   *  T: TV-F2). Missing on records written before. */
  creditedTo?: number;
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
  /** Saving some tracked time failed and is being retried: "not saved yet" (F1-7). */
  unsaved: boolean;
  /** Length of the current pomodoro phase, seconds (TV-F2: the run's shared record). */
  phaseSeconds: number;
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
  phaseSeconds: 0,
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
  at: number,
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
      flightKey: prev?.flightKey ?? null,
      flightEarnedAt: prev?.flightEarnedAt ?? null,
      failedAt: prev?.failedAt ?? null,
      earnedAt: Math.max(prev?.earnedAt ?? 0, at),
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

function creditRun(base: FocusRecord, run: Run, at: number): Run {
  const task = base.task;
  if (!task || run.workMs <= 0) return run;
  return {
    ...run,
    rec: {
      ...run.rec,
      credits: addCredit(run.rec.credits, task.id, task.workspaceId, run.workMs, at),
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
    const seen = creditRun(rec, runUntil(rec, rec.seenAt, p, false), rec.seenAt);
    const restarted = seen.rec.since === null ? seen.rec : { ...seen.rec, since: now };
    return { rec: { ...restarted, seenAt: now, creditedTo: rec.seenAt }, liveEnds: seen.ends };
  }
  if (now - rec.seenAt <= AWAY_GAP_MS) {
    const live = creditRun(rec, runUntil(rec, now, p, false), now);
    return { rec: { ...live.rec, seenAt: now, creditedTo: now }, liveEnds: live.ends };
  }
  // Away. Credit up to the last look, then replay the gap with its work held.
  const before = creditRun(rec, runUntil(rec, rec.seenAt, p, false), rec.seenAt);
  const gap = runUntil(before.rec, now, p, true);
  let next: FocusRecord = { ...gap.rec, seenAt: now, creditedTo: rec.seenAt };
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
          parked: gap.rec.since === null,
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
  if (r.task && sameTaskRef(r.task, task)) return r;
  return { ...r, task };
}

/** Same task, same label: binding it again changes nothing. */
export function sameTaskRef(a: FocusTaskRef, b: FocusTaskRef): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.bucketName === b.bucketName &&
    a.workspaceId === b.workspaceId
  );
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

/** Set the run's mode: pomodoro or stopwatch (a run picks it once, TV-F2). */
export function setPomodoro(r: FocusRecord, on: boolean, now: number, p: FocusRhythm): FocusRecord {
  return r.pomodoro === on ? r : togglePomodoro(r, now, p);
}

/** A run as the shared record has it (focus_runs, TV-F2), read at `now`. */
export interface FocusRunClock {
  task: FocusTaskRef | null;
  pomodoro: boolean;
  running: boolean;
  phase: FocusPhase;
  longBreak: boolean;
  blocks: number;
  /** The current phase's length (pomodoro). */
  phaseMs: number;
  /** How much of the current phase has run. */
  phaseDoneMs: number;
  /** Focused time in the run so far. */
  sitMs: number;
}

/**
 * Take over a run another device was running (TV-F2: "takes control when you
 * act on it"): this device's session becomes the run as the shared record
 * says it is now, rhythm and all, and its clock starts from here. Unsaved
 * credits stay; an away block from before is dropped (that time was the other
 * device's).
 */
export function adoptSession(r: FocusRecord, run: FocusRunClock, now: number, p: FocusRhythm): FocusRecord {
  const phaseMs = run.pomodoro ? Math.max(MINUTE_MS, run.phaseMs) : workLength(p);
  return {
    ...r,
    task: run.task,
    tracking: true,
    pomodoro: run.pomodoro,
    phase: run.pomodoro ? run.phase : "work",
    longBreak: run.pomodoro && run.phase === "break" && run.longBreak,
    blocks: Math.max(0, Math.floor(run.blocks)),
    phaseMs,
    phaseDoneMs: run.pomodoro ? Math.min(phaseMs, Math.max(0, run.phaseDoneMs)) : 0,
    since: run.running ? now : null,
    seenAt: now,
    creditedTo: now,
    sitMs: Math.max(0, run.sitMs),
    away: [],
  };
}

/**
 * Another device took control of the run at `at` (TV-F2): stop here without
 * crediting twice. Work credited to the bound task after `at` is taken back
 * from what isn't saved yet (that time was counted on the other device), held
 * away time is dropped, and the session ends. Earlier time stays to be saved.
 */
export function relinquishSession(r: FocusRecord, at: number, now: number, p: FocusRhythm): FocusRecord {
  const task = r.task;
  let credits = r.credits;
  const credit = task ? r.credits[task.id] : undefined;
  if (task && credit) {
    const creditedTo = r.creditedTo ?? r.seenAt;
    const overlap = Math.min(credit.ms, Math.max(0, creditedTo - at));
    if (overlap > 0) {
      const next = { ...credit, ms: credit.ms - overlap };
      credits = { ...credits, [task.id]: next };
      if (next.ms <= 0 && next.inFlightMs <= 0) {
        credits = Object.fromEntries(Object.entries(credits).filter(([id]) => id !== task.id));
      }
    }
  }
  return { ...stopSession({ ...r, credits }, now, p), task: null };
}

/**
 * Answer "while you were away":
 *  - keep: the held work time goes to the task it accrued on;
 *  - discard: nothing is credited;
 *  - break: nothing is credited, the away time was the break, and a pomodoro
 *    gets a fresh work block — running now if the clock was running or the
 *    catch-up left it waiting, paused if you paused it yourself since.
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
        credits: addCredit(next.credits, block.taskId, block.workspaceId, block.workMs, now),
        sitMs: next.sitMs + block.workMs,
        creditedTo: Math.max(next.creditedTo ?? next.seenAt, block.to),
      };
    }
  } else if (choice === "break" && r.tracking && r.pomodoro) {
    // Still waiting where the catch-up parked it (nothing ran since)?
    const parked = r.away.some((b) => b.parked) && r.since === null && r.phaseDoneMs === 0;
    next = {
      ...next,
      phase: "work",
      longBreak: false,
      phaseMs: workLength(p),
      phaseDoneMs: 0,
      since: isRunning(r) || parked ? now : null,
      seenAt: now,
    };
  }
  return next;
}

// ── flushing ──────────────────────────────────────────────────────────────────

export interface FlushItem {
  taskId: string;
  seconds: number;
  /** When time was last added to this task's credit. */
  earnedAt: number;
  /** The save's idempotency key: the same on every resend of these seconds. */
  key: string;
  /** A save sent again (time earned since waits for the next flush). */
  resend: boolean;
}

/**
 * Take every save due in `workspaceId`, marked in flight: a save waiting to be
 * sent again goes as it was (same seconds, same key); otherwise the whole
 * seconds not saved yet go as a new save under a fresh key. One per task.
 */
export function takeFlushBatch(
  r: FocusRecord,
  workspaceId: string | null,
  now: number,
  newKey: () => string,
): { rec: FocusRecord; items: FlushItem[] } {
  const items: FlushItem[] = [];
  let credits = r.credits;
  for (const [taskId, c] of Object.entries(r.credits)) {
    if (c.workspaceId !== workspaceId) continue;
    if (c.inFlightMs > 0) {
      if (c.inFlightAt !== null) continue; // still waiting for its answer
      const key = c.flightKey ?? newKey();
      credits = { ...credits, [taskId]: { ...c, inFlightAt: now, flightKey: key } };
      items.push({
        taskId,
        seconds: Math.round(c.inFlightMs / 1000),
        earnedAt: c.flightEarnedAt ?? c.earnedAt,
        key,
        resend: true,
      });
      continue;
    }
    const seconds = Math.floor(c.ms / 1000);
    if (seconds < 1) continue;
    const key = newKey();
    credits = {
      ...credits,
      [taskId]: {
        ...c,
        ms: c.ms - seconds * 1000,
        inFlightMs: seconds * 1000,
        inFlightAt: now,
        flightKey: key,
        flightEarnedAt: c.earnedAt,
      },
    };
    items.push({ taskId, seconds, earnedAt: c.earnedAt, key, resend: false });
  }
  return items.length ? { rec: { ...r, credits }, items } : { rec: r, items };
}

/**
 * Settle one flushed item. Saved → gone, and the task's failure mark clears.
 * Not now, or failed → the save waits to be sent again as it is, with its key:
 * a failed request may still have reached the server, and a resend under the
 * same key is recorded once. Failed also marks it (that's what shows "not saved
 * yet"). Gone → the task can never take its time, so the whole credit is
 * dropped. An answer for a save that isn't this credit's any more changes
 * nothing.
 */
export function settleFlush(
  r: FocusRecord,
  item: FlushItem,
  outcome: FlushOutcome,
  now: number,
): FocusRecord {
  const c = r.credits[item.taskId];
  if (!c) return r;
  if (outcome === "gone") {
    return {
      ...r,
      credits: Object.fromEntries(Object.entries(r.credits).filter(([id]) => id !== item.taskId)),
    };
  }
  if (c.inFlightMs <= 0 || (c.flightKey != null && c.flightKey !== item.key)) return r;
  const next: FocusCredit =
    outcome === "saved"
      ? {
          ...c,
          inFlightMs: 0,
          inFlightAt: null,
          flightKey: null,
          flightEarnedAt: null,
          failedAt: null,
        }
      : {
          ...c,
          inFlightAt: null,
          flightKey: c.flightKey ?? item.key,
          failedAt: outcome === "failed" ? now : c.failedAt,
        };
  const credits = Object.fromEntries(
    Object.entries(r.credits).filter(([id]) => id !== item.taskId),
  );
  if (next.ms > 0 || next.inFlightMs > 0) credits[item.taskId] = next;
  return { ...r, credits };
}

/** A hand-off that died with an earlier page (a reload or crash mid-save) will
 *  never be answered: once it's stale, it waits to be sent again, under its
 *  key. (One from before keys existed counts as unsaved again.) Only
 *  `workspaceId`'s credits (the ones about to be saved) are touched, and never
 *  hand-offs this page is still waiting on (`liveTaskIds`). */
export function reviveDeadFlights(
  r: FocusRecord,
  liveTaskIds: ReadonlySet<string>,
  now: number,
  workspaceId: string | null,
): FocusRecord {
  let changed = false;
  const credits: Record<string, FocusCredit> = {};
  for (const [taskId, c] of Object.entries(r.credits)) {
    const dead =
      c.workspaceId === workspaceId &&
      c.inFlightMs > 0 &&
      c.inFlightAt !== null &&
      !liveTaskIds.has(taskId) &&
      now - c.inFlightAt > FLIGHT_STALE_MS;
    if (dead) {
      credits[taskId] = c.flightKey
        ? { ...c, inFlightAt: null }
        : {
            ...c,
            ms: c.ms + c.inFlightMs,
            inFlightMs: 0,
            inFlightAt: null,
            flightKey: null,
            flightEarnedAt: null,
          };
      changed = true;
    } else {
      credits[taskId] = c;
    }
  }
  return changed ? { ...r, credits } : r;
}

/** Some task's time failed to save and is still waiting: "not saved yet". */
export function hasFailedSaves(r: FocusRecord): boolean {
  return Object.values(r.credits).some(
    (c) => c.failedAt !== null && (c.ms >= 1000 || c.inFlightMs > 0),
  );
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
      ? creditRun(rec, runUntil(rec, now, p, false), now).rec
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
    // A save waiting to be sent again isn't in the task's saved total yet.
    accrued: Math.floor(((credit?.ms ?? 0) + (credit ? parkedMs(credit) : 0)) / 1000),
    phaseLabel: phaseLabelOf(r.phase, r.longBreak),
    bigClock: r.pomodoro ? pomoLeft : sitElapsed,
    away: awaySummary(r.away),
    unsaved: hasFailedSaves(r),
    phaseSeconds: Math.round(r.phaseMs / 1000),
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
    a.phaseSeconds === b.phaseSeconds &&
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
      flightKey: z.string().nullable().optional(),
      flightEarnedAt: z.number().nullable().optional(),
      failedAt: z.number().nullable(),
      earnedAt: z.number(),
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
      parked: z.boolean(),
    }),
  ),
  creditedTo: z.number().optional(),
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
