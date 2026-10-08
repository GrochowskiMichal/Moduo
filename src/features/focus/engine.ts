// The Focus engine (TV-F1): the one app-level focus clock. It lives outside
// React (a module store read through `useSyncExternalStore`), so it survives
// navigation and the AppChrome remount churn (DF-11), and it keeps time by the
// wall clock, so a hidden, throttled or suspended window loses nothing.
//
// API, in the spec's terms (specs/tasks-v2.md §3, §5; the pure model is in
// engine-core.ts):
//  - attachFocusUser(userId): scope the persisted session to the signed-in
//    person. Called by the AuthProvider. forgetFocusUser(userId) erases it.
//  - bindFocusTask(task | null): you chose the task that gets the work time.
//    Switching tasks keeps the session's rhythm; null ends the session.
//  - followFocusTask(workspaceId, task | null): the Focus view's current task
//    changed (Done, Skip, a load). It moves the session along, but never takes
//    the clock from another open tab or from another workspace's session.
//  - startFocus · toggleFocusRunning (pause/resume) · stopFocus ·
//    toggleFocusPomodoro · previewFocusInterval.
//  - resolveFocusAway("keep" | "discard" | "break"): answer "while you were away".
//  - registerFocusFlushSink(workspaceId, sink) · flushFocusSession(): where
//    tracked time is saved. TV-D3 swaps the sink for time entries
//    (`tasks_op_track_time`) without changing this surface.
//  - useFocusSession() / getFocusSession(): what the UI reads.
//
// Persistence: one record per person in localStorage under `moduo:tasks:focus:`
// (Settings → Advanced → Reset local cache clears only `moduo.*`, so a cache
// reset never kills a live session). It survives a reload, crash or restart.
//
// Tabs: only one tab runs the clock — it credits, saves and alerts. Others
// mirror the record and take over when you act in them, when the running tab
// closes, or when it stops looking for OWNER_STALE_MS. So two tabs never save
// the same seconds twice. A tab that just took the clock tells its sink so
// (`ownedSince`): its task list may predate edits made in the other tab, so it
// reloads before its first save. The desktop app has one webview and always
// runs it.
//
// Saving is at-least-once: a save confirmed by the server but not by the page
// (a reload or crash mid-save) is sent again once it's stale. TV-D3's time
// entries should carry an idempotency key.

import { useSyncExternalStore } from "react";

import { type FocusPrefs, readLocalFocusPrefs } from "../../lib/focus-prefs";
import { isTauriRuntime } from "../../lib/runtime";
import {
  adoptSession,
  type AwayChoice,
  bindTask,
  blankRecord,
  type FlushItem,
  type FlushOutcome,
  type FocusPhaseEnd,
  type FocusRecord,
  type FocusRhythm,
  type FocusRunClock,
  type FocusSession,
  type FocusTaskRef,
  hasFailedSaves,
  isRunning,
  OWNER_STALE_MS,
  observe,
  parseRecord,
  pauseSession,
  previewInterval,
  REST_SESSION,
  relinquishSession,
  resolveAway,
  resumeSession,
  reviveDeadFlights,
  sameSession,
  sameTaskRef,
  setPomodoro,
  settleFlush,
  snapshotOf,
  startSession,
  stopSession,
  takeFlushBatch,
  togglePomodoro,
} from "./engine-core";
import { alertPhaseEnd, type FocusPhaseNext } from "./phase-alert";
import { forgetSavedFocusTotals } from "./saved-totals";

export type {
  AwayChoice,
  FocusAwaySummary,
  FocusPhase,
  FocusPhaseEnd,
  FocusRunClock,
  FocusSession,
  FocusTaskRef,
} from "./engine-core";

/** The localStorage key family (`moduo:tasks:*` survives a cache reset). */
export const FOCUS_STORAGE_PREFIX = "moduo:tasks:focus:";

const TICK_MS = 1000;
/** Save tracked time this often while running, so other devices and teammates see it. */
const FLUSH_INTERVAL_MS = 60_000;
const RETRY_MIN_MS = 15_000;
const RETRY_MAX_MS = 120_000;

/** What the sink is told with each hand-off. */
export interface FocusSaveContext {
  /** When this tab took the clock: data loaded before it may predate edits
   *  made in the tab that had it, so reload before writing from it. */
  ownedSince: number;
  /** When time was last added to this task. A complete task list loaded after
   *  it that lacks the task means the task is gone. */
  earnedAt: number;
  /** The workspace whose time this is (the one the sink was registered for). */
  workspaceId: string | null;
  /** This save's idempotency key: every resend of the same seconds carries it,
   *  so the server records them once (a save cut off by a reload, a request
   *  whose answer was lost). */
  key: string;
}

