// The shared store (Tasks v3 TV-D11a, spec §Assumptions #7, REPLAN §6.6 and
// §6.11): one copy of a workspace's Tasks data per person, shared by every
// surface — the Tasks views, the panel, Focus, the Calendar's tasks panel,
// Notes, Email, Home's widgets, the bell and the capture shell. It replaces
// the full download each of them did on mount.
//
// How a copy stays right:
//   - **Opens from the device.** The last copy is read from IndexedDB
//     (`cache.ts`) and shown at once; then the server is asked.
//   - **Open tasks first.** A first load reads To do and In progress, shows
//     them, then reads the rest (Done, Won't do, Backlog), completions and
//     comment counts.
//   - **Then only what changed.** Each table keeps a cursor (the newest server
//     `updated_at` it has read) and later reads ask for rows changed since,
//     a few minutes early (a save that committed late is never missed),
//     soft-deleted rows included. The queue, tag links and relations have no
//     stamps (hard deletes) and are read whole; they are small.
//   - **Realtime on top** (TV-D5's channel): a row lands only if it is newer
//     by the server's stamp. A reconnect or a return to the window reads the
//     changes again: Realtime is a latency layer, never the source of truth.
//   - **Rows you can no longer see** never show up in a delta, so once per
//     session the store checks which ids are still yours and drops the rest.
//
// Writes are ops laid over the rows the server sent (`begin`). Each op has an
// id; an op's fields stay on top until its answer comes back (a Realtime echo
// of your own write never flicks the field back: echo skip by op id), then
// the answer becomes the row. If the server refuses, only that op's fields go
// away: one field rolls back to what the server holds, nothing reloads.
//
// Offline (default g): everything reads from the device copy; captures and
// check-offs wait in an outbox kept with the copy ("2 waiting to sync") and
// are sent in order when the network is back, each under its own id, so a
// resend never makes a second task. Other edits say "Offline" (the hook).

import { toast } from "sonner";
import { applyLiveTags, seedTags } from "../../features/tags/store";
import { isNewer, type LiveChange, timestampMicros } from "../../features/tasks/live";
import type {
  RecurrenceRule,
  Task,
  TaskCompletion,
  TaskQueueEntry,
  TaskReminder,
  TaskSession,
  TasksModuleBundle,
  TaskWaitingEntry,
} from "../../features/tasks/model";
import { listenTasksLive, type TasksLiveEvent } from "../../features/tasks/realtime";
import { TAG_LINKS_SCOPE, type Truncation } from "../paged-select";
import type { ModuoRuntime } from "../runtime.types";
import { sortQueueEntries } from "../task-rows";
import {
  CACHE_VERSION,
  type CachedWorkspace,
  cacheKey,
  deviceCache,
  isKeyOf,
  type SyncCache,
} from "./cache";
import { browserOffline, isNetworkError } from "./network";
import type { SyncReadResult, SyncRows, SyncTableName } from "./types";

// ── Shapes ──────────────────────────────────────────────────────────────────

type AnyRow = { id: string; updatedAt?: string; deletedAt?: string | null };

/** Server rows for some tables (an op's answer, or a read). */
export type Answers = { [T in SyncTableName]?: readonly SyncRows[T][] };

/** One change an op shows before the server has it. */
export type OverlayChange =
  | { table: SyncTableName; patch: { id: string; fields: Record<string, unknown> } }
  | { table: SyncTableName; insert: AnyRow }
  | { table: SyncTableName; remove: string };

type Overlay = { op: number } & OverlayChange;

/** A write on its way: settle it with the server's rows, or fail it. */
export type PendingWrite = {
  readonly op: number;
  /** Show more changes under the same op. */
  add(changes: OverlayChange[]): void;
  /** The server took it: its rows become the copy (unless one is already newer) and the op's own fields go. */
  settle(answers?: Answers): void;
  /** The server refused (or nothing was sent): only this op's fields go. */
  fail(): void;
};

/** What waits for the network (offline captures and check-offs). */
export type OutboxEntry =
  | {
      kind: "create";
      id: string;
      task: Task;
      /** Also line it up at the end of my queue once it exists. */
      queue?: boolean;
    }
  | {
      kind: "status";
      id: string;
      taskId: string;
      /** A status id, or a category word (`taskStatusWord`). */
      status: string;
      recurrence?: RecurrenceRule | null;
      /** What the row shows meanwhile. */
      fields: Partial<Task>;
    };

/** What every reader gets. Shared until the next change — never mutate it. */
export type StoreSnapshot = {
  workspaceId: string | null;
  userId: string | null;
  /** The first answer is in (the device copy or the server). Before it, views show a skeleton. */
  loaded: boolean;
  /** A first load failed with nothing on the device to show. */
  error: string | null;
  /** Showing the device copy; the server hasn't answered yet this session. */
  fromCache: boolean;
  /** Done, Won't do and Backlog tasks have been read too. */
  restLoaded: boolean;
  offline: boolean;
  /** Captures and check-offs waiting to be sent. */
  pending: number;
  /** Bumped by the first read of the session that reached the server, and by `reload`: the repeat roll-over cue. */
  loadStamp: number;
  bundle: TasksModuleBundle;
  /** Every queue row I can see, in line-up order (mine with pending queue ops on top). */
  queue: TaskQueueEntry[];
  /** My rows for tasks completed since the session started: shown done, in place. */
  kept: TaskQueueEntry[];
  completions: TaskCompletion[];
  /** Live comments per task. */
  commentCounts: ReadonlyMap<string, number>;
  /** TV-D10: work sessions on tasks you can see, your own reminders, Waiting on… entries. */
  sessions: TaskSession[];
  reminders: TaskReminder[];
  waiting: TaskWaitingEntry[];
};

const EMPTY_BUNDLE: TasksModuleBundle = {
  buckets: [],
  tasks: [],
  tags: [],
  tagLinks: [],
  taskRelations: [],
  statuses: [],
  areas: [],
  sections: [],
  teams: [],
  teamMembers: [],
  truncated: [],
};

export const EMPTY_SNAPSHOT: StoreSnapshot = {
  workspaceId: null,
  userId: null,
  loaded: false,
  error: null,
  fromCache: false,
  restLoaded: false,
  offline: false,
  pending: 0,
  loadStamp: 0,
  bundle: EMPTY_BUNDLE,
  queue: [],
  kept: [],
  completions: [],
  commentCounts: new Map(),
  sessions: [],
  reminders: [],
  waiting: [],
};

// ── Tables ──────────────────────────────────────────────────────────────────

/**
 * Every table the store keeps, in read order. `delta`: read as changes since
 * a cursor; else read whole. `phase` 2 waits for the open tasks to show.
 * TV-D10's tables join here (areas, sections, sessions, reminders, waiting,
 * teams, team members): each has `workspace_id`, `updated_at`, `deleted_at`.
 */
