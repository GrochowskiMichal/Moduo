// The Focus run (salvaged from #323, re-cut in TV-F6): my Focus session's
// shared record, which device is in control of it, and how it reaches my other
// devices and my teammates. A module store outside React, like the engine, so
// it survives navigation (leaving the Focus view never stops a session).
//
//  - The clock is the one time engine (engine.ts) on the device in control.
//    The run FOLLOWS the engine: whatever starts a session (Focus, ⇧F,
//    Calendar's ▶, Home's pomodoro) starts or continues the run in that task's
//    workspace; the timer, pauses, phases and the Now task are saved as they
//    change and at least once a minute; Stop ends the run after the 10 s Undo
//    (62a), and Undo inside it keeps the same run.
//  - `focus_runs` (one open run per person) holds the run for my other devices
//    and for teammates' "<name> is on this". Only the tab that runs the clock
//    speaks for this device.
//  - Another device shows the run read through, from the record's shared
//    timestamps (`useFocusTimer` in timer.ts). Acting on it there takes control
//    (`takeRunControl`): its engine takes the run over as the record says it
//    is, and saves with `take`. The device that lost control hears it
//    (Realtime, else the next poll or save) and stops, giving back what it
//    credited after the takeover, so the time is never counted twice (AC8.11).
//
// Persistence: the run as last known, per person, in localStorage under
// `moduo:tasks:focus-run:` (Reset local cache clears only `moduo.*`).

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  adoptFocusRun,
  type FocusGiveBack,
  focusClockIsHere,
  getFocusSession,
  relinquishFocus,
  STOP_UNDO_MS,
  subscribeFocusSession,
  undoStopFocus,
  useFocusSession,
} from "./engine";
import type { FocusSession, FocusTaskRef } from "./engine-core";
import {
  type FocusRun,
  type FocusRunReading,
  type FocusRunRuntime,
  type FocusRunSnapshot,
  type FocusTimerMode,
  focusRunRowToModel,
  readRunClock,
  runClockForAdopt,
  runSnapshotFromSession,
} from "./run-model";

export const RUN_STORAGE_PREFIX = "moduo:tasks:focus-run:";
const DEVICE_KEY = "moduo:tasks:focus-device";
/** The device in control saves at least this often while the run is on, so
 *  teammates' "is on this" stays live (focus_claims lapses after 3 minutes). */
const HEARTBEAT_MS = 60_000;
/** Backstop for Realtime: look at the server this often while visible. */
const POLL_MS = 30_000;
const SAVE_DEBOUNCE_MS = 400;
/** Coming back to the window looks at the server at most this often. */
const REFRESH_THROTTLE_MS = 10_000;

export interface FocusRunState {
  /** My open run, or null. */
  run: FocusRun | null;
  /** The run that just ended: its numbers until the next start. */
  ended: FocusRun | null;
  /** A quiet note about the session moving on by itself ("Mike completed …"). */
  notice: string | null;
}

const EMPTY: FocusRunState = { run: null, ended: null, notice: null };

/** Resolves a task id to what the engine binds (title, project, workspace). */
export type TaskRefResolver = (taskId: string) => FocusTaskRef | null;

type Subscriber = (
  userId: string,
  onRow: (row: unknown) => void,
  onResync: () => void,
) => () => void;

const defaultSubscribe: Subscriber = (userId, onRow, onResync) => {
  let stop: (() => void) | null = null;
  let cancelled = false;
  void import("./run-realtime")
    .then((m) => {
      if (!cancelled) stop = m.subscribeOwnRuns(userId, onRow, onResync);
    })
    .catch(() => {
      /* no Realtime: polling covers it */
    });
  return () => {
    cancelled = true;
    stop?.();
  };
};

// ── state ─────────────────────────────────────────────────────────────────────

let user: string | null = null;
let rt: FocusRunRuntime | null = null;
let state: FocusRunState = EMPTY;
const listeners = new Set<() => void>();
let deviceId = readDeviceId();
/** Bumped on every attach: answers for an earlier person are dropped. */
let epoch = 0;
let unsubRealtime: (() => void) | null = null;
let unsubSession: (() => void) | null = null;
let pollHandle: ReturnType<typeof setInterval> | null = null;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTake = false;
/** While a take is owed: the control moment the run had when this device
 *  took it (another device's), and when it took it (this device's clock). A
 *  server copy naming another device from no later than either is the take
 *  not having landed yet, not a newer takeover. (Compared to this device's
 *  clock too, so a take from elsewhere a moment before this one, unheard,
 *  doesn't win; clock skew can blur that moment.) */