/**
 * Where tracked time is saved. The Tasks module registers one per workspace
 * while it's mounted. Return:
 *  - `true`: saved;
 *  - `false`: not now (the list is loading or stale, the task isn't in it yet)
 *    — kept and offered again later, silently;
 *  - `"gone"`: the task can never take this time (deleted, no longer shared) —
 *    the seconds are dropped; the sink tells the person;
 *  - a promise for the write: resolving `false` or rejecting keeps the seconds,
 *    shows "not saved yet" and retries (F1-7) with the same key; resolving
 *    `"gone"` drops them, as above.
 */
export type FocusFlushSink = (
  taskId: string,
  seconds: number,
  context: FocusSaveContext,
) => boolean | "gone" | Promise<boolean | "gone">;

type FocusStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface FocusEngineDeps {
  storage: () => FocusStorage | null;
  now: () => number;
  readPrefs: () => FocusRhythm;
  alert: (end: FocusPhaseEnd, next: FocusPhaseNext) => void;
  /** One webview (the desktop shell): this tab always runs the clock. */
  singleWindow: () => boolean;
  tabId: string;
  /** A fresh idempotency key for a save. */
  newKey: () => string;
}

export interface FocusEngine {
  attach(userId: string | null): void;
  /** Erase a person's persisted session (account deletion). */
  forget(userId: string): void;
  bind(task: FocusTaskRef | null): void;
  follow(workspaceId: string, task: FocusTaskRef | null): void;
  start(): void;
  toggleRunning(): void;
  stop(): void;
  togglePomodoro(): void;
  /** Pomodoro or stopwatch, for the run about to start (TV-F2). */
  setPomodoro(on: boolean): void;
  /** Take over a run another device was running, as its record says (TV-F2). */
  adopt(run: FocusRunClock): void;
  /** Another device took control at `at`: stop without crediting twice. */
  relinquish(at: number): void;
  preview(prefs: FocusRhythm): void;
  resolveAway(choice: AwayChoice): void;
  registerSink(workspaceId: string | null, sink: FocusFlushSink): () => void;
  flush(): Promise<void>;
  /** Look at the clock now (also the 1 Hz tick, focus and visibility changes). */
  tick(): void;
  /** Hand the clock to whoever comes next (pagehide, sign-out). */
  release(): void;
  /** Another tab wrote the record. */
  storageChanged(key: string | null): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): FocusSession;
  dispose(): void;
}

