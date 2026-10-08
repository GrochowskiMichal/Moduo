// The queue run (TV-F2, specs/tasks-v2.md §3): my run, which device is in
// control of it, and the server record that carries it to my other devices.
// A module store outside React, like the engine, so it survives navigation:
// leaving Tasks keeps the run going (F2-3).
//
//  - The clock is the TV-F1 engine on the device in control. Starting a run
//    binds the engine to the queue's first task and starts it; the run's
//    Pomodoro/Stopwatch mode is the engine's pomodoro flag.
//  - `focus_runs` (one open run per person) holds the run for my other
//    devices and for teammates' "<name> is on this". The device in control
//    saves it on every change of state and at least once a minute.
//  - Another device shows the run read through, from the record's shared
//    timestamps. Acting on it (Done, Skip, Pause, …) takes control: its
//    engine takes the run over as the record says it is, and saves with
//    `take`. The device that lost control hears it (Realtime, else the next
//    poll or save) and stops, giving back what it credited after the
//    takeover, so the time is never counted twice.
//  - Until the migration is on the server the run lives on this device only.
//
// Persistence: the run as last known, per person, in localStorage under
// `moduo:tasks:focus-run:` (Reset local cache clears only `moduo.*`).

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  adoptFocusRun,
  bindFocusTask,
  followFocusTask,
  getFocusSession,
  relinquishFocus,
  setFocusPomodoro,
  startFocus,
  subscribeFocusSession,
  toggleFocusRunning,
  useFocusSession,
} from "./engine";
import type { FocusTaskRef } from "./engine-core";
import {
  type FocusRun,
  type FocusRunMode,
  type FocusRunReading,
  type FocusRunRuntime,
  type FocusRunSnapshot,
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

export interface QueueRunState {
  /** My open run, or null. */
  run: FocusRun | null;
  /** The run that just ended: a quiet line until the next start. */
  ended: FocusRun | null;
  /** A quiet note about the run moving on by itself ("Mike completed …"). */
  notice: string | null;
}

const EMPTY: QueueRunState = { run: null, ended: null, notice: null };

/** Resolves a task id to what the engine binds (title, bucket, workspace). */
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
let state: QueueRunState = EMPTY;
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
/** Server writes go one at a time, in the order they were made. */
let chain: Promise<void> = Promise.resolve();
/** A run started here, by its local id, once the server answered. */
const serverIds = new Map<string, string>();
/** What the last session change looked like (status/phase/blocks/task). */
let lastSessionKey = "";
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

function set(next: QueueRunState): void {
  const runChanged = next.run !== state.run;
  state = next;
  if (runChanged) writeLocal(next.run);
  for (const listener of listeners) listener();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function queue(op: () => Promise<void>): void {
  const e = epoch;
  chain = chain
    .then(() => (e === epoch ? op() : undefined))
    .catch((error) => {
      console.warn("[focus] run sync failed", error);
    });
}

function inControlOf(run: FocusRun | null): boolean {
  return !!run && run.deviceId === deviceId;
}

// ── receiving the server's copy ──────────────────────────────────────────────

/** The run ended (here or elsewhere): stop this device's clock if it ran it. */
function endedElsewhere(local: FocusRun, at: number, server?: FocusRun): void {
  if (inControlOf(local) && getFocusSession().tracking) relinquishFocus(at);
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
    return;
  }
  if (local?.local) {
    // Started here and not answered yet (or runs aren't on the server): only
    // a newer run from elsewhere replaces it.
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
    }
    return;
  }
  const wasMine = inControlOf(local);
  const nowMine = server.deviceId === deviceId;
  if (local && wasMine && !nowMine) {
    // Another device took control: stop here, giving back what this device
    // credited after the takeover.
    if (getFocusSession().tracking) relinquishFocus(Date.parse(server.controlAt));
    lastSessionKey = "";
  }
  if (nowMine && local && local.id === server.id) {
    // This device writes the run; keep its fresher copy, take the server's
    // control fields.
    set({ ...state, run: { ...local, controlAt: server.controlAt, seenAt: server.seenAt } });
    return;
  }
  const nowTitle = local && local.nowTaskId === server.nowTaskId ? local.nowTitle : null;
  set({
    ...state,
    run: { ...server, nowTitle },
    ended: local && local.id === server.id ? state.ended : null,
  });
}