let takeFrom: number | null = null;
let takeAt: number | null = null;
/** Server writes go one at a time, in the order they were made. */
let chain: Promise<void> = Promise.resolve();
/** A run started here, by its local id, once the server answered. */
const serverIds = new Map<string, string>();
/** What the last saved session change looked like (status/timer/phase/task). */
let lastSessionKey = "";
/** The run's state as this device's clock last had it while tracking: the
 *  final numbers an end sends (the engine resets them when it stops). */
let lastSnap: FocusRunSnapshot | null = null;
/** Server writes queued or on their way. While any is, a server copy that
 *  isn't a write's own answer may predate it: it's set aside, and the run is
 *  read again once the writes are done. */
let writesInFlight = 0;
/** Bumped by every write: a read that started before one is stale. */
let writeGen = 0;
let recheckAfterWrites = false;
/** The newest `seen_at` seen per run: an older copy never replaces a newer one. */
const lastSeen = new Map<string, number>();
/** Runs ended on this device: a late copy of one never brings it back. */
const endedHere = new Set<string>();
/** A start whose request failed (offline): sent again on the next look. */
let startRetry: { localId: string } | null = null;
/** Give-backs whose request failed (offline): sent again, same key, on the
 *  next look. */
let giveBacksOwed: GiveBack[] = [];
/** Stop pressed: the end waits out the Undo window (62a). */
let pendingEnd: {
  run: FocusRun;
  handle: ReturnType<typeof setTimeout>;
  /** The clock's last numbers for this run, kept from when Stop was pressed. */
  snap: FocusRunSnapshot | null;
} | null = null;
/** This store is stopping the engine itself (another device took over). */
let relinquishing = false;
/** Undo of a Stop is under way: the held run carries on (reconcile). */
let undoingStop = false;
let windowListening = false;
let lastRefreshAt = 0;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