export const SYNC_TABLES: readonly { name: SyncTableName; delta: boolean; phase: 1 | 2 }[] = [
  // Read whole every time: small, and what you can see of them changes with
  // sharing, which bumps no stamp (a project shared with you, an area that
  // shows because one of its projects does: TV-D10's `areas__visible`).
  { name: "buckets", delta: false, phase: 1 },
  { name: "statuses", delta: false, phase: 1 },
  { name: "areas", delta: false, phase: 1 },
  { name: "sections", delta: false, phase: 1 },
  { name: "teams", delta: false, phase: 1 },
  { name: "teamMembers", delta: false, phase: 1 },
  // No stamps (hard deletes): read whole.
  { name: "queue", delta: false, phase: 1 },
  { name: "tagLinks", delta: false, phase: 1 },
  { name: "relations", delta: false, phase: 1 },
  // Deltas; the access check covers what sharing shows or hides.
  { name: "tasks", delta: true, phase: 1 },
  { name: "tags", delta: true, phase: 1 },
  { name: "completions", delta: true, phase: 2 },
  { name: "comments", delta: true, phase: 2 },
  { name: "sessions", delta: true, phase: 2 },
  { name: "reminders", delta: true, phase: 2 },
  { name: "waiting", delta: true, phase: 2 },
];

/**
 * Tables whose live ids are checked against the server now and then: a row
 * you lost access to (a project made private, you left it) is hidden by RLS
 * and never shows up in a delta, so this is how it leaves the device copy.
 * The whole-read tables (queue, tag links, relations) drop such rows on every
 * read already.
 */
const ACCESS_CHECKED: readonly SyncTableName[] = SYNC_TABLES.filter((t) => t.delta).map(
  (t) => t.name,
);

/** Tables whose rows belong to one task (`taskId`): they go with it. */
const TASK_ROWS: readonly SyncTableName[] = [
  "comments",
  "completions",
  "sessions",
  "reminders",
  "waiting",
];

type TableState = {
  rows: Map<string, AnyRow>;
  /** The newest server stamp a read of this table has seen (delta tables). */
  cursor: string | null;
  /** When each row was last applied (local ms): a whole read that started
   *  earlier can't drop it (it may have been created after the read began). */
  seenAt: Map<string, number>;
  /** Ids removed (any delete: an answer, Realtime, a delta, a queue op), with
   *  when: a read that started earlier can't bring them back. */
  goneAt: Map<string, number>;
  /** Soft-deleted rows' server stamps: an older version of the row (a late
   *  echo, a read in flight) never brings it back; a restore is newer. */
  tombstones: Map<string, { stamp: string; at: number }>;
  truncated: Truncation | null;
};

function emptyTable(): TableState {
  return {
    rows: new Map(),
    cursor: null,
    seenAt: new Map(),
    goneAt: new Map(),
    tombstones: new Map(),
    truncated: null,
  };
}

/** Realtime table → store table. */
const LIVE_TO_TABLE: Record<LiveChange["table"], SyncTableName> = {
  tasks: "tasks",
  buckets: "buckets",
  tags: "tags",
  tag_links: "tagLinks",
  task_queue: "queue",
  project_statuses: "statuses",
  comments: "comments",
  areas: "areas",
  sections: "sections",
  teams: "teams",
  team_members: "teamMembers",
  task_sessions: "sessions",
  task_reminders: "reminders",
  task_waiting: "waiting",
};

// ── Timing ──────────────────────────────────────────────────────────────────

export type StoreTiming = {
  /** A delta read starts this far before its cursor: a save that committed late is still read. */
  lagMs: number;
  /** Coming back to the window reads at most this often (tasks-v2 decision 10). */
  throttleMs: number;
  /** The device copy is written this long after the last change. */
  persistMs: number;
  /** While offline, the server is tried again this often. */
  retryMs: number;
  /** A live delete keeps a row out of older reads this long. */
  goneTtlMs: number;
  /** The access check (rows you can no longer see) runs at most this often. */
  accessCheckMs: number;
  /** Everything is read whole again at least this often: a delta never re-reads
   *  a row the server changed without a new stamp (a backfill with triggers off),
   *  nor fills a field a newer build reads. */
  fullReadMs: number;
};

export const DEFAULT_TIMING: StoreTiming = {
  lagMs: 5 * 60_000,
  throttleMs: 5_000,
  persistMs: 800,
  retryMs: 20_000,
  goneTtlMs: 60_000,
  accessCheckMs: 10 * 60_000,
  fullReadMs: 24 * 60 * 60_000,
};

/** A server stamp moved back by `ms`, keeping its microseconds. */
export function stampMinus(stamp: string, ms: number): string {
  const micros = timestampMicros(stamp);
  if (micros === null) return stamp;
  const at = micros - ms * 1000;
  const whole = Math.floor(at / 1000);
  const frac = String(((at % 1000) + 1000) % 1000).padStart(3, "0");
  // toISOString gives milliseconds; add the remaining microseconds.
  return new Date(whole).toISOString().replace(/Z$/, `${frac}+00:00`);
}

// ── The store ───────────────────────────────────────────────────────────────

export type StoreOptions = {
  cache?: SyncCache;
  timing?: Partial<StoreTiming>;
  /** Realtime (TV-D5); tests pass a fake. */
  listen?: typeof listenTasksLive;
};

let nextOp = 1;

type StoreLineup = { seq: number; rows: TaskQueueEntry[] } | null;

export class WorkspaceStore {
  readonly runtime: ModuoRuntime;
  readonly userId: string;
  readonly workspaceId: string;
  private readonly cache: SyncCache;
  private readonly timing: StoreTiming;
  private readonly listen: typeof listenTasksLive;

  private tables = new Map<SyncTableName, TableState>();
  private overlays: Overlay[] = [];
  /** My line-up while queue ops are on their way (the newest op's view). */
  private lineup: StoreLineup = null;
  private kept: TaskQueueEntry[] = [];
  private outbox: OutboxEntry[] = [];
  /** Overlay op per outbox entry (rebuilt from the copy). */
  private outboxOps = new Map<string, number>();

  private loaded = false;
  private error: string | null = null;
  private fromCache = false;
  private restLoaded = false;
  /** When everything was last read whole (0: never). */
  private fullReadAt = 0;
  private offline = browserOffline();
  private loadStamp = 0;
  private reachedServer = false;
  /** When rows you can no longer see were last dropped (0: not this session). */
  private accessCheckedAt = 0;
  private accessChecking = false;
  private hydrated: Promise<void> | null = null;

  private refs = 0;
  private stopLive: (() => void) | null = null;
  private syncing: Promise<void> | null = null;
  /** A read that follows the running one (see `sync`). */
  private again: Promise<void> | null = null;
  private againReload = false;
  private lastSyncAt = 0;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private disposed = false;
  private catchUpClaimed = 0;

  private listeners = new Set<() => void>();
  private snapshot: StoreSnapshot | null = null;
  private renderedCache = new Map<SyncTableName, AnyRow[]>();
  private loadWaiters: (() => void)[] = [];