export function createFocusEngine(deps: FocusEngineDeps): FocusEngine {
  /** undefined until the first attach; null = signed out. */
  let user: string | null | undefined;
  let key: string | null = null;
  let rec: FocusRecord = blankRecord(deps.now());
  /** The raw string last read or written, so an unchanged record isn't re-parsed. */
  let lastRaw: string | null = null;
  let snapshot: FocusSession = REST_SESSION;
  const listeners = new Set<() => void>();
  const sinks = new Map<string | null, FocusFlushSink>();
  /** Tasks whose hand-off this page is still waiting on. */
  const liveFlights = new Set<string>();
  /** When this tab last took the clock (from another tab, or from nobody). */
  let ownedSince = 0;
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let flushHandle: ReturnType<typeof setInterval> | null = null;
  let retryHandle: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = RETRY_MIN_MS;
  let flushing = false;
  let flushAgain = false;
  /** A replaced engine (a page that's gone) never writes again. */
  let disposed = false;

  // ── record I/O ────────────────────────────────────────────────────────────

  /** The freshest record: storage (another tab may have written it), else memory. */
  function load(): FocusRecord {
    if (!key) return rec;
    const store = deps.storage();
    if (!store) return rec;
    let raw: string | null;
    try {
      raw = store.getItem(key);
    } catch {
      return rec;
    }
    if (raw === lastRaw) return rec;
    lastRaw = raw;
    rec = parseRecord(raw) ?? blankRecord(deps.now());
    return rec;
  }

  function save(next: FocusRecord): void {
    if (disposed) return;
    rec = next;
    if (!key) return;
    const store = deps.storage();
    if (!store) return;
    try {
      const raw = JSON.stringify(next);
      store.setItem(key, raw);
      lastRaw = raw;
    } catch {
      /* quota exceeded or storage disabled — keep going in memory */
    }
  }

  /** Apply a change to the record stored under `atKey` — the current person's
   *  (through memory), or one who has since signed out (straight to storage). */
  function saveAt(atKey: string | null, change: (r: FocusRecord) => FocusRecord): void {
    if (atKey === key) {
      save(change(load()));
      return;
    }
    if (disposed || !atKey) return;
    const store = deps.storage();
    if (!store) return;
    try {
      const stored = parseRecord(store.getItem(atKey));
      if (stored) store.setItem(atKey, JSON.stringify(change(stored)));
    } catch {
      /* storage unavailable — nothing to settle against */
    }
  }

  function publish(prefs: FocusRhythm = deps.readPrefs()): void {
    const next = snapshotOf(rec, deps.now(), prefs);
    if (sameSession(next, snapshot)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  // ── who runs the clock ────────────────────────────────────────────────────

  function mayRun(r: FocusRecord, now: number): boolean {
    return (
      r.owner === deps.tabId ||
      r.owner === null ||
      deps.singleWindow() ||
      now - r.seenAt > OWNER_STALE_MS
    );
  }

  function claim(r: FocusRecord): FocusRecord {
    if (r.owner === deps.tabId) return r;
    ownedSince = deps.now();
    return { ...r, owner: deps.tabId };
  }

  // ── timers ────────────────────────────────────────────────────────────────

  function syncTimers(): void {
    const running = user !== undefined && isRunning(rec);
    if (running && tickHandle === null) {
      tickHandle = setInterval(tick, TICK_MS);
      flushHandle = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    } else if (!running && tickHandle !== null) {
      stopTimers();
    }
  }

  function stopTimers(): void {
    if (tickHandle !== null) clearInterval(tickHandle);
    if (flushHandle !== null) clearInterval(flushHandle);
    tickHandle = null;
    flushHandle = null;
  }

  function clearRetry(): void {
    if (retryHandle !== null) clearTimeout(retryHandle);
    retryHandle = null;
  }

  function scheduleRetry(): void {
    if (retryHandle !== null) return;
    retryHandle = setTimeout(() => {
      retryHandle = null;
      void flush();
    }, retryDelay);
    retryDelay = Math.min(RETRY_MAX_MS, retryDelay * 2);
  }

  /** A live phase end: chime + (in the background) one notification, and bank
   *  a finished work block right away. */
  function announce(ends: FocusPhaseEnd[], after: FocusRecord): void {
    const last = ends[ends.length - 1];
    if (!last) return;
    try {
      deps.alert(last, {
        phase: after.phase,
        longBreak: after.longBreak,
        lengthMs: after.phaseMs,
        running: isRunning(after),
      });
    } catch (error) {
      console.warn("[focus] phase alert failed", error);
    }
    if (ends.some((end) => end.phase === "work")) void flush();
  }

  // ── the clock ─────────────────────────────────────────────────────────────

  function tick(): void {
    if (user === undefined || disposed) return;
    const now = deps.now();
    const r = load();
    if (!mayRun(r, now)) {
      // Another tab runs this clock: just show it.
      publish();
      syncTimers();
      return;
    }
    const prefs = deps.readPrefs();
    const o = observe(claim(r), now, prefs);
    save(o.rec);
    publish(prefs);
    syncTimers();
    announce(o.liveEnds, o.rec);
  }

  /** A user action: take the clock, catch it up to now, apply the change. */
  function act(
    change: (r: FocusRecord, now: number, prefs: FocusRhythm) => FocusRecord,
    opts: { flush?: boolean } = {},
  ): void {
    if (user === undefined) return;
    const now = deps.now();
    const prefs = deps.readPrefs();
    const o = observe(claim(load()), now, prefs);
    save(change(o.rec, now, prefs));
    publish(prefs);
    syncTimers();
    announce(o.liveEnds, o.rec);
    if (opts.flush) void flush();
  }

  // ── flushing ──────────────────────────────────────────────────────────────

  /** Hand one item to the sink. A synchronous answer settles synchronously, so a
   *  flush with a synchronous sink (or none) finishes before it returns. */
  function runSink(
    sink: FocusFlushSink,
    item: FlushItem,
    workspaceId: string | null,
  ): FlushOutcome | Promise<FlushOutcome> {
    try {
      const result = sink(item.taskId, item.seconds, {
        ownedSince,
        earnedAt: item.earnedAt,
        workspaceId,
        key: item.key,
      });
      if (result === "gone") return "gone";
      if (typeof result === "boolean") return result ? "saved" : "later";
      return result.then(
        (ok): FlushOutcome => (ok === "gone" ? "gone" : ok ? "saved" : "failed"),
        (): FlushOutcome => "failed",
      );
    } catch {
      return "failed";
    }
  }

  async function flush(): Promise<void> {
    if (user === undefined || disposed || sinks.size === 0) return;
    if (flushing) {
      flushAgain = true;
      return;
    }
    const startedAt = deps.now();
    const first = load();
    // Only the tab that runs the clock saves it, so no second is saved twice.
    if (!mayRun(first, startedAt)) return;
    // The person whose time this is, even if they sign out mid-save.
    const flushKey = key;
    flushing = true;
    try {
      const prefs = deps.readPrefs();
      const o = observe(claim(first), startedAt, prefs);
      save(o.rec);
      announce(o.liveEnds, o.rec);
      for (const [workspaceId, sink] of [...sinks]) {
        if (key !== flushKey) break;
        const now = deps.now();
        const batch = takeFlushBatch(
          reviveDeadFlights(load(), liveFlights, now, workspaceId),
          workspaceId,
          now,
          deps.newKey,
        );
        if (batch.items.length === 0) continue;
        save(batch.rec);
        publish(prefs);
        for (const item of batch.items) {
          if (key !== flushKey) {
            // Signed out mid-batch: hand the rest back untouched.
            saveAt(flushKey, (r) => settleFlush(r, item, "later", deps.now()));
            continue;
          }
          liveFlights.add(item.taskId);
          const pending = runSink(sink, item, workspaceId);
          const outcome = typeof pending === "string" ? pending : await pending;
          liveFlights.delete(item.taskId);
          // Re-read: the clock kept ticking (and writing) while the save ran.
          saveAt(flushKey, (r) => settleFlush(r, item, outcome, deps.now()));
          // A resent save went through: the time earned meanwhile goes next.
          if (outcome === "saved" && item.resend) flushAgain = true;
          if (key === flushKey) publish(prefs);
        }
      }
    } finally {
      flushing = false;
    }
    publish();
    // Keep retrying while some task's save has failed; stop once none has.
    if (key === flushKey && hasFailedSaves(load())) {
      scheduleRetry();
    } else if (key === flushKey) {
      clearRetry();
      retryDelay = RETRY_MIN_MS;
    }
    if (flushAgain) {
      flushAgain = false;
      void flush();
    }
  }

  // ── public surface ────────────────────────────────────────────────────────

  function attach(userId: string | null): void {
    if (userId === user) return;
    if (user) release();
    stopTimers();
    clearRetry();
    retryDelay = RETRY_MIN_MS;
    user = userId;
    key = userId ? `${FOCUS_STORAGE_PREFIX}${userId}` : null;
    lastRaw = null;
    rec = blankRecord(deps.now());
    load();
    publish();
    // Catch up whatever happened while the app was closed (an away gap, phase
    // ends), and start the clock again if it's running.
    tick();
  }

  function forget(userId: string): void {
    try {
      deps.storage()?.removeItem(`${FOCUS_STORAGE_PREFIX}${userId}`);
    } catch {
      /* storage unavailable — nothing to erase */
    }
    forgetSavedFocusTotals(userId);
    if (userId !== user) return;
    // Nothing for this person is written to this device again.
    key = null;
    stopTimers();
    clearRetry();
    lastRaw = null;
    rec = blankRecord(deps.now());
    publish();
  }

  function release(): void {
    if (user === undefined || !key) return;
    const r = load();
    if (r.owner !== deps.tabId) return;
    const o = observe(r, deps.now(), deps.readPrefs());
    save({ ...o.rec, owner: null });
  }

  function bind(task: FocusTaskRef | null): void {
    if (user === undefined) return;
    const r = load();
    if (task === null && r.task === null) return;
    if (task && r.task?.id === task.id) {
      // The same task again (a remount, a rename): only the running tab
      // refreshes the label, and it never takes the clock from another tab.
      if (sameTaskRef(r.task, task) || !mayRun(r, deps.now())) return;
      act((cur, now, prefs) => bindTask(cur, task, now, prefs));
      return;
    }
    // A different task (or none): bank the previous one's time.
    act((cur, now, prefs) => bindTask(cur, task, now, prefs), { flush: true });
  }

  function follow(workspaceId: string, task: FocusTaskRef | null): void {
    if (user === undefined) return;
    const r = load();
    // Another open tab runs this clock: its own view decides.
    if (!mayRun(r, deps.now())) return;
    // A session on another workspace's task keeps going; it isn't this view's.
    if (r.tracking && r.task && r.task.workspaceId !== workspaceId) return;
    bind(task);
  }

  function preview(prefs: FocusRhythm): void {
    if (user === undefined) return;
    const r = load();
    if (!mayRun(r, deps.now())) return;
    const next = previewInterval(r, prefs);
    if (next === r) return;
    save(claim(next));
    publish();
  }

  function registerSink(workspaceId: string | null, sink: FocusFlushSink): () => void {
    sinks.set(workspaceId, sink);
    void flush(); // drain what accrued while no sink was attached
    return () => {
      if (sinks.get(workspaceId) !== sink) return;
      void flush(); // bank what's accrued before the sink goes
      sinks.delete(workspaceId);
    };
  }

  function storageChanged(changedKey: string | null): void {
    if (!key || (changedKey !== null && changedKey !== key)) return;
    load();
    publish();
    syncTimers();
  }

  return {
    attach,
    forget,
    bind,
    follow,
    start: () => act((r, now, prefs) => startSession(r, now, prefs)),
    toggleRunning: () =>
      act(
        (r, now) => (isRunning(r) ? pauseSession(r, now) : resumeSession(r, now)),
        // Pausing banks the time; resuming has nothing new to save.
        { flush: isRunning(load()) },
      ),
    stop: () => act((r, now, prefs) => stopSession(r, now, prefs), { flush: true }),
    togglePomodoro: () => act((r, now, prefs) => togglePomodoro(r, now, prefs)),
    setPomodoro: (on) => act((r, now, prefs) => setPomodoro(r, on, now, prefs)),
    adopt: (run) => act((r, now, prefs) => adoptSession(r, run, now, prefs), { flush: true }),
    relinquish: (at) => {
      if (user === undefined) return;
      const r = load();
      if (!r.tracking && !r.task) return;
      act((cur, now, prefs) => relinquishSession(cur, at, now, prefs), { flush: true });
    },
    preview,
    resolveAway: (choice) =>
      act((r, now, prefs) => resolveAway(r, choice, now, prefs), { flush: choice === "keep" }),
    registerSink,
    flush,
    tick,
    release,
    storageChanged,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    dispose() {
      disposed = true;
      stopTimers();
      clearRetry();
      listeners.clear();
      sinks.clear();
    },
  };
}

// ── the app's engine ──────────────────────────────────────────────────────────

function newTabId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
}

/** A save's idempotency key: what tasks_op_track_time accepts (8–64 of
 *  A–Z a–z 0–9 _ -). */
function newSaveKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `save-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
}

let alertImpl: FocusEngineDeps["alert"] = alertPhaseEnd;

function appDeps(): FocusEngineDeps {
  return {
    storage: () => {
      try {
        return typeof window === "undefined" ? null : window.localStorage;
      } catch {
        return null;
      }
    },
    now: () => Date.now(),
    readPrefs: readLocalFocusPrefs,
    alert: (end, next) => alertImpl(end, next),
    singleWindow: isTauriRuntime,
    tabId: newTabId(),
    newKey: newSaveKey,
  };
}

let engine = createFocusEngine(appDeps());
let windowListening = false;

/** Recompute on focus/visibility (timers may have been throttled), hand the
 *  clock over on pagehide, mirror other tabs, retry saves when back online. */
function listenToWindow(): void {
  if (windowListening || typeof window === "undefined") return;
  windowListening = true;
  const look = () => engine.tick();
  document.addEventListener("visibilitychange", look);
  window.addEventListener("focus", look);
  window.addEventListener("pageshow", look);
  window.addEventListener("pagehide", () => engine.release());
  window.addEventListener("online", () => void engine.flush());
  window.addEventListener("storage", (event) => engine.storageChanged(event.key));
}

/** Scope the persisted session to the signed-in person (null = signed out). */
export function attachFocusUser(userId: string | null): void {
  listenToWindow();
  engine.attach(userId);
}

/** Erase a person's persisted focus data from this device (account deletion). */
export function forgetFocusUser(userId: string): void {
  engine.forget(userId);
}

/**
 * You chose the task that gets the work time ("Track time" on a card).
 * Same task → refresh its label. A different task → the previous one's time is
 * banked and the session carries on (rhythm, pomodoro, running) on the new one.
 * Null → the session ends. Never auto-starts.
 */
export function bindFocusTask(task: FocusTaskRef | null): void {
  engine.bind(task);
}

/**
 * The Focus view's current task in `workspaceId` changed (Done, Skip, a load):
 * the session follows it, like bindFocusTask, except it never takes the clock
 * from another open tab and never moves a session on another workspace's task.
 */
export function followFocusTask(workspaceId: string, task: FocusTaskRef | null): void {
  engine.follow(workspaceId, task);
}

/** Start tracking (opt-in, never auto-called). Needs a bound task. */
export function startFocus(): void {
  engine.start();
}

/** Pause / resume. Pausing saves the time tracked so far. */
export function toggleFocusRunning(): void {
  engine.toggleRunning();
}

/** Stop tracking and save; the task stays bound so "Track time" is offered again. */
export function stopFocus(): void {
  engine.stop();
}

/** Switch stopwatch ↔ pomodoro (the rhythm starts over with a work block). */
export function toggleFocusPomodoro(): void {
  engine.togglePomodoro();
}

/** Pomodoro (true) or stopwatch (false) for the run about to start (TV-F2). */
export function setFocusPomodoro(on: boolean): void {
  engine.setPomodoro(on);
}

/**
 * This device takes over a run another device was running (TV-F2): the
 * session becomes the run as its shared record says it is now, and the clock
 * runs here from now on.
 */
export function adoptFocusRun(run: FocusRunClock): void {
  engine.adopt(run);
}

/**
 * Another device took control of the run at `at` (epoch ms): this device's
 * session stops, and what it credited after `at` is taken back (that time is
 * counted there). Earlier unsaved time is still saved.
 */
export function relinquishFocus(at: number): void {
  engine.relinquish(at);
}

/** While paused, show an edited interval right away. No-op while running. */
export function previewFocusInterval(prefs: FocusPrefs): void {
  engine.preview(prefs);
}

/** Answer "while you were away": keep, discard, or count it as a break. */
export function resolveFocusAway(choice: AwayChoice): void {
  engine.resolveAway(choice);
}

/**
 * Register where `workspaceId`'s tracked time is saved (see FocusFlushSink).
 * Drains anything accrued while unregistered; the returned cleanup saves what's
 * accrued before the sink goes.
 */
export function registerFocusFlushSink(workspaceId: string, sink: FocusFlushSink): () => void {
  return engine.registerSink(workspaceId, sink);
}

/** Save now: e.g. once the Tasks bundle has loaded after a remount (DF-11). */
export function flushFocusSession(): void {
  void engine.flush();
}

function subscribe(listener: () => void): () => void {
  return engine.subscribe(listener);
}

function getSnapshot(): FocusSession {
  return engine.getSnapshot();
}

/** The live session; re-renders when what it shows changes (each second while running). */
export function useFocusSession(): FocusSession {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Follow the session outside React (the run store, TV-F2). Survives a test
 *  reset of the engine: the listener moves to the new one. */
const outsideListeners = new Set<() => void>();
let outsideUnsub: (() => void) | null = null;
function wireOutside(): void {
  outsideUnsub?.();
  outsideUnsub =
    outsideListeners.size > 0
      ? engine.subscribe(() => {
          for (const listener of outsideListeners) listener();
        })
      : null;
}
export function subscribeFocusSession(listener: () => void): () => void {
  outsideListeners.add(listener);
  if (outsideListeners.size === 1) wireOutside();
  return () => {
    outsideListeners.delete(listener);
    if (outsideListeners.size === 0) wireOutside();
  };
}

/** Non-reactive read (tests, imperative callers). */
export function getFocusSession(): FocusSession {
  return engine.getSnapshot();
}

/**
 * Test seam: a fresh engine, like a new page load (a new tab id; localStorage
 * is left as it is). `alert` replaces the phase-end chime/notification.
 */
export function __resetFocusEngineForTest(opts: { alert?: FocusEngineDeps["alert"] } = {}): void {
  engine.dispose();
  alertImpl = opts.alert ?? alertPhaseEnd;
  engine = createFocusEngine(appDeps());
  wireOutside();
}