function readDeviceId(): string {
  const store = storage();
  try {
    const existing = store?.getItem(DEVICE_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const fresh = newId();
    store?.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return newId();
  }
}

function runKey(userId: string): string {
  return `${RUN_STORAGE_PREFIX}${userId}`;
}

function readLocal(userId: string): FocusRun | null {
  try {
    const raw = storage()?.getItem(runKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { run?: unknown; local?: unknown };
    const run = focusRunRowToModel(parsed.run);
    if (!run || run.status === "ended") return null;
    return parsed.local === true ? { ...run, local: true } : run;
  } catch {
    return null;
  }
}

function writeLocal(run: FocusRun | null): void {
  if (!user) return;
  try {
    const store = storage();
    if (!run) store?.removeItem(runKey(user));
    else
      store?.setItem(runKey(user), JSON.stringify({ run: toRow(run), local: run.local === true }));
  } catch {
    /* storage unavailable — the server still has it */
  }
}

function toRow(run: FocusRun): Record<string, unknown> {
  return {
    id: run.id,
    workspace_id: run.workspaceId,
    user_id: run.userId,
    status: run.status,
    mode: run.mode,
    started_at: run.startedAt,
    ended_at: run.endedAt,
    now_task_id: run.nowTaskId,
    // Local only: the server never has titles.
    now_task_title: run.nowTitle ?? null,
    phase: run.phase,
    phase_started_at: run.phaseStartedAt,
    phase_seconds: run.phaseSeconds,
    paused_at: run.pausedAt,
    blocks_completed: run.blocksCompleted,
    focused_seconds: run.focusedSeconds,
    done_task_ids: run.doneTaskIds,
    device_id: run.deviceId,
    control_at: run.controlAt,
    seen_at: run.seenAt,
  };
}

function set(next: FocusRunState): void {
  const runChanged = next.run !== state.run;
  state = next;
  if (runChanged) writeLocal(next.run);
  for (const listener of listeners) listener();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Queue a server write: one at a time, in the order made. */
function queue(op: () => Promise<void>): void {
  const e = epoch;
  writesInFlight += 1;
  writeGen += 1;
  chain = chain
    .then(() => (e === epoch ? op() : undefined))
    .catch((error) => {
      console.warn("[focus] run sync failed", error);
    })
    .finally(() => {
      if (e !== epoch) return;
      writesInFlight -= 1;
      if (writesInFlight === 0 && saveTimer === null && recheckAfterWrites) {
        recheckAfterWrites = false;
        void refreshRun();
      }
    });
}

/** A write is queued, on its way, or about to be sent. */
function writing(): boolean {
  return writesInFlight > 0 || saveTimer !== null;
}

function inControlOf(run: FocusRun | null): boolean {
  return !!run && run.deviceId === deviceId;
}

/** Stop this device's clock because another device has the run (or ended
 *  it), without ending the run here (it isn't this device's to end). With
 *  `takenOver`, what this device already saved after the takeover is given
 *  back: the other device counted it too (AC8.11). */
function stopHere(at: number, takenOver?: { runId: string }): void {
  // The run isn't this device's any more: no take is owed.
  pendingTake = false;
  takeFrom = null;
  takeAt = null;
  if (!getFocusSession().tracking) return;
  relinquishing = true;
  let giveBack: FocusGiveBack | null = null;
  try {
    giveBack = relinquishFocus(at);
  } finally {
    relinquishing = false;
  }
  lastSessionKey = "";
  lastSnap = null;
  if (takenOver && giveBack?.workspaceId) {
    sendGiveBack({
      workspaceId: giveBack.workspaceId,
      taskId: giveBack.taskId,
      seconds: giveBack.seconds,
      key: `gb-${takenOver.runId}-${Math.round(at)}`.slice(0, 64),
    });
  }
}

type GiveBack = Parameters<FocusRunRuntime["giveBackTime"]>[0];

/** Give time back (keyed: a resend never counts twice). A failed request is
 *  sent again on the next look; a refusal isn't. */
function sendGiveBack(back: GiveBack): void {
  if (!rt) return;
  const runtime = rt;
  queue(async () => {
    try {
      await runtime.giveBackTime(back);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== "42501" && code !== "22023") giveBacksOwed.push(back);
      throw error;
    }
  });
}

function retryGiveBacks(): void {
  const owed = giveBacksOwed;
  giveBacksOwed = [];
  for (const back of owed) sendGiveBack(back);
}

// ── receiving the server's copy ──────────────────────────────────────────────

/** A take this device made is still owed, and a copy controlled from
 *  `controlAt` predates it. */
function takeStillOwed(controlAt: number): boolean {
  if (!pendingTake || takeFrom === null || takeAt === null) return false;
  return controlAt <= takeFrom || controlAt < takeAt;
}

/** The run ended (elsewhere): stop this device's clock if it ran it. */
function endedElsewhere(local: FocusRun, at: number, server?: FocusRun): void {
  if (focusClockIsHere()) stopHere(at);
  set({
    run: null,
    ended: server ?? { ...local, status: "ended", endedAt: iso(at) },
    notice: null,
  });
}

/**
 * Fold in the server's copy of my latest run. `full`: it's the answer to "my
 * latest run", so no row at all means I have none.
 */
function receive(server: FocusRun | null, opts: { full?: boolean } = {}): void {
  const local = state.run;
  if (!server) {
    if (opts.full && local && !local.local) endedElsewhere(local, Date.now());
    if (opts.full) reconcile();
    return;
  }
  // Copies arrive out of order (Realtime, polls, answers): an older one never
  // replaces a newer, and a run ended here stays ended.
  const seen = Date.parse(server.seenAt);
  if (seen < (lastSeen.get(server.id) ?? Number.NEGATIVE_INFINITY)) return;
  lastSeen.set(server.id, seen);
  if (endedHere.has(server.id) && server.status !== "ended") return;
  if (pendingEnd && pendingEnd.run.id === server.id && server.status !== "ended") return;
  if (local?.local) {
    // Started here and not answered yet: only a newer run from elsewhere replaces it.
    if (Date.parse(server.startedAt) <= Date.parse(local.startedAt)) return;
  }
  if (
    local &&
    local.id !== server.id &&
    Date.parse(server.startedAt) < Date.parse(local.startedAt)
  ) {
    return; // an older run's answer
  }
  if (server.status === "ended") {
    if (local && (local.id === server.id || !local.local)) {
      endedElsewhere(local, Date.parse(server.endedAt ?? server.seenAt), server);
    } else if (!local && opts.full) {
      reconcile();
    }
    return;
  }
  const nowMine = server.deviceId === deviceId;
  if (!nowMine && local?.id === server.id && takeStillOwed(Date.parse(server.controlAt))) {
    // This device took the run but the take hasn't reached the server yet
    // (offline): the copy names a device that had it before. The takeover
    // stands: send it again.
    scheduleSave(true);
    return;
  }
  if (!nowMine) {
    // Another device has the run: this device's clock stops, giving back what
    // it credited after the takeover.
    if (focusClockIsHere()) stopHere(Date.parse(server.controlAt), { runId: server.id });
    const nowTitle = local && local.nowTaskId === server.nowTaskId ? local.nowTitle : null;
    set({
      ...state,
      run: { ...server, nowTitle },
      ended: local && local.id === server.id ? state.ended : null,
    });
    return;
  }
  if (local && local.id === server.id) {
    // This device writes the run; keep its fresher copy, take the server's
    // control fields.
    const run = {
      ...local,
      deviceId: server.deviceId,
      controlAt: server.controlAt,
      seenAt: server.seenAt,
    };
    set({ ...state, run });
    // The server says this device runs it, but its clock stopped (a copy that
    // predated the takeover got here first): take the run up again.
    if (!getFocusSession().tracking && focusClockIsHere()) readopt(run);
    return;
  }
  // A run this device controls but doesn't hold: its clock here stopped (Stop
  // and a reload inside the Undo window, or a cleared device copy). It isn't
  // brought back on its own: it ends.
  if (!getFocusSession().tracking && focusClockIsHere()) {
    endOrphan(server);
    return;
  }
  set({ ...state, run: { ...server, nowTitle: null }, ended: null });
}

/** End a run of this device's that no clock here is running. */
function endOrphan(server: FocusRun): void {
  if (endedHere.has(server.id) || !rt) return;
  endedHere.add(server.id);
  const runtime = rt;
  set({ ...state, run: null, ended: { ...server, status: "ended", endedAt: iso(Date.now()) } });
  queue(async () => {
    await runtime.endRun({ runId: server.id, deviceId, state: {} });
  });
}

/** The engine takes the run up again as its record says it is now. */
function readopt(run: FocusRun, resolveTask?: TaskRefResolver): void {
  const task = run.nowTaskId
    ? (resolveTask?.(run.nowTaskId) ?? {
        id: run.nowTaskId,
        title: run.nowTitle ?? "",
        bucketName: null,
        workspaceId: run.workspaceId,
      })
    : null;
  lastSessionKey = "";
  adoptFocusRun(runClockForAdopt(run, task, Date.now()));
}

/** A copy of the run from Realtime: set aside while this device is writing. */
function receiveLive(server: FocusRun | null): void {
  if (writing()) {
    recheckAfterWrites = true;
    return;
  }
  receive(server);
}

async function refreshRun(): Promise<void> {
  if (!rt || !user) return;
  const e = epoch;
  const gen = writeGen;
  try {
    const server = await rt.latestRun();
    if (e !== epoch) return;
    // A read that a write overtook (or that would land over one) may predate
    // it; read again once the writes are done.
    if (gen !== writeGen || writing()) {
      recheckAfterWrites = true;
      return;
    }
    receive(server, { full: true });
  } catch {
    /* offline: keep what this device has */
  }
}

// ── saving ────────────────────────────────────────────────────────────────────

/** The run's state for the server, from this device's clock when it runs it. */
function snapshotFor(run: FocusRun, now: number): Partial<FocusRunSnapshot> {
  const session = getFocusSession();
  if (inControlOf(run) && session.tracking) {
    return runSnapshotFromSession(session, run, now);
  }
  return {
    status: run.status === "paused" ? "paused" : "running",
    mode: run.mode,
    nowTaskId: run.nowTaskId,
    doneTaskIds: run.doneTaskIds,
  };
}

function scheduleSave(take = false): void {
  if (take) pendingTake = true;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () => {
      saveTimer = null;
      queue(() => saveNow());
    },
    take ? 0 : SAVE_DEBOUNCE_MS,
  );
}

/**
 * Send this device's state of `run` (the current one by default). A takeover
 * stays owed until a save carrying it gets through: a failed one leaves
 * `pendingTake` set, so the next save (a heartbeat too) takes control again
 * instead of handing the run back.
 */
async function saveNow(target?: FocusRun): Promise<void> {
  const run = target ?? state.run;
  if (!run || !rt || run.local) return;
  const take = pendingTake;
  if (!inControlOf(run) && !take) return;
  pendingTake = false;
  let saved: FocusRun | null;
  try {
    saved = await rt.saveRun({
      runId: run.id,
      deviceId,
      take,
      state: snapshotFor(run, Date.now()),
    });
  } catch (error) {
    // Offline or a passing failure: the take stays owed. A refusal (no edit
    // access any more, a bad state) isn't: the run is left to the device
    // that has it.
    const code = (error as { code?: unknown }).code;
    if (take && code !== "42501" && code !== "22023") pendingTake = true;
    else if (take && !pendingTake) {
      takeFrom = null;
      takeAt = null;
    }
    throw error;
  }
  if (take && !pendingTake) {
    takeFrom = null;
    takeAt = null;
  }
  receive(saved);
}

// ── following the engine ─────────────────────────────────────────────────────

function sessionKey(s: FocusSession): string {
  return [
    s.running ? "running" : "paused",
    s.timer,
    s.phase,
    s.longBreak,
    s.completedWork,
    s.taskId,
  ].join("|");
}

/** The engine changed (or the server answered): bring the run in line with
 *  this device's clock. */
function reconcile(): void {
  if (!user || relinquishing || !focusClockIsHere()) return;
  const s = getFocusSession();
  const now = Date.now();
  if (s.tracking && s.taskId && s.workspaceId) {
    let run = state.run;
    if (pendingEnd && !run) {
      if (undoingStop && pendingEnd.run.workspaceId === s.workspaceId) {
        // Undo inside the Stop window: the same run carries on.
        clearTimeout(pendingEnd.handle);
        run = pendingEnd.run;
        pendingEnd = null;
        set({ ...state, run, ended: null });
        lastSessionKey = "";
      } else {
        // A new session started meanwhile: the stopped run ends now, with its
        // own numbers, before the new one starts (one at a time, in order).
        clearTimeout(pendingEnd.handle);
        finishEnd();
      }
    }
    if (!run || run.workspaceId !== s.workspaceId) {
      startRunFrom(s, now);
      return;
    }
    // Another device has the run and this one never took it: the server's
    // copy decides (receive stops this clock); explicit actions take control.
    if (!inControlOf(run)) return;
    const snap = runSnapshotFromSession(s, run, now);
    lastSnap = snap;
    const key = sessionKey(s);
    const moved = run.nowTaskId !== s.taskId;
    if (key === lastSessionKey && !moved) return;
    lastSessionKey = key;
    set({
      ...state,
      run: {
        ...run,
        status: snap.status,
        mode: snap.mode,
        nowTaskId: s.taskId,
        nowTitle: s.taskTitle || run.nowTitle,
        pausedAt: snap.pausedAt,
        phase: snap.phase,
        phaseStartedAt: snap.phaseStartedAt,
        phaseSeconds: snap.phaseSeconds,
        blocksCompleted: snap.blocksCompleted,
        focusedSeconds: snap.focusedSeconds,
        seenAt: iso(now),
      },
    });
    scheduleSave();
    return;
  }
  // The clock stopped here while this device ran the run: Stop (or Up next
  // ran out). The end waits out the Undo window.
  const run = state.run;
  if (run && inControlOf(run) && !pendingEnd) beginEnd(run);
}

/** Start a run for the session this device just started. */
function startRunFrom(s: FocusSession, now: number): void {
  if (!user || !s.taskId || !s.workspaceId) return;
  const base: FocusRun = {
    id: `local-${newId()}`,
    local: true,
    workspaceId: s.workspaceId,
    userId: user,
    status: s.running ? "running" : "paused",
    mode: s.timer,
    startedAt: iso(now),
    endedAt: null,
    nowTaskId: s.taskId,
    nowTitle: s.taskTitle,
    phase: "work",
    phaseStartedAt: iso(now),
    phaseSeconds: null,
    pausedAt: null,
    blocksCompleted: 0,
    focusedSeconds: 0,
    doneTaskIds: [],
    deviceId,
    controlAt: iso(now),
    seenAt: iso(now),
  };
  const snap = runSnapshotFromSession(s, base, now);
  lastSnap = snap;
  lastSessionKey = sessionKey(s);
  // Any open run of mine (in another workspace too) ends on the server when
  // this one starts.
  set({
    run: {
      ...base,
      phase: snap.phase,
      phaseStartedAt: snap.phaseStartedAt,
      phaseSeconds: snap.phaseSeconds,
      pausedAt: snap.pausedAt,
    },
    ended: null,
    notice: null,
  });
  sendStart(base.id);
}

/** Start the run on the server (again, after a failed request). */
function sendStart(localId: string): void {
  if (!rt) return;
  const runtime = rt;
  startRetry = null;
  queue(async () => {
    const current = state.run ?? (pendingEnd?.run.id === localId ? pendingEnd.run : null);
    if (!current || current.id !== localId) return; // ended or replaced meanwhile
    let saved: FocusRun | null;
    try {
      saved = await runtime.startRun({
        workspaceId: current.workspaceId,
        deviceId,
        mode: current.mode,
        state: snapshotFor(current, Date.now()),
      });
    } catch (error) {
      // Offline or a passing failure: send it again on the next look. A
      // refusal (no edit access, a bad state) isn't retried.
      const code = (error as { code?: unknown }).code;
      if (code !== "42501" && code !== "22023") startRetry = { localId };
      throw error;
    }
    if (!saved) return; // runs aren't on the server yet: it stays on this device
    serverIds.set(localId, saved.id);
    lastSeen.set(saved.id, Date.parse(saved.seenAt));
    const latest = state.run;
    if (latest?.id === localId) {
      set({
        ...state,
        run: {
          ...latest,
          id: saved.id,
          local: undefined,
          // The server's clock from here on: copies are ordered by it.
          startedAt: saved.startedAt,
          controlAt: saved.controlAt,
          seenAt: saved.seenAt,
        },
      });
      // Anything that changed while the start was on its way.
      lastSessionKey = "";
      reconcile();
    } else if (pendingEnd?.run.id === localId) {
      pendingEnd = { ...pendingEnd, run: { ...pendingEnd.run, id: saved.id, local: undefined } };
    } else if (endedHere.has(localId)) {
      // Ended while the start was on its way: the queued end sends it under
      // this id; a late copy must not bring it back meanwhile.
      endedHere.add(saved.id);
    }
  });
}

/** A start that failed goes again on the next look. */
function retryStart(): void {
  const pending = startRetry;
  if (!pending || state.run?.id !== pending.localId) return;
  sendStart(pending.localId);
}

/** Stop: hold the end for the Undo window, then end the run everywhere. */
function beginEnd(run: FocusRun): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  // A takeover still owed goes first, so the other device stops counting now
  // (and an Undo hands the session back here, not there).
  if (pendingTake) queue(() => saveNow(run));
  const handle = setTimeout(() => finishEnd(), STOP_UNDO_MS);
  pendingEnd = { run, handle, snap: lastSnap };
  set({ ...state, run: null });
}