async function refreshRun(): Promise<void> {
  if (!rt || !user) return;
  const e = epoch;
  try {
    const server = await rt.latestRun();
    if (e !== epoch) return;
    // Don't let a slow read land over a write in flight; the write answers.
    if (saveTimer !== null) return;
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
      const withTake = pendingTake;
      pendingTake = false;
      queue(() => saveNow(withTake));
    },
    take ? 0 : SAVE_DEBOUNCE_MS,
  );
}

async function saveNow(take: boolean): Promise<void> {
  const run = state.run;
  if (!run || !rt || run.local) return;
  if (!inControlOf(run) && !take) return;
  const saved = await rt.saveRun({
    runId: run.id,
    deviceId,
    take,
    state: snapshotFor(run, Date.now()),
  });
  receive(saved);
}

// ── following the clock ──────────────────────────────────────────────────────

/** The engine changed: pause/resume, a phase end, a new block. Save it. */
function onSession(): void {
  const run = state.run;
  if (!run || !inControlOf(run)) return;
  const s = getFocusSession();
  if (!s.tracking) return;
  const status = s.running ? "running" : "paused";
  const key = [status, s.phase, s.longBreak, s.completedWork, s.pomodoro, s.taskId].join("|");
  if (key === lastSessionKey) return;
  lastSessionKey = key;
  const now = Date.now();
  const snap = runSnapshotFromSession(s, run, now);
  set({
    ...state,
    run: {
      ...run,
      status,
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
}

function heartbeat(): void {
  const run = state.run;
  if (!run || !inControlOf(run) || run.status !== "running") return;
  queue(() => saveNow(false));
}

function onVisible(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_THROTTLE_MS) return;
  lastRefreshAt = now;
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
  // Another tab of this device moved the run: show what it saved.
  state = { ...state, run: readLocal(user) };
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
  pollHandle = null;
  heartbeatHandle = null;
  saveTimer = null;
  pendingTake = false;
}

// ── public surface ────────────────────────────────────────────────────────────

/**
 * Scope the run to the signed-in person (null = signed out). Called by the
 * AuthProvider next to the engine's attach. `subscribe` replaces Realtime in tests.
 */
export function attachRunUser(
  userId: string | null,
  runtime: { focus: FocusRunRuntime } | null,
  opts: { subscribe?: Subscriber | null } = {},
): void {
  const nextRt = runtime?.focus ?? null;
  if (userId === user && nextRt === rt) return;
  unsubRealtime?.();
  unsubRealtime = null;
  unsubSession?.();
  unsubSession = null;
  stopTimers();
  epoch += 1;
  chain = Promise.resolve();
  serverIds.clear();
  lastSessionKey = "";
  user = userId;
  rt = nextRt;
  if (!userId) {
    state = EMPTY;
    for (const listener of listeners) listener();
    return;
  }
  state = { run: readLocal(userId), ended: null, notice: null };
  for (const listener of listeners) listener();
  listenToWindow();
  lastRefreshAt = Date.now();
  unsubSession = subscribeFocusSession(onSession);
  heartbeatHandle = setInterval(heartbeat, HEARTBEAT_MS);
  if (rt) {
    pollHandle = setInterval(poll, POLL_MS);
    const subscribe = opts.subscribe === undefined ? defaultSubscribe : opts.subscribe;
    if (subscribe) {
      unsubRealtime = subscribe(
        userId,
        (row) => receive(focusRunRowToModel(row)),
        () => void refreshRun(),
      );
    }
    void refreshRun();
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

/** Look at the server now (a test seam, and after a reconnect). */
export function refreshQueueRun(): Promise<void> {
  return refreshRun();
}

/** This device's id in `focus_runs.device_id`. */
export function runDeviceId(): string {
  return deviceId;
}

/**
 * ▶ Start run (F2-1): the engine binds the first task of my queue and starts,
 * in the mode picked for the run; the server starts the run (ending any open
 * run of mine, on any device).
 */
export function startQueueRun(input: {
  workspaceId: string;
  mode: FocusRunMode;
  task: FocusTaskRef;
}): void {
  if (!user) return;
  const me = user;
  const previous = state.run;
  bindFocusTask(input.task);
  setFocusPomodoro(input.mode === "pomodoro");
  startFocus();
  const now = Date.now();
  const session = getFocusSession();
  const base: FocusRun = {
    id: `local-${newId()}`,
    local: true,
    workspaceId: input.workspaceId,
    userId: me,
    status: "running",
    mode: input.mode,
    startedAt: iso(now),
    endedAt: null,
    nowTaskId: input.task.id,
    nowTitle: input.task.title,
    phase: "work",
    phaseStartedAt: iso(now),
    phaseSeconds: input.mode === "pomodoro" ? Math.max(1, session.phaseSeconds) : null,
    pausedAt: null,
    blocksCompleted: 0,
    focusedSeconds: 0,
    doneTaskIds: [],
    deviceId,
    controlAt: iso(now),
    seenAt: iso(now),
  };
  const snap = runSnapshotFromSession(session, base, now);
  const local: FocusRun = {
    ...base,
    phaseStartedAt: snap.phaseStartedAt,
    phaseSeconds: snap.phaseSeconds,
  };
  lastSessionKey = "";
  set({ run: local, ended: null, notice: null });
  if (previous && !previous.local && previous.id !== local.id) {
    // The server ends it when this one starts; nothing to send for it.
  }
  if (!rt) return;
  const runtime = rt;
  queue(async () => {
    const saved = await runtime.startRun({
      workspaceId: input.workspaceId,
      deviceId,
      mode: input.mode,
      state: snapshotFor(state.run?.id === local.id ? state.run : local, Date.now()),
    });
    if (!saved) return; // runs aren't on the server yet: it stays on this device
    serverIds.set(local.id, saved.id);
    const current = state.run;
    if (current?.id === local.id) {
      set({
        ...state,
        run: {
          ...current,
          id: saved.id,
          local: undefined,
          controlAt: saved.controlAt,
          seenAt: saved.seenAt,
        },
      });
      // Anything that changed while the start was on its way.
      scheduleSave();
    }
  });
}

/**
 * Take control of the run on this device if another device has it (or this
 * device lost its clock): the engine takes the run over as its record says it
 * is now. Every run action calls this first.
 */
export function takeRunControl(resolveTask: TaskRefResolver): boolean {
  const run = state.run;
  if (!run) return false;
  const session = getFocusSession();
  if (inControlOf(run) && session.tracking) return true;
  const now = Date.now();
  const task = run.nowTaskId ? resolveTask(run.nowTaskId) : null;
  adoptFocusRun(runClockForAdopt(run, task, now));
  lastSessionKey = "";
  set({
    ...state,
    run: { ...run, deviceId, controlAt: iso(now), nowTitle: task?.title ?? run.nowTitle },
    notice: null,
  });
  scheduleSave(true);
  return true;
}

/** Pause or resume the run (F2-1). */
export function toggleQueueRunPause(resolveTask: TaskRefResolver): void {
  if (!takeRunControl(resolveTask)) return;
  toggleFocusRunning();
}

/**
 * End run (F2-1), or the queue emptied: the clock stops here (its time is
 * saved), the server marks the run ended, and other devices stop showing it.
 */
export function endQueueRun(): void {
  const run = state.run;
  if (!run) return;
  const now = Date.now();
  const session = getFocusSession();
  const reading = readRunClock(run, now);
  const fromClock = inControlOf(run) && session.tracking;
  const focusedSeconds = fromClock ? session.sitElapsed : reading.focusedSeconds;
  const blocksCompleted = fromClock ? session.completedWork : run.blocksCompleted;
  if (session.tracking && inControlOf(run)) bindFocusTask(null);
  const ended: FocusRun = {
    ...run,
    status: "ended",
    endedAt: iso(now),
    pausedAt: null,
    focusedSeconds,
    blocksCompleted,
  };
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  pendingTake = false;
  set({ run: null, ended, notice: null });
  if (!rt) return;
  const runtime = rt;
  queue(async () => {
    const id = serverIds.get(run.id) ?? run.id;
    if (id.startsWith("local-")) return;
    await runtime.endRun({
      runId: id,
      deviceId,
      state: {
        focusedSeconds,
        blocksCompleted,
        doneTaskIds: run.doneTaskIds,
        nowTaskId: run.nowTaskId,
      },
    });
  });
}

/** A task I completed in the run (Done on Now): "2 done this run". */
export function recordRunDone(taskId: string, resolveTask: TaskRefResolver): void {
  const run = state.run;
  if (!run || run.doneTaskIds.includes(taskId)) return;
  takeRunControl(resolveTask);
  const current = state.run;
  if (!current) return;
  set({ ...state, run: { ...current, doneTaskIds: [...current.doneTaskIds, taskId] } });
  scheduleSave();
}

/**
 * Now moved (the head of my queue changed, F2-2): the engine follows it with
 * the rhythm kept, and the record names the new task. Null: the queue is
 * empty, so the run ends. `explicit`: the person acted here (Done, Skip, Do
 * now), so this tab takes the clock; otherwise it only follows (never takes
 * the clock from another tab, or moves a run in another workspace).
 */
export function moveQueueRun(
  workspaceId: string,
  task: FocusTaskRef | null,
  opts: { explicit: boolean },
): void {
  const run = state.run;
  if (!run || run.workspaceId !== workspaceId || !inControlOf(run)) return;
  if (task === null) {
    endQueueRun();
    return;
  }
  if (opts.explicit) bindFocusTask(task);
  else followFocusTask(workspaceId, task);
  if (run.nowTaskId !== task.id) {
    set({ ...state, run: { ...run, nowTaskId: task.id, nowTitle: task.title } });
    scheduleSave();
  } else if (run.nowTitle !== task.title) {
    set({ ...state, run: { ...run, nowTitle: task.title } });
  }
}

/** The Now task's title as the Tasks page knows it (the chip shows it). */
export function noteQueueRunTitle(taskId: string, title: string): void {
  const run = state.run;
  if (!run || run.nowTaskId !== taskId || run.nowTitle === title) return;
  set({ ...state, run: { ...run, nowTitle: title } });
}

/** A quiet line about the run moving on by itself; null clears it. */
export function setQueueRunNotice(notice: string | null): void {
  if (state.notice === notice) return;
  set({ ...state, notice });
}

/** Forget the ended run's line (a new start clears it too). */
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

function getSnapshot(): QueueRunState {
  return state;
}

/** My run and its line/notice; re-renders when they change. */
export function useQueueRunState(): QueueRunState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-reactive read. */
export function getQueueRunState(): QueueRunState {
  return state;
}

/** Whether this device runs the run's clock. */
export function isRunInControl(run: FocusRun | null): boolean {
  return inControlOf(run);
}

/**
 * The run's clock as this device shows it: from the engine when this device
 * runs it, else read through from the record (ticking once a second).
 */
export function useRunReading(run: FocusRun | null): FocusRunReading | null {
  const session = useFocusSession();
  const inControl = inControlOf(run) && session.tracking;
  const [now, setNow] = useState(() => Date.now());
  const ticking = !!run && !inControl && run.status === "running";
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  if (!run) return null;
  if (inControl) {
    return {
      running: session.running,
      pomodoro: session.pomodoro,
      phase: session.phase === "work" ? "work" : session.longBreak ? "long_break" : "break",
      phaseElapsed: session.pomodoro
        ? Math.max(0, session.phaseSeconds - session.pomoLeft)
        : session.sitElapsed,
      phaseLeft: session.pomodoro ? session.pomoLeft : 0,
      bigClock: session.bigClock,
      focusedSeconds: session.sitElapsed,
    };
  }
  return readRunClock(run, ticking ? now : Date.now());
}

/** Test seam: a fresh store (a new device id is kept). */
export function __resetQueueRunForTest(): void {
  unsubRealtime?.();
  unsubRealtime = null;
  unsubSession?.();
  unsubSession = null;
  stopTimers();
  epoch += 1;
  chain = Promise.resolve();
  serverIds.clear();
  lastSessionKey = "";
  user = null;
  rt = null;
  state = EMPTY;
  deviceId = readDeviceId();
  listeners.clear();
}

/** Test seam: wait for queued server writes. */
export async function __flushRunSyncForTest(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    const withTake = pendingTake;
    pendingTake = false;
    queue(() => saveNow(withTake));
  }
  await chain;
}

/** Test seam: pretend to be another device. */
export function __setRunDeviceForTest(id: string): void {
  deviceId = id;
}