  constructor(runtime: ModuoRuntime, userId: string, workspaceId: string, opts: StoreOptions = {}) {
    this.runtime = runtime;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.cache = opts.cache ?? deviceCache();
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.listen = opts.listen ?? listenTasksLive;
    for (const t of SYNC_TABLES) this.tables.set(t.name, emptyTable());
  }

  // ── Readers ───────────────────────────────────────────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): StoreSnapshot => {
    this.snapshot ??= this.buildSnapshot();
    return this.snapshot;
  };

  /** Resolves once the first answer is in (the device copy or the server). */
  whenLoaded(): Promise<void> {
    if (this.loaded || this.error) return Promise.resolve();
    return new Promise((resolve) => this.loadWaiters.push(resolve));
  }

  /**
   * Resolves once Done, Won't do and Backlog tasks are in too (they load after
   * the open ones), or when there's nothing more to wait for (offline, an
   * error), or after `timeoutMs`.
   */
  whenRest(timeoutMs = 5_000): Promise<void> {
    if (this.restLoaded || this.offline || this.error || this.disposed) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      const stop = this.subscribe(() => {
        if (this.restLoaded || this.offline || this.error) done();
      });
      function done() {
        clearTimeout(timer);
        stop();
        resolve();
      }
    });
  }

  /** Stopped for good (signed out, another person). */
  isDisposed(): boolean {
    return this.disposed;
  }

  /** Whether a capture is waiting in the outbox under this task id. */
  isQueuedCreate(taskId: string): boolean {
    return this.outbox.some((e) => e.kind === "create" && e.task.id === taskId);
  }

  /** Claim the repeat roll-over for a load stamp: true once per stamp. */
  claimCatchUp(stamp: number): boolean {
    if (stamp === 0 || this.catchUpClaimed >= stamp) return false;
    this.catchUpClaimed = stamp;
    return true;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Keep the store running while you need it; call the returned function when done. */
  acquire(): () => void {
    this.refs += 1;
    if (this.refs === 1) this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs -= 1;
      if (this.refs <= 0) this.stop();
    };
  }

  private start(): void {
    if (this.disposed) return;
    this.stopLive = this.listen(this.workspaceId, this.userId, this.onLive);
    if (typeof window !== "undefined") {
      window.addEventListener("offline", this.onBrowserOffline);
      window.addEventListener("pagehide", this.persistNow);
    }
    this.hydrated ??= this.hydrate();
    void this.hydrated.then(() => this.sync("open"));
    // Restarted while still offline: keep trying.
    if (this.offline) this.scheduleRetry();
  }

  private stop(opts: { persist?: boolean } = {}): void {
    this.stopLive?.();
    this.stopLive = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", this.onBrowserOffline);
      window.removeEventListener("pagehide", this.persistNow);
    }
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.syncTimer = null;
    this.retryTimer = null;
    if (opts.persist !== false) this.persistNow();
  }

  /**
   * Stop for good (sign-out, another person): nothing is written after this.
   * `persist: false` drops what wasn't written yet (the copy is being wiped).
   */
  dispose(opts: { persist?: boolean } = {}): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.stop(opts);
    this.disposed = true;
    this.listeners.clear();
    this.tables.clear();
    this.overlays = [];
    this.outbox = [];
    this.lineup = null;
    this.kept = [];
    this.renderedCache.clear();
    // A component still holding it (unmounting after sign-out) reads nothing.
    this.snapshot = null;
    this.lastSnapshot = null;
    this.queueView = null;
    // Nobody waits for a first answer that will never come.
    const waiters = this.loadWaiters;
    this.loadWaiters = [];
    for (const fn of waiters) fn();
  }

  private onBrowserOffline = () => this.setOffline(true);

  // ── The device copy ───────────────────────────────────────────────────────

  private async hydrate(): Promise<void> {
    const copy = await this.cache.read(cacheKey(this.userId, this.workspaceId));
    if (!copy || copy.v !== CACHE_VERSION || this.disposed) return;
    for (const t of SYNC_TABLES) {
      const cached = copy.tables[t.name];
      if (!cached) continue;
      const state = this.table(t.name);
      // A live change that landed first is newer than the copy: it stays.
      for (const row of cached.rows as AnyRow[]) {
        if (row && typeof row.id === "string" && !state.rows.has(row.id)) {
          state.rows.set(row.id, row);
        }
      }
      state.cursor ??= cached.cursor;
      this.renderedCache.delete(t.name);
    }
    this.restLoaded = copy.restLoaded;
    this.fullReadAt = copy.fullReadAt ?? 0;
    this.outbox = Array.isArray(copy.outbox) ? (copy.outbox as OutboxEntry[]) : [];
    for (const entry of this.outbox) this.showOutboxEntry(entry);
    const hasRows = [...this.tables.values()].some((t) => t.rows.size > 0);
    if (hasRows) {
      this.fromCache = true;
      this.markLoaded();
    }
    this.changed();
  }

  /**
   * Write the copy a moment after a change. Throttled, not debounced: a busy
   * workspace's steady stream of live changes must not put the write off for
   * ever (it did, with a debounce, while teammates kept saving).
   */
  private schedulePersist(): void {
    if (this.disposed || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, this.timing.persistMs);
  }

  persistNow = (): void => {
    if (this.disposed) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    // Nothing read yet: don't overwrite a copy with an empty one.
    if (!this.loaded && this.outbox.length === 0) return;
    const tables: CachedWorkspace["tables"] = {};
    for (const [name, state] of this.tables) {
      tables[name] = { rows: [...state.rows.values()], cursor: state.cursor };
    }
    void this.cache.write(cacheKey(this.userId, this.workspaceId), {
      v: CACHE_VERSION,
      savedAt: Date.now(),
      tables,
      restLoaded: this.restLoaded,
      fullReadAt: this.fullReadAt,
      outbox: this.outbox,
    });
  };

  // ── Reading the server ────────────────────────────────────────────────────

  /**
   * Ask the server. "return" (back to the window) reads at most once per
   * throttle; "reconnect" (the socket rejoined, the network came back, a
   * quiet re-read after an op) reads once now and once more at the end of the
   * throttle window. A read already running is followed by one more.
   */
  requestSync = (reason: "return" | "reconnect" = "reconnect"): void => {
    if (this.disposed || this.refs <= 0) return;
    if (this.syncTimer) return;
    const wait = Math.max(0, this.lastSyncAt + this.timing.throttleMs - Date.now());
    if (wait > 0 && reason === "return") return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.sync("quiet");
    }, wait);
  };

  /** Read again now (a Retry, a reload): the repeat roll-over is asked again too. */
  reload = (): Promise<void> => this.sync("reload");

  /** Read what changed now, quietly (after an op whose answer isn't the row it moved). */
  syncNow = (): Promise<void> => this.sync("quiet");

  /**
   * One read at a time. A read asked for while one runs follows it, once (a
   * Retry among them makes the follow-up a reload), and resolves after it:
   * the running read may have started before what the caller wants to see.
   */
  private sync(kind: "open" | "quiet" | "reload"): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.syncing) {
      if (kind === "reload") this.againReload = true;
      this.again ??= this.syncing.then(() => {
        const next = this.againReload ? "reload" : "quiet";
        this.again = null;
        this.againReload = false;
        if (this.disposed || (this.refs <= 0 && next !== "reload")) return;
        return this.sync(next);
      });
      return this.again;
    }
    const run = (async () => {
      try {
        await this.syncOnce(kind);
      } finally {
        this.syncing = null;
      }
    })();
    this.syncing = run;
    return run;
  }

  private async syncOnce(kind: "open" | "quiet" | "reload"): Promise<void> {
    const startedAt = Date.now();
    const delta =
      !!this.runtime.tasks.syncRead &&
      this.table("tasks").cursor !== null &&
      this.restLoaded &&
      startedAt - this.fullReadAt < this.timing.fullReadMs;
    try {
      if (!this.runtime.tasks.syncRead) await this.readBundle();
      else if (!delta) await this.readFirst();
      else await this.readChanges();
    } catch (e) {
      this.onReadFailed(e);
      return;
    }
    // Only a read that worked counts for the throttle: after a failure the
    // next cue (reconnect, return) reads at once.
    this.lastSyncAt = startedAt;
    const first = !this.reachedServer;
    this.reachedServer = true;
    this.fromCache = false;
    this.error = null;
    this.setOffline(false, { quiet: true });
    if (first || kind === "reload") {
      this.loadStamp += 1;
      if (kind === "reload") this.kept = [];
    }
    this.markLoaded();
    this.changed();
    this.schedulePersist();
    void this.flush();
    // A first load (or a whole read) checked everything; after deltas, check
    // now and then what's still yours.
    if (!delta) this.accessCheckedAt = startedAt;
    else if (Date.now() - this.accessCheckedAt >= this.timing.accessCheckMs) {
      void this.checkAccess();
    }
  }

  private onReadFailed(e: unknown): void {
    if (isNetworkError(e)) {
      this.setOffline(true);
      if (!this.loaded) {
        // Offline with nothing on the device: say so rather than "no tasks".
        this.error = "You're offline. Your tasks show once you're back online.";
        this.markLoaded();
      }
      this.changed();
      return;
    }
    // A failed first load with nothing to show is an error; later reads fail
    // quietly, but what the other tables already read shows and is kept.
    if (!this.loaded) {
      this.error = e instanceof Error ? e.message : String(e);
      this.markLoaded();
    }
    this.changed();
    this.schedulePersist();
  }

  private markLoaded(): void {
    if (this.loaded && this.loadWaiters.length === 0) return;
    this.loaded = true;
    const waiters = this.loadWaiters;
    this.loadWaiters = [];
    for (const fn of waiters) fn();
  }

  /** A runtime without `syncRead` (test doubles): the old bundle reads, whole. */
  private async readBundle(): Promise<void> {
    const started = Date.now();
    const [bundle, queue] = await Promise.all([
      this.runtime.tasks.list(this.workspaceId),
      this.runtime.tasks.listQueue(this.workspaceId),
    ]);
    const truncated = (scope: string) => bundle.truncated.find((t) => t.scope === scope) ?? null;
    this.applyWhole("tasks", bundle.tasks, started, truncated("tasks"));
    this.applyWhole("buckets", bundle.buckets, started, truncated("buckets"));
    this.applyWhole("tags", bundle.tags, started, truncated("tags"));
    this.applyWhole("tagLinks", bundle.tagLinks, started, truncated(TAG_LINKS_SCOPE));
    this.applyWhole("relations", bundle.taskRelations, started, truncated("task dependencies"));
    this.applyWhole("statuses", bundle.statuses ?? [], started, truncated("statuses"));
    this.applyWhole("areas", bundle.areas ?? [], started, truncated("areas"));
    this.applyWhole("sections", bundle.sections ?? [], started, truncated("sections"));
    this.applyWhole("teams", bundle.teams ?? [], started, truncated("teams"));
    this.applyWhole("teamMembers", bundle.teamMembers ?? [], started, truncated("team members"));
    this.applyWhole(
      "queue",
      queue.filter((e) => e.workspaceId === this.workspaceId),
      started,
      null,
    );
    this.restLoaded = true;
    this.fullReadAt = started;
    this.seedTagStore(started);
  }

  private read<T extends SyncTableName>(
    table: T,
    since: string | null,
    part?: "open" | "rest",
  ): Promise<SyncReadResult<SyncRows[T]>> {
    const read = this.runtime.tasks.syncRead;
    if (!read) throw new Error("No sync read");
    return read({ workspaceId: this.workspaceId, table, since, part });
  }

  /** A first load: open tasks (and everything small) first, then the rest. */
  private async readFirst(): Promise<void> {
    const started = Date.now();
    const phase1 = SYNC_TABLES.filter((t) => t.phase === 1);
    const results = await Promise.all(
      phase1.map((t) =>
        this.read(t.name, null, t.name === "tasks" ? "open" : undefined).then(
          (res) => [t.name, res] as const,
        ),
      ),
    );
    const openTasks = new Set<string>();
    for (const [name, res] of results) {
      if (name === "tasks") {
        // The rest isn't read yet: keep the copy's other rows until it is.
        this.applyRows("tasks", res.rows as AnyRow[], "answer", started);
        for (const r of res.rows as AnyRow[]) openTasks.add(r.id);
        this.table("tasks").truncated = res.truncated;
        continue;
      }
      this.applyWhole(name, res.rows as AnyRow[], started, res.truncated);
      if (SYNC_TABLES.find((t) => t.name === name)?.delta) {
        this.table(name).cursor = res.maxUpdatedAt ?? this.table(name).cursor;
      }
    }
    const openStamp = results.find(([n]) => n === "tasks")?.[1].maxUpdatedAt ?? null;
    this.seedTagStore(started);
    // Open tasks are on screen now.
    this.markLoaded();
    this.changed();

    const phase2 = SYNC_TABLES.filter((t) => t.phase === 2);
    const [rest, ...later] = await Promise.all([
      this.read("tasks", null, "rest"),
      ...phase2.map((t) => this.read(t.name, null).then((res) => [t.name, res] as const)),
    ]);
    const all = new Map<string, AnyRow>();
    for (const id of openTasks) {
      const row = this.table("tasks").rows.get(id);
      if (row) all.set(id, row);
    }
    for (const r of rest.rows as AnyRow[]) all.set(r.id, r);
    this.applyWhole(
      "tasks",
      [...all.values()],
      started,
      this.table("tasks").truncated ?? rest.truncated,
    );
    // "" = read, but empty: later reads take its live rows until it has a stamp.
    this.table("tasks").cursor = newestOf(openStamp, rest.maxUpdatedAt) ?? "";
    for (const [name, res] of later) {
      this.applyWhole(name, res.rows as AnyRow[], started, res.truncated);
      this.table(name).cursor = res.maxUpdatedAt ?? this.table(name).cursor;
    }
    this.restLoaded = true;
    this.fullReadAt = started;
  }

  /** A later read: only what changed since each cursor (whole for stampless tables). */
  private async readChanges(): Promise<void> {
    const started = Date.now();
    await Promise.all(
      SYNC_TABLES.map(async (t) => {
        if (!t.delta) {
          const res = await this.read(t.name, null);
          this.applyWhole(t.name, res.rows as AnyRow[], started, res.truncated);
          return;
        }
        const state = this.table(t.name);
        this.pruneGone(state);
        if (!state.cursor) {
          // Never had a row: read its live rows ("" keeps an empty table's place).
          const res = await this.read(t.name, null);
          this.applyWhole(t.name, res.rows as AnyRow[], started, res.truncated);
          state.cursor = res.maxUpdatedAt ?? state.cursor;
          return;
        }
        let since = stampMinus(state.cursor, this.timing.lagMs);
        // A delta past its ceiling reads on from where it stopped.
        for (let round = 0; round < 20; round += 1) {
          const res = await this.read(t.name, since);
          this.applyRows(t.name, res.rows as AnyRow[], "answer", started);
          this.forgetRows(t.name, res.deleted, started);
          state.cursor = newestOf(state.cursor, res.maxUpdatedAt);
          if (!res.truncated || !res.maxUpdatedAt) break;
          since = res.maxUpdatedAt;
        }
      }),
    );
    this.seedTagStore(started);
  }

  /**
   * Drop rows whose access was taken away: RLS hides them, so a delta never
   * reports them. Each checked table's live ids are compared with the copy;
   * what the server no longer returns leaves the device (and with a task, its
   * comment marks and completions). Runs after the first delta of a session
   * and then at most every `accessCheckMs`.
   */
  checkAccess = async (): Promise<void> => {
    const ids = this.runtime.tasks.syncIds;
    if (!ids || this.accessChecking || this.disposed) return;
    this.accessChecking = true;
    const started = Date.now();
    try {
      let dropped = false;
      for (const table of ACCESS_CHECKED) {
        const res = await ids({ workspaceId: this.workspaceId, table });
        if (!res.complete || this.disposed) continue;
        const keep = new Set(res.ids);
        const state = this.table(table);
        const gone = [...state.rows.keys()].filter(
          (id) => !keep.has(id) && (state.seenAt.get(id) ?? 0) < started,
        );
        // Shared with you since (a project's grant, a task's): no stamp moved,
        // so no delta brings them. Read them by id.
        const known = new Set(state.rows.keys());
        const added = res.ids.filter((id) => !known.has(id) && !state.goneAt.has(id));
        if (added.length > 0 && this.runtime.tasks.syncRead) {
          const got = await this.runtime.tasks.syncRead({
            workspaceId: this.workspaceId,
            table,
            since: null,
            ids: added,
          });
          if (got.rows.length > 0) {
            this.applyRows(table, got.rows as AnyRow[], "answer", started);
            dropped = true;
          }
        }
        if (gone.length === 0) continue;
        dropped = true;
        this.forgetRows(table, gone);
        if (table === "tasks") {
          const goneTasks = new Set(gone);
          for (const dependent of TASK_ROWS) {
            const rows = this.table(dependent).rows;
            const ofGone = [...rows.values()]
              .filter((r) => goneTasks.has((r as { taskId?: string }).taskId ?? ""))
              .map((r) => r.id);
            this.forgetRows(dependent, ofGone);
          }
        }
      }
      this.accessCheckedAt = started;
      if (dropped) {
        this.changed();
        // Leave no private row on the device a moment longer than needed.
        this.persistNow();
      }
    } catch {
      // Tried again after the next delta.
    } finally {
      this.accessChecking = false;
    }
  };

  /** Tags live in the workspace tag store (TV-T1): hand it every tag and link. */
  private seedTagStore(at: number): void {
    const links = this.table("tagLinks");
    seedTags(this.workspaceId, {
      tags: [...this.table("tags").rows.values()] as SyncRows["tags"][],
      links: [...links.rows.values()] as SyncRows["tagLinks"][],
      scope: { kind: "all" },
      at,
      complete: links.truncated === null,
    });
  }

  // ── Applying rows ─────────────────────────────────────────────────────────

  private table(name: SyncTableName): TableState {
    let state = this.tables.get(name);
    if (!state) {
      state = emptyTable();
      this.tables.set(name, state);
    }
    return state;
  }

  /**
   * Rows from a read or an op's answer: each lands unless the copy's row is
   * strictly newer ("answer"), or unless it isn't strictly newer ("live":
   * Realtime, where an equal stamp is our own echo). A soft-deleted row
   * removes it.
   */
  /**
   * `readStartedAt`: the rows come from a read that began then; a row removed
   * since (a delete it couldn't know about) stays removed.
   */
  private applyRows(
    name: SyncTableName,
    rows: readonly AnyRow[],
    rule: "answer" | "live",
    readStartedAt?: number,
  ): void {
    const state = this.table(name);
    const now = Date.now();
    let touched = false;
    for (const row of rows) {
      if (!row || typeof row.id !== "string") continue;
      if (readStartedAt !== undefined && (state.goneAt.get(row.id) ?? -1) >= readStartedAt)
        continue;
      const tomb = state.tombstones.get(row.id);
      if (tomb && row.updatedAt !== undefined && !isNewer(row.updatedAt, tomb.stamp)) continue;
      const local = state.rows.get(row.id);
      if (local && row.updatedAt !== undefined && local.updatedAt !== undefined) {
        const newer = isNewer(row.updatedAt, local.updatedAt);
        const older = isNewer(local.updatedAt, row.updatedAt);
        if (rule === "live" ? !newer : older) continue;
      }
      if (row.deletedAt) {
        if (state.rows.delete(row.id)) touched = true;
        state.seenAt.delete(row.id);
        state.goneAt.set(row.id, now);
        if (row.updatedAt) state.tombstones.set(row.id, { stamp: row.updatedAt, at: now });
        continue;
      }
      state.rows.set(row.id, row);
      state.seenAt.set(row.id, now);
      state.goneAt.delete(row.id);
      state.tombstones.delete(row.id);
      touched = true;
    }
    if (touched) this.renderedCache.delete(name);
  }

  /** A whole read: what it has lands; what it lacks goes, unless it arrived after the read began. */
  private applyWhole(
    name: SyncTableName,
    rows: readonly AnyRow[],
    startedAt: number,
    truncated: Truncation | null,
  ): void {
    const state = this.table(name);
    this.pruneGone(state);
    const fresh = rows.filter((r) => (state.goneAt.get(r.id) ?? -1) < startedAt);
    this.applyRows(name, fresh, "answer", startedAt);
    // A read cut at its ceiling can't tell absent from not-reached.
    if (!truncated) {
      const present = new Set(rows.map((r) => r.id));
      for (const id of [...state.rows.keys()]) {
        if (present.has(id)) continue;
        if ((state.seenAt.get(id) ?? 0) >= startedAt) continue;
        state.rows.delete(id);
        state.seenAt.delete(id);
      }
    }
    state.truncated = truncated;
    this.renderedCache.delete(name);
  }

  /**
   * Remove rows the server says are gone. `readStartedAt`: they come from a
   * read that began then, so a row applied since (restored meanwhile) stays.
   */
  private forgetRows(name: SyncTableName, ids: readonly string[], readStartedAt?: number): void {
    if (ids.length === 0) return;
    const state = this.table(name);
    const now = Date.now();
    for (const id of ids) {
      if (readStartedAt !== undefined && (state.seenAt.get(id) ?? 0) >= readStartedAt) continue;
      state.rows.delete(id);
      state.seenAt.delete(id);
      state.goneAt.set(id, now);
    }
    this.renderedCache.delete(name);
  }

  private pruneGone(state: TableState): void {
    const cutoff = Date.now() - this.timing.goneTtlMs;
    for (const [id, at] of state.goneAt) if (at < cutoff) state.goneAt.delete(id);
    for (const [id, tomb] of state.tombstones) if (tomb.at < cutoff) state.tombstones.delete(id);
  }

  private onLive = (event: TasksLiveEvent): void => {
    if (this.disposed) return;
    if (event.type === "resync") {
      this.requestSync(event.reason);
      return;
    }
    const { change } = event;
    // A delete carries only an id, from any workspace (ids are unique): one
    // from elsewhere matches nothing here.
    if (change.kind === "upsert") {
      const ws = (change.row as { workspaceId?: string }).workspaceId;
      if (ws !== undefined && ws !== this.workspaceId) return;
    }
    const name = LIVE_TO_TABLE[change.table];
    if (change.table === "tags" || change.table === "tag_links") {
      applyLiveTags(this.workspaceId, [change]);
    }
    if (change.kind === "delete") this.forgetRows(name, [change.id]);
    else this.applyRows(name, [change.row as AnyRow], "live");
    // An area shows while one of its projects does (TV-D10): a project
    // change can show or hide an area with no event of its own. Read again.
    if (name === "buckets") this.requestSync("reconnect");
    this.changed();
    this.schedulePersist();
  };

  // ── Writes ────────────────────────────────────────────────────────────────

  /** Show `changes` at once; settle or fail the returned write when the server answers. */
  begin(changes: OverlayChange[] = []): PendingWrite {
    const op = nextOp++;
    let open = true;
    const add = (more: OverlayChange[]) => {
      if (!open || more.length === 0) return;
      for (const c of more) {
        this.overlays.push({ op, ...c } as Overlay);
        this.renderedCache.delete(c.table);
      }
      this.changed();
    };
    add(changes);
    return {
      op,
      add,
      settle: (answers) => {
        if (!open) return;
        open = false;
        if (answers) this.applyAnswers(answers);
        this.dropOverlays(op);
        this.changed();
        this.schedulePersist();
      },
      fail: () => {
        if (!open) return;
        open = false;
        this.dropOverlays(op);
        this.changed();
      },
    };
  }

  /** Server rows that arrived outside an op (a status set, a roll-over). */
  answer(answers: Answers): void {
    this.applyAnswers(answers);
    this.changed();
    this.schedulePersist();
  }

  /**
   * Change fields of a row the copy holds, keeping its stamp: what an op's
   * answer told us without sending the row (a time total, a promoted
   * subtask). The server's next row for it still replaces it.
   */
  patchCopy(table: SyncTableName, id: string, fields: Record<string, unknown>): void {
    const state = this.table(table);
    const row = state.rows.get(id);
    if (!row) return;
    state.rows.set(id, { ...row, ...fields } as AnyRow);
    this.renderedCache.delete(table);
    this.changed();
    this.schedulePersist();
  }

  /** The server says these rows are gone (a deleted status, a queue row). */
  forget(table: SyncTableName, ids: readonly string[]): void {
    this.forgetRows(table, ids);
    this.changed();
    this.schedulePersist();
  }

  private applyAnswers(answers: Answers): void {
    for (const [name, rows] of Object.entries(answers) as unknown as [
      SyncTableName,
      readonly AnyRow[] | undefined,
    ][]) {
      if (rows && rows.length > 0) this.applyRows(name, rows, "answer");
    }
  }

  private dropOverlays(op: number): void {
    const before = this.overlays.length;
    const tables = new Set<SyncTableName>();
    this.overlays = this.overlays.filter((o) => {
      if (o.op !== op) return true;
      tables.add(o.table);
      return false;
    });
    if (this.overlays.length !== before) for (const t of tables) this.renderedCache.delete(t);
  }

  // ── My queue's line-up while queue ops are out ────────────────────────────

  /** Show my line-up as `rows` (op `seq`, the newest one). */
  setLineup(seq: number, rows: TaskQueueEntry[]): void {
    this.lineup = { seq, rows };
    this.renderedCache.delete("queue");
    this.changed();
  }

  /** A queue op's answer (my whole line-up, the server's): it becomes the copy;
   *  the shown line-up goes once the newest op has answered. */
  lineupAnswered(seq: number, mine: TaskQueueEntry[]): void {
    const state = this.table("queue");
    const now = Date.now();
    const kept = new Set(mine.map((e) => e.id));
    for (const [id, row] of state.rows) {
      const e = row as unknown as TaskQueueEntry;
      if (e.userId === this.userId && e.workspaceId === this.workspaceId) {
        state.rows.delete(id);
        state.seenAt.delete(id);
        // Left my queue: a read already on its way can't put it back.
        if (!kept.has(id)) state.goneAt.set(id, now);
      }
    }
    for (const e of mine) {
      state.rows.set(e.id, e as unknown as AnyRow);
      state.seenAt.set(e.id, now);
      state.goneAt.delete(e.id);
    }
    if (this.lineup && this.lineup.seq <= seq) this.lineup = null;
    this.renderedCache.delete("queue");
    this.changed();
    this.schedulePersist();
  }

  /** A queue op failed: the shown line-up goes if it was the newest's. */
  lineupFailed(seq: number): void {
    if (this.lineup && this.lineup.seq <= seq) this.lineup = null;
    this.renderedCache.delete("queue");
    this.changed();
  }

  /** Keep a done task of mine on show in my queue (until the next reload). */
  keep(entry: TaskQueueEntry): void {
    this.kept = [...this.kept.filter((e) => e.taskId !== entry.taskId), entry];
    this.changed();
  }

  unkeep(taskId: string): void {
    if (!this.kept.some((e) => e.taskId === taskId)) return;
    this.kept = this.kept.filter((e) => e.taskId !== taskId);
    this.changed();
  }

  // ── Offline ───────────────────────────────────────────────────────────────

  private setOffline(offline: boolean, opts: { quiet?: boolean } = {}): void {
    if (this.offline === offline) return;
    this.offline = offline;
    if (offline) this.scheduleRetry();
    else {
      this.retries = 0;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (!opts.quiet) this.changed();
    else this.snapshot = null;
  }

  /** Tries while offline: soon at first (a blip passes quickly), then less often. */
  private retries = 0;

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed) return;
    const wait = Math.min(this.timing.retryMs, 3_000 * 2 ** this.retries);
    this.retries += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.offline || this.disposed || this.refs <= 0) return;
      void this.sync("quiet").then(() => {
        if (this.offline) this.scheduleRetry();
      });
    }, wait);
  }

  /** Whether writes other than captures and check-offs must wait ("Offline"). */
  isOffline(): boolean {
    return this.offline;
  }

  /** A capture or a check-off for later: shown at once, kept with the device copy, sent in order. */
  enqueue(entry: OutboxEntry): void {
    this.outbox.push(entry);
    this.showOutboxEntry(entry);
    this.changed();
    this.persistNow();
    if (!this.offline) void this.flush();
  }

  /** The network looks gone: hold writes until it's back. */
  wentOffline(): void {
    this.setOffline(true);
  }

  /**
   * Create a task: shown at once (under its id, which may be a `tmp-` id the
   * views treat as "still saving"), sent under its own uuid so a resend is the
   * same task. Offline, or when the connection goes on the way, it waits in
   * the outbox instead (`queued`). A refusal throws (nothing stays shown).
   * `queue`: also line it up at the end of my queue once it exists (only the
   * outbox does it; online, the caller sends the queue op).
   */
  async sendCreate(
    task: Task,
    opts: { queue?: boolean } = {},
  ): Promise<{ saved: Task | null; queued: boolean }> {
    const tasks = this.runtime.tasks;
    const clientId = task.id.replace(/^tmp-/, "") || crypto.randomUUID();
    const queueIt = () => {
      this.enqueue({
        kind: "create",
        id: crypto.randomUUID(),
        task: { ...task, id: clientId },
        queue: opts.queue,
      });
      return { saved: null, queued: true };
    };
    if (this.offline) return queueIt();
    const write = this.begin([{ table: "tasks", insert: task as AnyRow }]);
    try {
      // A runtime with `createTask` creates under the client's id (idempotent);
      // the older path lets the server pick it.
      const saved = tasks.createTask
        ? await tasks.createTask({ ...task, id: clientId })
        : await tasks.upsertTask({ ...task, id: "" });
      write.settle({ tasks: [saved] });
      return { saved, queued: false };
    } catch (e) {
      write.fail();
      if (tasks.createTask && isNetworkError(e)) {
        this.wentOffline();
        return queueIt();
      }
      throw e;
    }
  }

  private showOutboxEntry(entry: OutboxEntry): void {
    const write = this.begin(
      entry.kind === "create"
        ? [{ table: "tasks", insert: entry.task as AnyRow }]
        : [{ table: "tasks", patch: { id: entry.taskId, fields: entry.fields } }],
    );
    this.outboxOps.set(entry.id, write.op);
  }

  /** Send what waits, in order, one at a time. */
  async flush(): Promise<void> {
    if (this.flushing || this.offline || this.disposed) return;
    this.flushing = true;
    try {
      while (this.outbox.length > 0 && !this.offline && !this.disposed) {
        const entry = this.outbox[0];
        try {
          const answers = await this.send(entry);
          this.outbox.shift();
          const op = this.outboxOps.get(entry.id);
          this.outboxOps.delete(entry.id);
          this.applyAnswers(answers);
          if (op !== undefined) this.dropOverlays(op);
          this.persistNow();
          this.changed();
        } catch (e) {
          if (isNetworkError(e)) {
            this.setOffline(true);
            break;
          }
          // Refused: it won't go through later either. Say so, drop it, and
          // show what the server holds.
          this.outbox.shift();
          const op = this.outboxOps.get(entry.id);
          this.outboxOps.delete(entry.id);
          if (op !== undefined) this.dropOverlays(op);
          this.persistNow();
          this.changed();
          const what = entry.kind === "create" ? `“${entry.task.title || "Untitled"}”` : "a change";
          toast.error(`Couldn't sync ${what}`, {
            description: e instanceof Error ? e.message : undefined,
          });
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async send(entry: OutboxEntry): Promise<Answers> {
    const tasks = this.runtime.tasks;
    if (entry.kind === "create") {
      const saved = tasks.createTask
        ? await tasks.createTask(entry.task)
        : await tasks.upsertTask(entry.task);
      let queue: TaskQueueEntry[] = [];
      if (entry.queue) {
        // A lost connection keeps the entry (sent again: the create is the same
        // task, the add a no-op); a refused add leaves the task unqueued.
        queue = await tasks
          .opQueueAdd({ workspaceId: this.workspaceId, taskId: saved.id })
          .catch((e) => {
            if (isNetworkError(e)) throw e;
            return [];
          });
        if (queue.length > 0) this.lineupAnswered(0, queue);
      }
      return { tasks: [saved] };
    }
    const saved = await tasks.opSetStatus({
      workspaceId: this.workspaceId,
      taskId: entry.taskId,
      status: entry.status,
      recurrence: entry.recurrence ?? undefined,
    });
    return { tasks: [saved] };
  }

  // ── The snapshot ──────────────────────────────────────────────────────────

  private changed(): void {
    this.snapshot = null;
    for (const fn of this.listeners) fn();
  }

  private rendered<T extends SyncTableName>(name: T): SyncRows[T][] {
    const hit = this.renderedCache.get(name);
    if (hit) return hit as unknown as SyncRows[T][];
    const state = this.table(name);
    const own = this.overlays.filter((o) => o.table === name);
    let list: AnyRow[];
    if (own.length === 0) {
      list = [...state.rows.values()];
    } else {
      const map = new Map(state.rows);
      for (const o of own) {
        if ("insert" in o) map.set(o.insert.id, o.insert);
        else if ("remove" in o) map.delete(o.remove);
        else {
          const row = map.get(o.patch.id);
          if (row) map.set(o.patch.id, { ...row, ...o.patch.fields } as AnyRow);
        }
      }
      list = [...map.values()];
    }
    this.renderedCache.set(name, list);
    return list as unknown as SyncRows[T][];
  }

  private queueView: {
    raw: readonly TaskQueueEntry[];
    lineup: StoreLineup;
    rows: TaskQueueEntry[];
  } | null = null;

  private queueRows(): TaskQueueEntry[] {
    const raw = this.rendered("queue");
    const view = this.queueView;
    if (view && view.raw === raw && view.lineup === this.lineup) return view.rows;
    let rows = raw.filter((e) => e.workspaceId === this.workspaceId);
    if (this.lineup) {
      rows = [
        ...rows.filter((e) => e.userId !== this.userId),
        ...this.lineup.rows.filter((e) => e.workspaceId === this.workspaceId),
      ];
    }
    const sorted = sortQueueEntries(rows);
    this.queueView = { raw, lineup: this.lineup, rows: sorted };
    return sorted;
  }

  private buildSnapshot(): StoreSnapshot {
    const prev = this.lastSnapshot;
    const tasks = this.rendered("tasks");
    const buckets = this.rendered("buckets");
    const tags = this.rendered("tags");
    const tagLinks = this.rendered("tagLinks");
    const relations = this.rendered("relations");
    const statuses = this.rendered("statuses");
    const areas = this.rendered("areas");
    const sections = this.rendered("sections");
    const teams = this.rendered("teams");
    const teamMembers = this.rendered("teamMembers");
    const truncated: Truncation[] = [];
    for (const t of SYNC_TABLES) {
      const cut = this.table(t.name).truncated;
      if (cut) truncated.push(cut);
    }
    const sameBundle =
      prev &&
      prev.bundle.tasks === tasks &&
      prev.bundle.buckets === buckets &&
      prev.bundle.tags === tags &&
      prev.bundle.tagLinks === tagLinks &&
      prev.bundle.taskRelations === relations &&
      prev.bundle.statuses === statuses &&
      prev.bundle.areas === areas &&
      prev.bundle.sections === sections &&
      prev.bundle.teams === teams &&
      prev.bundle.teamMembers === teamMembers &&
      sameTruncations(prev.bundle.truncated, truncated);
    const bundle: TasksModuleBundle = sameBundle
      ? prev.bundle
      : {
          tasks,
          buckets,
          tags,
          tagLinks,
          taskRelations: relations,
          statuses,
          areas,
          sections,
          teams,
          teamMembers,
          truncated,
        };
    const comments = this.rendered("comments");
    const commentCounts =
      prev && prev.commentsSource === comments
        ? prev.snapshot.commentCounts
        : countComments(comments);
    const queue = this.queueRows();
    const snapshot: StoreSnapshot = {
      workspaceId: this.workspaceId,
      userId: this.userId,
      loaded: this.loaded,
      error: this.error,
      fromCache: this.fromCache,
      restLoaded: this.restLoaded,
      offline: this.offline,
      pending: this.outbox.length,
      loadStamp: this.loadStamp,
      bundle,
      queue: prev && sameList(prev.snapshot.queue, queue) ? prev.snapshot.queue : queue,
      kept: this.kept,
      completions: this.rendered("completions"),
      commentCounts,
      sessions: this.rendered("sessions"),
      reminders: this.rendered("reminders"),
      waiting: this.rendered("waiting"),
    };
    this.lastSnapshot = { snapshot, bundle, commentsSource: comments };
    return snapshot;
  }

  private lastSnapshot: {
    snapshot: StoreSnapshot;
    bundle: TasksModuleBundle;
    commentsSource: readonly SyncRows["comments"][];
  } | null = null;
}

function countComments(comments: readonly SyncRows["comments"][]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const c of comments) {
    if (c.deletedAt) continue;
    counts.set(c.taskId, (counts.get(c.taskId) ?? 0) + 1);
  }
  return counts;
}

function sameTruncations(a: readonly Truncation[], b: readonly Truncation[]): boolean {
  return (
    a.length === b.length &&
    a.every((t, i) => t.scope === b[i]?.scope && t.shown === b[i]?.shown && t.total === b[i]?.total)
  );
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** The newer of two server stamps (either may be missing). */
function newestOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return isNewer(b, a) ? b : a;
}

// ── One store per person and workspace ──────────────────────────────────────

const registries = new WeakMap<object, Map<string, WorkspaceStore>>();
const everyStore = new Set<WorkspaceStore>();
let storeOptions: StoreOptions = {};

/** Tests: the options every new store gets (a memory cache, short timings). */
export function setStoreOptionsForTests(opts: StoreOptions): void {
  storeOptions = opts;
}

/**
 * The store for a workspace, made on first use. Keyed by the runtime (each
 * test's fake runtime gets its own) and the workspace; a store made for
 * another person is thrown away.
 */
export function workspaceStore(
  runtime: ModuoRuntime,
  userId: string,
  workspaceId: string,
): WorkspaceStore {
  let byWorkspace = registries.get(runtime.tasks);
  if (!byWorkspace) {
    byWorkspace = new Map();
    registries.set(runtime.tasks, byWorkspace);
  }
  let store = byWorkspace.get(workspaceId);
  if (store && store.userId !== userId) {
    store.dispose({ persist: false });
    everyStore.delete(store);
    store = undefined;
  }
  if (!store) {
    store = new WorkspaceStore(runtime, userId, workspaceId, storeOptions);
    byWorkspace.set(workspaceId, store);
    everyStore.add(store);
  }
  return store;
}

/** The workspace's store if one is running (capture, the bell); null otherwise. */
export function findWorkspaceStore(
  runtime: ModuoRuntime,
  workspaceId: string,
): WorkspaceStore | null {
  return registries.get(runtime.tasks)?.get(workspaceId) ?? null;
}

function disposeStores(keep: (store: WorkspaceStore) => boolean, persist: boolean): void {
  for (const store of [...everyStore]) {
    if (keep(store)) continue;
    store.dispose({ persist });
    if (registries.get(store.runtime.tasks)?.get(store.workspaceId) === store) {
      registries.get(store.runtime.tasks)?.delete(store.workspaceId);
    }
    everyStore.delete(store);
  }
}

/**
 * Who is signed in now (the auth shell calls this on every change).
 *  - Someone: stores and device copies of anyone else go, so a second
 *    account on this device never reads the first one's rows.
 *  - Nobody (null): the stores stop, but the copy stays. A session can be
 *    null without a sign-out (an expired token that couldn't refresh offline);
 *    its waiting captures must survive until it's back. A real sign-out calls
 *    `wipeSyncCopies`.
 */
export function attachSyncUser(userId: string | null): Promise<void> {
  if (userId === null) {
    disposeStores(() => false, true);
    return Promise.resolve();
  }
  disposeStores((store) => store.userId === userId, false);
  return (storeOptions.cache ?? deviceCache()).deleteWhere((key) => !isKeyOf(key, userId));
}

/** Signed out, or the account was deleted: every store and every device copy go. */
export function wipeSyncCopies(): Promise<void> {
  disposeStores(() => false, false);
  return (storeOptions.cache ?? deviceCache()).clear();
}

/**
 * The person's workspace list came back: device copies of workspaces not on
 * it (left, removed, deleted) go, and so do their stores.
 */
export function keepWorkspaceCopies(
  userId: string,
  workspaceIds: readonly string[],
): Promise<void> {
  const keep = new Set(workspaceIds.map((ws) => cacheKey(userId, ws)));
  disposeStores(
    (store) => store.userId !== userId || keep.has(cacheKey(store.userId, store.workspaceId)),
    false,
  );
  return (storeOptions.cache ?? deviceCache()).deleteWhere(
    (key) => isKeyOf(key, userId) && !keep.has(key),
  );
}