function finishEnd(): void {
  const held = pendingEnd;
  if (!held) return;
  pendingEnd = null;
  const run = held.run;
  const now = Date.now();
  const snap = held.snap;
  const ended: FocusRun = {
    ...run,
    status: "ended",
    endedAt: iso(now),
    pausedAt: null,
    focusedSeconds: snap?.focusedSeconds ?? run.focusedSeconds,
    blocksCompleted: snap?.blocksCompleted ?? run.blocksCompleted,
  };
  // A run started meanwhile (another workspace) keeps its own numbers.
  if (!state.run) {
    lastSnap = null;
    lastSessionKey = "";
  }
  endedHere.add(run.id);
  const serverId = serverIds.get(run.id);
  if (serverId) endedHere.add(serverId);
  if (startRetry?.localId === run.id) startRetry = null;
  set({ ...state, ended });
  if (!rt) return;
  const runtime = rt;
  queue(async () => {
    const id = serverIds.get(run.id) ?? run.id;
    if (id.startsWith("local-")) return;
    await runtime.endRun({
      runId: id,
      deviceId,
      state: {
        mode: run.mode,
        focusedSeconds: ended.focusedSeconds,
        blocksCompleted: ended.blocksCompleted,
        doneTaskIds: run.doneTaskIds,
        nowTaskId: run.nowTaskId,
      },
    });
  });
}

function heartbeat(): void {
  const run = state.run;
  if (!run || !inControlOf(run) || run.status !== "running" || !focusClockIsHere()) return;
  queue(() => saveNow());
}

function onVisible(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_THROTTLE_MS) return;
  lastRefreshAt = now;
  retryStart();
  retryGiveBacks();
  void refreshRun();
}

/** The poll: only while there's a run (Realtime and window focus bring a run
 *  started elsewhere). */
function poll(): void {
  if (!state.run) return;
  onVisible();
}

function onStorage(event: StorageEvent): void {
  if (!user || event.key !== runKey(user)) return;
  // Another tab of this browser moved the run: show what it saved. A copy of
  // a run this tab is ending (or ended) never comes back that way.
  const next = readLocal(user);
  if (next && (endedHere.has(next.id) || pendingEnd?.run.id === next.id)) return;
  state = { ...state, run: next };
  for (const listener of listeners) listener();
}

function listenToWindow(): void {
  if (windowListening || typeof window === "undefined") return;
  windowListening = true;
  window.addEventListener("focus", onVisible);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
  window.addEventListener("storage", onStorage);
}

function stopTimers(): void {
  if (pollHandle !== null) clearInterval(pollHandle);
  if (heartbeatHandle !== null) clearInterval(heartbeatHandle);
  if (saveTimer !== null) clearTimeout(saveTimer);
  if (pendingEnd) clearTimeout(pendingEnd.handle);
  pollHandle = null;
  heartbeatHandle = null;
  saveTimer = null;
  pendingTake = false;
  takeFrom = null;
  takeAt = null;
  pendingEnd = null;
}

function resetMemory(): void {
  unsubRealtime?.();
  unsubRealtime = null;
  unsubSession?.();
  unsubSession = null;
  stopTimers();
  epoch += 1;
  chain = Promise.resolve();
  serverIds.clear();
  lastSeen.clear();
  endedHere.clear();
  writesInFlight = 0;
  recheckAfterWrites = false;
  startRetry = null;
  giveBacksOwed = [];
  lastSessionKey = "";
  lastSnap = null;
}

// ── public surface ────────────────────────────────────────────────────────────

/**
 * Scope the run to the signed-in person (null = signed out). Called by the
 * AuthProvider right after the engine's attach. `subscribe` replaces Realtime
 * in tests.
 */
export function attachRunUser(
  userId: string | null,
  runtime: { focus: FocusRunRuntime } | null,
  opts: { subscribe?: Subscriber | null } = {},
): void {
  const nextRt = runtime?.focus ?? null;
  if (userId === user && nextRt === rt) return;
  resetMemory();
  user = userId;
  rt = nextRt;
  if (!userId) {
    state = EMPTY;
    for (const listener of listeners) listener();
    return;
  }
  state = { run: readLocal(userId), ended: null, notice: null };
  // A run started here whose start never got an answer (offline, a reload
  // mid-request): sent again if this device's clock still runs it, else dropped.
  if (state.run?.local) {
    if (getFocusSession().tracking) startRetry = { localId: state.run.id };
    else {
      state = { ...state, run: null };
      writeLocal(null);
    }
  }
  for (const listener of listeners) listener();
  listenToWindow();
  lastRefreshAt = Date.now();
  unsubSession = subscribeFocusSession(reconcile);
  heartbeatHandle = setInterval(heartbeat, HEARTBEAT_MS);
  if (rt) {
    pollHandle = setInterval(poll, POLL_MS);
    const subscribe = opts.subscribe === undefined ? defaultSubscribe : opts.subscribe;
    if (subscribe) {
      unsubRealtime = subscribe(
        userId,
        (row) => receiveLive(focusRunRowToModel(row)),
        () => void refreshRun(),
      );
    }
    retryStart();
    void refreshRun();
  } else {
    reconcile();
  }
}

/** Erase a person's run record from this device (account deletion). */
export function forgetRunUser(userId: string): void {
  try {
    storage()?.removeItem(runKey(userId));
  } catch {
    /* nothing to erase */
  }
}

/**
 * Undo a Stop inside its window (62a): the engine's clock comes back as if it
 * never stopped, and the run it was ending carries on (not a new run).
 */
export function undoStopKeepingRun(): boolean {
  undoingStop = true;
  try {
    return undoStopFocus();
  } finally {
    undoingStop = false;
  }
}

/** Look at the server now, sending a failed start again first. */
export function refreshFocusRun(): Promise<void> {
  retryStart();
  retryGiveBacks();
  return refreshRun();
}

/** This device's id in `focus_runs.device_id`. */
export function runDeviceId(): string {
  return deviceId;
}

/**
 * Take control of the run on this device if another device has it: the
 * engine takes the run over as its record says it is now, and the next save
 * says so (`take`). Every action on a run read through calls this first.
 * False when there's no run to take.
 */
export function takeRunControl(resolveTask?: TaskRefResolver): boolean {
  const run = state.run;
  if (!run) return false;
  const session = getFocusSession();
  if (inControlOf(run) && session.tracking && focusClockIsHere()) return true;
  const now = Date.now();
  const task = run.nowTaskId ? (resolveTask?.(run.nowTaskId) ?? null) : null;
  // A take owed meanwhile keeps the moment it took from.
  if (!pendingTake || takeFrom === null) takeFrom = Date.parse(run.controlAt);
  takeAt = now;
  const taken: FocusRun = {
    ...run,
    deviceId,
    controlAt: iso(now),
    nowTitle: task?.title ?? run.nowTitle,
  };
  set({ ...state, run: taken, notice: null });
  readopt(taken, resolveTask);
  scheduleSave(true);
  return true;
}

/** A task I finished while it was Now: "2 done · Show". */
export function recordRunDone(taskId: string): void {
  const run = state.run;
  if (!run || !inControlOf(run) || run.doneTaskIds.includes(taskId)) return;
  // Only the task the session is on counts (a Done elsewhere isn't this run's).
  if (run.nowTaskId !== taskId && getFocusSession().taskId !== taskId) return;
  set({ ...state, run: { ...run, doneTaskIds: [...run.doneTaskIds, taskId] } });
  scheduleSave();
}

/** The Now task's title as a page knows it (the timer shows it). */
export function noteRunTitle(taskId: string, title: string): void {
  const run = state.run;
  if (!run || run.nowTaskId !== taskId || run.nowTitle === title) return;
  set({ ...state, run: { ...run, nowTitle: title } });
}

/** A quiet line about the session moving on by itself; null clears it. */
export function setRunNotice(notice: string | null): void {
  if (state.notice === notice) return;
  set({ ...state, notice });
}

/** Forget the ended run's numbers (a new start clears them too). */
export function dismissEndedRun(): void {
  if (!state.ended) return;
  set({ ...state, ended: null });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Follow the run outside React. */
export function subscribeFocusRun(listener: () => void): () => void {
  return subscribe(listener);
}

function getSnapshot(): FocusRunState {
  return state;
}

/** My run, its ended numbers and its notice; re-renders when they change. */
export function useFocusRunState(): FocusRunState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-reactive read. */
export function getFocusRunState(): FocusRunState {
  return state;
}

/** Whether this device runs the run's clock. */
export function isRunInControl(run: FocusRun | null): boolean {
  return inControlOf(run);
}

/**
 * Another device's run, read through: its clock from the record, ticking once
 * a second. Null when there's no run, or this device runs it.
 */
export function useRunReadThrough(run: FocusRun | null): FocusRunReading | null {
  const session = useFocusSession();
  const here = inControlOf(run) && session.tracking;
  const [now, setNow] = useState(() => Date.now());
  const ticking = !!run && !here && run.status === "running";
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  if (!run || here) return null;
  return readRunClock(run, ticking ? now : Date.now());
}

/** The timer a run reads with (for callers that only have the run). */
export function runTimerOf(run: FocusRun | null): FocusTimerMode | null {
  return run?.mode ?? null;
}

// ── test seams ────────────────────────────────────────────────────────────────

/** A fresh store (the device id is kept). */
export function __resetFocusRunForTest(): void {
  resetMemory();
  user = null;
  rt = null;
  state = EMPTY;
  relinquishing = false;
  deviceId = readDeviceId();
  listeners.clear();
}

/** Send what's waiting and wait until no server write is left. */
export async function __flushRunSyncForTest(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
      queue(() => saveNow());
    }
    const current = chain;
    await current;
    for (let j = 0; j < 5; j++) await Promise.resolve();
    if (current === chain && saveTimer === null) return;
  }
}

/** Run the held end now (instead of waiting out the Undo window). */
export function __finishRunEndForTest(): void {
  if (pendingEnd) clearTimeout(pendingEnd.handle);
  finishEnd();
}

/** Pretend to be another device. */
export function __setRunDeviceForTest(id: string): void {
  deviceId = id;
}
