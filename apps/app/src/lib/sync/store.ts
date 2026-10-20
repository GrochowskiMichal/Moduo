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
//     soft-deleted rows included. The queue, tag links and relations delete
//     hard: since TV-D11b they're stamped and leave tombstones, so they delta
//     too (a database without that migration answers whole).
//   - **Realtime on top** (TV-D5's channel): a row lands only if it is newer
//     by the server's stamp. A reconnect or a return to the window reads the
//     changes again: Realtime is a latency layer, never the source of truth.
//   - **Rows you can no longer see** never show up in a delta, so once per
//     session the store checks which ids are still yours and drops the rest.
//   - **The grant feed** (TV-D11b, `access_changes`) says when that may have
//     changed (a project or a task shared or unshared, a task moved, a role
//     changed): a task is checked by id at once, anything wider runs the
//     whole check. Live through Realtime, and read with every delta.
//   - **Search** (TV-D11b): the views search the copy; while the copy can't
//     answer alone (closed tasks still loading, a read cut at its ceiling)
//     the server's `tasks_search` finds the rest and the store reads them in.
//
// Writes are ops laid over the rows the server sent (`begin`). Each op has an
// id; an op's fields stay on top until its answer comes back, then the answer
// becomes the row. A Realtime echo of your own write is a server row like any
// other: it lands only if strictly newer by the server's stamp (an equal stamp
// changes nothing), and it lands under the op's fields, so the field never
// flicks back. If the server refuses, only that op's fields go away: one field
// rolls back to what the server holds, nothing reloads.
//
// The pieces are the sync kernel's (`kernel/`): one `SyncedCollection` per
// table (landing, delete marks, overlays, the delta), one FIFO outbox, the
// registry and the person lifecycle.
//
// Offline (default g): everything reads from the device copy; captures and
// check-offs wait in an outbox kept with the copy ("2 waiting to sync") and
// are sent in order when the network is back, each under its own id, so a
// resend never makes a second task. Other edits say "Offline" (the hook).

import { toast } from "sonner";
import type { AgentSession } from "../../features/spine/agent-session";
import { applyLiveTags, seedTags } from "../../features/tags/store";
import type { LiveChange } from "../../features/tasks/live";
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
import type { TaskView } from "../../features/tasks/view-row";
import { splitArchived } from "../bucket-rows";
import { TAG_LINKS_SCOPE, type Truncation } from "../paged-select";
import type { ModuoRuntime } from "../runtime.types";
import { sortQueueEntries } from "../task-rows";
import {
  CACHE_VERSION,
  type CachedWorkspace,
  cacheKey,
  deviceCache,
  type SyncCache,
} from "./cache";
import { createSyncedCollection, type SyncedCollection } from "./kernel/collection";
import { Backoff, drainOutbox, Outbox } from "./kernel/outbox";
import { openWrite } from "./kernel/overlay";
import {
  type OwnedCopies,
  personLifecycle,
  refcount,
  StoreRegistry,
  waitingEverywhere,
} from "./kernel/registry";
import { isNewer, newestOf, stampMinus } from "./kernel/stamps";
import { browserOffline, isNetworkError } from "./network";
import type { AccessChange, SyncReadResult, SyncRows, SyncTableName } from "./types";

// ── Shapes ──────────────────────────────────────────────────────────────────

type AnyRow = { id: string; updatedAt?: string; deletedAt?: string | null };

/** Server rows for some tables (an op's answer, or a read). */
export type Answers = { [T in SyncTableName]?: readonly SyncRows[T][] };

/** One change an op shows before the server has it. */
export type OverlayChange =
  | { table: SyncTableName; patch: { id: string; fields: Record<string, unknown> } }
  | { table: SyncTableName; insert: AnyRow }
  | { table: SyncTableName; remove: string };

/** The bundle's projects and tasks, with archived ones set apart (TV-U6). */
type ArchivedSplit = {
  buckets: SyncRows["buckets"][];
  tasks: SyncRows["tasks"][];
  archivedBuckets: SyncRows["buckets"][];
  archivedTasks: SyncRows["tasks"][];
};

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
  /** A later read failed (not the network): what's shown may be out of date. */
  syncError: string | null;
  /** Showing the device copy; the server hasn't answered yet this session. */
  fromCache: boolean;
  /** Done, Won't do and Backlog tasks have been read too. */
  restLoaded: boolean;
  offline: boolean;
  /** Captures and check-offs waiting to be sent. */
  pending: number;
  /** The tasks those are for (a List row shows a clock on them). */
  pendingTaskIds: ReadonlySet<string>;
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
  /** Per task, a stamp that moves whenever one of its comments is added,
   *  edited, deleted or reacted to (TV-U13): an open thread re-reads on it. */
  commentStamps: ReadonlyMap<string, string>;
  /** Finished files per task (AT-3's 📎 counts). */
  attachmentCounts: ReadonlyMap<string, number>;
  /** Per task, a stamp that moves whenever one of its files is added,
   *  deleted or restored (AT-3): an open strip re-reads on it. */
  attachmentStamps: ReadonlyMap<string, string>;
  /** TV-D10: work sessions on tasks you can see, your own reminders, Waiting on… entries. */
  sessions: TaskSession[];
  reminders: TaskReminder[];
  waiting: TaskWaitingEntry[];
  /** TV-U8: your saved views and the ones shared with you. */
  views: TaskView[];
  /** TV-D16: agent sessions you can see (yours; teammates' while they share). */
  agentSessions: AgentSession[];
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
  syncError: null,
  fromCache: false,
  restLoaded: false,
  offline: false,
  pending: 0,
  pendingTaskIds: new Set<string>(),
  loadStamp: 0,
  bundle: EMPTY_BUNDLE,
  queue: [],
  kept: [],
  completions: [],
  commentCounts: new Map(),
  commentStamps: new Map(),
  attachmentCounts: new Map(),
  attachmentStamps: new Map(),
  sessions: [],
  reminders: [],
  waiting: [],
  views: [],
  agentSessions: [],
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
  // shows because one of its projects does: TV-D10's `areas__visible`). A
  // change in the projects you see runs the access check at once, which
  // brings (or drops) the delta tables' rows of those projects.
  { name: "buckets", delta: false, phase: 1 },
  { name: "areas", delta: false, phase: 1 },
  { name: "teams", delta: false, phase: 1 },
  { name: "teamMembers", delta: false, phase: 1 },
  // TV-U8: who may read a shared view moves with project sharing and
  // membership, which bump no stamp; small, so read whole.
  { name: "views", delta: false, phase: 1 },
  // Hard deletes: stamped and tombstoned since TV-D11b's migration, so they
  // delta too; a database without it answers whole (`whole`).
  { name: "queue", delta: true, phase: 1 },
  { name: "tagLinks", delta: true, phase: 1 },
  { name: "relations", delta: true, phase: 1 },
  // Deltas; the access check covers what sharing shows or hides.
  { name: "statuses", delta: true, phase: 1 },
  { name: "sections", delta: true, phase: 1 },
  { name: "tasks", delta: true, phase: 1 },
  { name: "tags", delta: true, phase: 1 },
  { name: "completions", delta: true, phase: 2 },
  { name: "comments", delta: true, phase: 2 },
  { name: "sessions", delta: true, phase: 2 },
  { name: "reminders", delta: true, phase: 2 },
  { name: "waiting", delta: true, phase: 2 },
  // TV-D16: the access check drops a session its person stops sharing.
  { name: "agentSessions", delta: true, phase: 2 },
  // AT-3: finished files (marks only), for the 📎 counts.
  { name: "attachments", delta: true, phase: 2 },
];

/**
 * Tables whose live ids are checked against the server now and then: a row
 * you lost access to (a project made private, you left it) is hidden by RLS
 * and never shows up in a delta, so this is how it leaves the device copy.
 * The whole-read tables (projects, areas, teams, members) drop such rows on
 * every read already.
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
  "agentSessions",
  "attachments",
];

/** One synced table: its rows, delete marks, overlays and delta cursor (kernel). */
type Table = SyncedCollection<AnyRow>;

/** A delta past its ceiling reads on from where it stopped, at most this many times. */
const DELTA_ROUNDS = 20;

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
  agent_sessions: "agentSessions",
  task_completions: "completions",
  attachments: "attachments",
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
  /** Grant feed changes that arrive together are handled once, after this. */
  accessDebounceMs: number;
};

export const DEFAULT_TIMING: StoreTiming = {
  lagMs: 5 * 60_000,
  throttleMs: 5_000,
  persistMs: 800,
  retryMs: 20_000,
  goneTtlMs: 60_000,
  accessCheckMs: 10 * 60_000,
  fullReadMs: 24 * 60 * 60_000,
  accessDebounceMs: 400,
};

/** A server stamp moved back by `ms` (lives with `timestampMicros`). */
export { stampMinus };

/** The grant feed's start when it was empty at the session's first read. */
const EPOCH = "1970-01-01T00:00:00+00:00";

/** How many ids one server search answers with. */
const SEARCH_LIMIT = 200;

// ── The store ───────────────────────────────────────────────────────────────

export type StoreOptions = {
  cache?: SyncCache;
  timing?: Partial<StoreTiming>;
  /** Realtime (TV-D5); tests pass a fake. */
  listen?: typeof listenTasksLive;
};

/** What a surface that wrote around the store dispatches (Home's widgets). */
const DATA_REFRESH_EVENT = "moduo:data-refresh";

type StoreLineup = { seq: number; rows: TaskQueueEntry[] } | null;

export class WorkspaceStore {
  readonly runtime: ModuoRuntime;
  readonly userId: string;
  readonly workspaceId: string;
  private readonly cache: SyncCache;
  private readonly timing: StoreTiming;
  private readonly listen: typeof listenTasksLive;

  private tables = new Map<SyncTableName, Table>();
  /** My line-up while queue ops are on their way (the newest op's view). */
  private lineup: StoreLineup = null;
  private kept: TaskQueueEntry[] = [];
  /** Captures and check-offs, sent in order; a refusal leaves (kernel `Outbox`). */
  private outbox = new Outbox<OutboxEntry>("fifo-drop-on-refusal");
  /** Overlay op per outbox entry (rebuilt from the copy). */
  private outboxOps = new Map<string, number>();

  private loaded = false;
  private error: string | null = null;
  private syncError: string | null = null;
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
  /** A check was asked for while one ran: run again once it's done. */
  private accessAgain = false;
  /** The grant feed's cursor (null: not read this session; "" read, empty). */
  private accessCursor: string | null = null;
  /** Feed rows already handled (a read re-reads its lookback), with their stamps. */
  private accessSeen = new Map<string, string>();
  /** What the feed asked for, handled together (`accessDebounceMs`). */
  private accessQueue: { full: boolean; tasks: Set<string> } = { full: false, tasks: new Set() };
  private accessTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrated: Promise<void> | null = null;

  private readonly holds = refcount(
    () => this.start(),
    () => this.stop(),
  );
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
  private loadWaiters: (() => void)[] = [];

  constructor(runtime: ModuoRuntime, userId: string, workspaceId: string, opts: StoreOptions = {}) {
    this.runtime = runtime;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.cache = opts.cache ?? deviceCache();
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.listen = opts.listen ?? listenTasksLive;
    this.backoff = new Backoff(3_000, this.timing.retryMs);
    for (const t of SYNC_TABLES) this.tables.set(t.name, this.makeTable(t.name));
  }

  private makeTable(name: SyncTableName): Table {
    return createSyncedCollection<AnyRow>({
      name,
      read: (since) => this.read(name, since),
      lagMs: this.timing.lagMs,
      maxPages: DELTA_ROUNDS,
      goneTtlMs: this.timing.goneTtlMs,
    });
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

  /** What waits to sync, in order (a sign-out keeps it on the device). */
  waitingEntries(): OutboxEntry[] {
    return this.outbox.list();
  }

  /** Whether a capture is waiting in the outbox under this task id. */
  isQueuedCreate(taskId: string): boolean {
    return this.outbox.some((e) => e.kind === "create" && e.task.id === taskId);
  }

  /**
   * Whether anything for this task still waits in the outbox, including the
   * entry a flush is sending right now. A later write for it must queue behind
   * those: sent live, it would land first and the older queued one would win.
   */
  hasOutboxEntries(taskId: string): boolean {
    return this.outbox.some((e) => (e.kind === "create" ? e.task.id : e.taskId) === taskId);
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
    return this.holds.acquire();
  }

  private start(): void {
    if (this.disposed) return;
    this.stopLive = this.listen(this.workspaceId, this.userId, this.onLive);
    if (typeof window !== "undefined") {
      window.addEventListener("offline", this.onBrowserOffline);
      window.addEventListener("pagehide", this.persistNow);
      window.addEventListener(DATA_REFRESH_EVENT, this.onDataRefresh);
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
      window.removeEventListener(DATA_REFRESH_EVENT, this.onDataRefresh);
    }
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.accessTimer) clearTimeout(this.accessTimer);
    this.syncTimer = null;
    this.retryTimer = null;
    this.accessTimer = null;
    if (opts.persist !== false) this.persistNow();
  }

  /**
   * Stop for good (sign-out, another person): nothing is written after this.
   * `persist: false` drops what wasn't written yet (the copy is being wiped).
   */
  dispose(opts: { persist?: boolean } = {}): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (opts.persist === false) this.wiped = true;
    this.stop(opts);
    this.disposed = true;
    this.listeners.clear();
    this.tables.clear();
    this.outbox.clear();
    this.lineup = null;
    this.kept = [];
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

  /** A surface wrote around the store (Home's roll-forward) and says so: read what changed. */
  private onDataRefresh = () => this.requestSync("reconnect");

  // ── The device copy ───────────────────────────────────────────────────────

  private async hydrate(): Promise<void> {
    const copy = await this.cache.read(cacheKey(this.userId, this.workspaceId));
    if (!copy || this.disposed) return;
    if (copy.v !== CACHE_VERSION) {
      // An older build's copy: its rows may lack fields this build reads, so
      // they're read again; what waited to sync still goes.
      this.adoptOutbox(copy.outbox);
      return;
    }
    for (const t of SYNC_TABLES) {
      const cached = copy.tables[t.name];
      // A live change that landed first is newer than the copy: it stays.
      if (cached) this.table(t.name).restore(cached);
    }
    this.restLoaded = copy.restLoaded;
    this.fullReadAt = copy.fullReadAt ?? 0;
    for (const entry of this.outbox.adopt(copy.outbox)) this.showOutboxEntry(entry);
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
    const key = cacheKey(this.userId, this.workspaceId);
    // What to write is taken now (a dispose right after must not empty it).
    const tables: CachedWorkspace["tables"] = {};
    for (const [name, table] of this.tables) tables[name] = table.toCopy();
    const outbox = this.outbox.list();
    const restLoaded = this.restLoaded;
    const fullReadAt = this.fullReadAt;
    // Writes go one after another; each keeps the outbox another tab left in
    // the copy (read and written in one step, so neither tab drops the other's
    // captures) and takes it on.
    let theirs: OutboxEntry[] = [];
    this.persisting = this.persisting.then(async () => {
      if (this.wiped) return;
      await this.cache.update(key, (stored) => {
        theirs = this.outbox.othersWaiting(stored?.outbox, outbox);
        return {
          v: CACHE_VERSION,
          savedAt: Date.now(),
          tables,
          restLoaded,
          fullReadAt,
          outbox: [...outbox, ...theirs],
        };
      });
      if (!this.disposed && theirs.length > 0) this.adoptOutbox(theirs);
    });
  };

  /** Resolves once every write of the device copy asked for so far has landed. */
  whenPersisted(): Promise<void> {
    return this.persisting;
  }

  /** The device copy is being wiped (sign-out, another person): write nothing more. */
  private wiped = false;

  private persisting: Promise<void> = Promise.resolve();
  /** Take on what another tab left waiting (sent again safely: same ids). */
  private adoptOutbox(entries: unknown): void {
    const joined = this.outbox.adopt(entries);
    for (const entry of joined) this.showOutboxEntry(entry);
    if (joined.length > 0) {
      this.changed();
      if (!this.offline) void this.flush();
    }
  }

  // ── Reading the server ────────────────────────────────────────────────────

  /**
   * Ask the server. "return" (back to the window) reads at most once per
   * throttle; "reconnect" (the socket rejoined, the network came back, a
   * quiet re-read after an op) reads once now and once more at the end of the
   * throttle window. A read already running is followed by one more.
   */
  requestSync = (reason: "return" | "reconnect" = "reconnect"): void => {
    if (this.disposed || !this.holds.held()) return;
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
        if (this.disposed || (!this.holds.held() && next !== "reload")) return;
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
    // The device copy goes in first: a read that lands before it would be
    // overwritten by an older copy's flags.
    this.hydrated ??= this.hydrate();
    await this.hydrated;
    if (this.disposed) return;
    const startedAt = Date.now();
    const delta =
      !!this.runtime.tasks.syncRead &&
      this.table("tasks").cursor !== null &&
      this.restLoaded &&
      startedAt - this.fullReadAt < this.timing.fullReadMs;
    try {
      // The grant feed's starting point is taken before the tables are read,
      // so a change made while they load is still seen by the next read.
      const feed = this.accessCursor === null ? this.readAccessFeed() : null;
      if (!this.runtime.tasks.syncRead) await this.readBundle();
      else if (!delta) await this.readFirst();
      else await this.readChanges();
      await (feed ?? this.readAccessFeed());
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
    this.syncError = null;
    this.setOffline(false, { quiet: true });
    if (first) void this.ensureInbox();
    if (first || kind === "reload") {
      this.loadStamp += 1;
      if (kind === "reload") this.kept = [];
    }
    this.markLoaded();
    this.changed();
    this.schedulePersist();
    void this.flush();
    // A first load (or a whole read) checked everything; after deltas, check
    // now and then what's still yours, and at once when the projects you can
    // see changed (one shared with you or taken away: no stamp moves).
    const projectsChanged = this.projectsChanged;
    this.projectsChanged = false;
    if (!delta) this.accessCheckedAt = startedAt;
    else if (projectsChanged || Date.now() - this.accessCheckedAt >= this.timing.accessCheckMs) {
      void this.checkAccess();
    }
  }

  /** The last whole read of projects added or dropped one. */
  private projectsChanged = false;

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
    // A failed first load with nothing to show is an error. A later read that
    // fails keeps what's shown (and what the other tables already read), but
    // says the copy isn't up to date and tries again (a refused session, an
    // ended trial: never yesterday's copy passed off as live).
    const message = e instanceof Error ? e.message : String(e);
    if (!this.loaded) {
      this.error = message;
      this.markLoaded();
    } else {
      this.syncError = message;
      this.scheduleRetry();
    }
    this.changed();
    this.schedulePersist();
  }

  /**
   * Your Inbox exists once Tasks has been opened (the old full read made it;
   * a new member's or a new workspace's first open has none). Best effort: a
   * view-only member can't make one.
   */
  private async ensureInbox(): Promise<void> {
    if (!this.runtime.tasks.syncRead || typeof this.runtime.tasks.seedInbox !== "function") return;
    const mine = [...this.table("buckets").rows.values()].some(
      (b) =>
        (b as { isSystem?: boolean; ownerId?: string }).isSystem &&
        (b as { ownerId?: string }).ownerId === this.userId,
    );
    if (mine) return;
    try {
      const inbox = await this.runtime.tasks.seedInbox(this.workspaceId);
      if (!this.disposed) this.answer({ buckets: [inbox] });
    } catch {
      // Read-only access, or offline: the next session tries again.
    }
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
    // Only the rest of the tasks has to arrive: a counts or history table that
    // fails (not the network) is read again by the next delta, from scratch,
    // and never holds the store in first-load mode.
    const [rest, ...later] = await Promise.all([
      this.read("tasks", null, "rest"),
      ...phase2.map((t) =>
        this.read(t.name, null).then(
          (res) => [t.name, res] as const,
          (e) => {
            if (isNetworkError(e)) throw e;
            return null;
          },
        ),
      ),
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
    for (const read of later) {
      if (!read) continue;
      const [name, res] = read;
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
          const before = t.name === "buckets" ? new Set(this.table("buckets").rows.keys()) : null;
          this.applyWhole(t.name, res.rows as AnyRow[], started, res.truncated);
          if (before) {
            const after = this.table("buckets").rows;
            if (after.size !== before.size || [...after.keys()].some((id) => !before.has(id))) {
              this.projectsChanged = true;
            }
          }
          return;
        }
        // Changes since the cursor, from the lookback; a delta past its
        // ceiling reads on from where it stopped. A database that can't read
        // the table's changes (no stamps or tombstones yet) answers whole.
        await this.table(t.name).readChanges(started);
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
    if (!ids || this.disposed) return;
    if (this.accessChecking) {
      // A change arrived while a check ran (which may have read past it).
      this.accessAgain = true;
      return;
    }
    this.accessChecking = true;
    const started = Date.now();
    try {
      let dropped = false;
      for (const table of ACCESS_CHECKED) {
        const res = await ids({ workspaceId: this.workspaceId, table });
        if (!res.complete || this.disposed) continue;
        const keep = new Set(res.ids);
        const { landed } = this.table(table);
        const gone = [...landed.rows.keys()].filter(
          (id) => !keep.has(id) && (landed.seenAt.get(id) ?? 0) < started,
        );
        // Shared with you since (a project's grant, a task's): no stamp moved,
        // so no delta brings them. Read them by id.
        const known = new Set(landed.rows.keys());
        const added = res.ids.filter((id) => !known.has(id) && !landed.goneAt.has(id));
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
        this.dropRows(table, gone);
      }
      this.accessCheckedAt = started;
      if (dropped) {
        this.seedTagStore(started);
        this.changed();
        // Leave no private row on the device a moment longer than needed.
        this.persistNow();
      }
    } catch {
      // Tried again after the next delta.
    } finally {
      this.accessChecking = false;
      if (this.accessAgain && !this.disposed) {
        this.accessAgain = false;
        void this.checkAccess();
      }
    }
  };

  /** Forget rows you can no longer see; a task takes its own rows with it. */
  private dropRows(table: SyncTableName, ids: readonly string[]): void {
    this.forgetRows(table, ids);
    if (table !== "tasks") return;
    const goneTasks = new Set(ids);
    for (const dependent of TASK_ROWS) {
      const rows = this.table(dependent).rows;
      const ofGone = [...rows.values()]
        .filter((r) => goneTasks.has((r as { taskId?: string }).taskId ?? ""))
        .map((r) => r.id);
      this.forgetRows(dependent, ofGone);
    }
  }

  // ── The grant feed (TV-D11b) ──────────────────────────────────────────────

  /**
   * Read what changed in who sees what since the feed's cursor. The first
   * read of a session only takes the cursor: the session's first access
   * check covers everything before it.
   */
  private async readAccessFeed(): Promise<void> {
    const feed = this.runtime.tasks.syncAccessChanges;
    if (!feed || this.disposed) return;
    const first = this.accessCursor === null;
    const since = first
      ? null
      : this.accessCursor === ""
        ? EPOCH
        : stampMinus(this.accessCursor as string, this.timing.lagMs);
    let res: Awaited<ReturnType<typeof feed>>;
    try {
      res = await feed({ workspaceId: this.workspaceId, since });
    } catch {
      // Read again with the next delta (the tables' reads report a lost
      // network themselves; this one never fails a sync).
      return;
    }
    if (!res.supported || this.disposed) return;
    if (first) this.accessStart = res.maxChangedAt;
    this.accessCursor = newestOf(this.accessCursor || null, res.maxChangedAt) ?? "";
    if (first) return;
    // What the lookback re-reads from before the session began is the
    // session's first access check's (it ran after it).
    const start = this.accessStart;
    this.noteAccessChanges(
      start ? res.changes.filter((c) => isNewer(c.changedAt, start)) : res.changes,
    );
  }

  /** The feed's newest stamp when the session began (null: it was empty). */
  private accessStart: string | null = null;

  /** Changes from the feed (a read, or Realtime): handled together, once each. */
  private noteAccessChanges(changes: readonly AccessChange[]): void {
    // A row is remembered while a read can still bring it back: while its
    // stamp is inside the lookback before the cursor (a quiet feed keeps its
    // cursor, so its last rows are read again on every sync).
    const floor = this.accessCursor ? stampMinus(this.accessCursor, this.timing.lagMs) : null;
    if (floor) {
      for (const [key, stamp] of this.accessSeen) {
        if (isNewer(floor, stamp)) this.accessSeen.delete(key);
      }
    }
    for (const c of changes) {
      const key = c.id ?? `${c.resourceType}:${c.resourceId}:${c.changedAt}`;
      if (this.accessSeen.has(key)) continue;
      this.accessSeen.set(key, c.changedAt);
      if (c.resourceType === "task") this.accessQueue.tasks.add(c.resourceId);
      else this.accessQueue.full = true;
    }
    const queued = this.accessQueue.full || this.accessQueue.tasks.size > 0;
    if (!queued || this.accessTimer || this.disposed) return;
    this.accessTimer = setTimeout(() => {
      this.accessTimer = null;
      void this.applyAccessQueue();
    }, this.timing.accessDebounceMs);
  }

  private async applyAccessQueue(): Promise<void> {
    if (this.disposed) return;
    const { full, tasks } = this.accessQueue;
    this.accessQueue = { full: false, tasks: new Set() };
    // The whole check reads every table's ids, the tasks' included.
    if (full) await this.checkAccess();
    else if (tasks.size > 0) await this.recheckTasks([...tasks]);
  }

  /**
   * Tasks the feed named (shared with you, unshared, moved): read them by id.
   * One you can see lands; one you held and can't see any more leaves with
   * its own rows. A task new to you brings its comments, completions and
   * sessions through the whole check.
   */
  private async recheckTasks(ids: readonly string[]): Promise<void> {
    const read = this.runtime.tasks.syncRead;
    if (!read || ids.length === 0 || this.disposed) return;
    const started = Date.now();
    let got: SyncReadResult<SyncRows["tasks"]>;
    try {
      got = await read({ workspaceId: this.workspaceId, table: "tasks", since: null, ids });
    } catch {
      // The next delta's access check (or the periodic one) catches it.
      return;
    }
    if (this.disposed) return;
    const { landed } = this.table("tasks");
    const present = new Set(got.rows.map((r) => r.id));
    const fresh = got.rows.some((r) => !landed.rows.has(r.id));
    this.applyRows("tasks", got.rows as AnyRow[], "answer", started);
    const gone = ids.filter(
      (id) => !present.has(id) && landed.rows.has(id) && (landed.seenAt.get(id) ?? 0) < started,
    );
    if (gone.length > 0) this.dropRows("tasks", gone);
    if (got.rows.length > 0 || gone.length > 0) {
      this.changed();
      // Leave no private row on the device a moment longer than needed.
      if (gone.length > 0) this.persistNow();
      else this.schedulePersist();
    }
    if (fresh) void this.checkAccess();
  }

  // ── Search (TV-D11b) ──────────────────────────────────────────────────────

  /**
   * Whether the copy holds every task you can see, so searching it is
   * searching everything: the closed tasks are in and no read was cut.
   */
  coversSearch(): boolean {
    return this.restLoaded && this.table("tasks").truncated === null;
  }

  /**
   * Search every task on the server (`tasks_search`) when the copy can't
   * answer alone, and read the matches it lacks into the copy. Null when the
   * copy is enough, or when the server can't search (offline, an older
   * database): the views search the copy either way.
   */
  async searchTasks(query: string): Promise<string[] | null> {
    const search = this.runtime.tasks.searchTasks;
    const q = query.trim();
    if (!search || !q || this.offline || this.disposed || this.coversSearch()) return null;
    let ids: string[];
    try {
      const res = await search({ workspaceId: this.workspaceId, query: q, limit: SEARCH_LIMIT });
      if (!res.supported) return null;
      ids = res.ids;
    } catch {
      return null;
    }
    const read = this.runtime.tasks.syncRead;
    const missing = ids.filter((id) => !this.table("tasks").rows.has(id));
    if (missing.length > 0 && read && !this.disposed) {
      const started = Date.now();
      try {
        const got = await read({
          workspaceId: this.workspaceId,
          table: "tasks",
          since: null,
          ids: missing,
        });
        if (!this.disposed && got.rows.length > 0) {
          this.applyRows("tasks", got.rows as AnyRow[], "answer", started);
          this.changed();
          this.schedulePersist();
        }
      } catch {
        // The ids still narrow what the copy holds.
      }
    }
    return ids;
  }

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

  private table(name: SyncTableName): Table {
    let table = this.tables.get(name);
    if (!table) {
      table = this.makeTable(name);
      this.tables.set(name, table);
    }
    return table;
  }

  /**
   * Rows from a read or an op's answer: each lands unless the copy's row is
   * strictly newer ("answer"), or unless it isn't strictly newer ("live":
   * Realtime, where an equal stamp is our own echo). A soft-deleted row
   * removes it. `readStartedAt`: the rows come from a read that began then; a
   * row removed since (a delete it couldn't know about) stays removed.
   */
  private applyRows(
    name: SyncTableName,
    rows: readonly AnyRow[],
    rule: "answer" | "live",
    readStartedAt?: number,
  ): void {
    this.table(name).applyRows(rows, rule, readStartedAt);
  }

  /** A whole read: what it has lands; what it lacks goes, unless it arrived after the read began. */
  private applyWhole(
    name: SyncTableName,
    rows: readonly AnyRow[],
    startedAt: number,
    truncated: Truncation | null,
  ): void {
    this.table(name).applyWhole(rows, startedAt, truncated);
  }

  /**
   * Remove rows the server says are gone. `readStartedAt`: they come from a
   * read that began then, so a row applied since (restored meanwhile) stays.
   */
  private forgetRows(name: SyncTableName, ids: readonly string[], readStartedAt?: number): void {
    this.table(name).forget(ids, readStartedAt);
  }

  private onLive = (event: TasksLiveEvent): void => {
    if (this.disposed) return;
    if (event.type === "resync") {
      this.requestSync(event.reason);
      return;
    }
    if (event.type === "access") {
      this.noteAccessChanges([event.change]);
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
    const write = openWrite<OverlayChange, Answers>({
      show: (op, more) => {
        for (const { table, ...overlay } of more) this.table(table).show(op, overlay);
        this.changed();
      },
      settled: (op, answers) => {
        if (answers) this.applyAnswers(answers);
        this.dropOverlays(op);
        this.changed();
        this.schedulePersist();
      },
      failed: (op) => {
        this.dropOverlays(op);
        this.changed();
      },
    });
    write.add(changes);
    return write;
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
    if (!this.table(table).patch(id, fields)) return;
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
    for (const table of this.tables.values()) table.drop(op);
  }

  // ── My queue's line-up while queue ops are out ────────────────────────────

  private lineupSeq = 0;
  private lineupChain: Promise<unknown> = Promise.resolve();

  /** My line-up as shown now (queue ops on their way included). */
  myLineup(): TaskQueueEntry[] {
    return this.queueRows().filter((e) => e.userId === this.userId);
  }

  /**
   * A queue op (TV-D2), for every surface in one chain: `optimistic` shows my
   * line-up at once (null: nothing to show), and the op is sent after every
   * earlier one, so each answer (my whole queue) includes them. The newest
   * op's line-up shows until it answers; a failure leaves the server's.
   */
  queueOp(
    optimistic: ((mine: TaskQueueEntry[]) => TaskQueueEntry[]) | null,
    op: () => Promise<TaskQueueEntry[]>,
  ): Promise<TaskQueueEntry[]> {
    const seq = ++this.lineupSeq;
    if (optimistic) this.setLineup(seq, optimistic(this.myLineup()));
    const run = this.lineupChain.then(op);
    this.lineupChain = run.catch(() => {});
    return run.then(
      (own) => {
        this.lineupAnswered(seq, own);
        return own;
      },
      (e) => {
        this.lineupFailed(seq);
        throw e;
      },
    );
  }

  /** A task in the shown line-up got its server id (a capture just saved). */
  relinkLineup(fromTaskId: string, toTaskId: string): void {
    if (!this.lineup) return;
    this.lineup = {
      seq: this.lineup.seq,
      rows: this.lineup.rows.map((e) => (e.taskId === fromTaskId ? { ...e, taskId: toTaskId } : e)),
    };
    this.changed();
  }

  /** Show my line-up as `rows` (op `seq`, the newest one). */
  private setLineup(seq: number, rows: TaskQueueEntry[]): void {
    this.lineup = { seq, rows };
    this.table("queue").invalidate();
    this.changed();
  }

  /** A queue op's answer (my whole line-up, the server's): it becomes the copy;
   *  the shown line-up goes once the newest op has answered. */
  private lineupAnswered(seq: number, mine: TaskQueueEntry[]): void {
    // My rows it lacks left my queue: a read already on its way can't put them back.
    this.table("queue").replaceSlice(
      (row) => {
        const e = row as unknown as TaskQueueEntry;
        return e.userId === this.userId && e.workspaceId === this.workspaceId;
      },
      mine as unknown as AnyRow[],
    );
    if (this.lineup && this.lineup.seq <= seq) this.lineup = null;
    this.changed();
    this.schedulePersist();
  }

  /** A queue op failed: the shown line-up goes if it was the newest's. */
  private lineupFailed(seq: number): void {
    if (this.lineup && this.lineup.seq <= seq) this.lineup = null;
    this.table("queue").invalidate();
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
      this.backoff.reset();
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (!opts.quiet) this.changed();
    else this.snapshot = null;
  }

  /** Tries while offline: soon at first (a blip passes quickly), then less often. */
  private readonly backoff: Backoff;

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed) return;
    const wait = this.backoff.next();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      const behind = () => this.offline || this.syncError !== null;
      if (!behind() || this.disposed || !this.holds.held()) return;
      void this.sync("quiet").then(() => {
        if (behind()) this.scheduleRetry();
        else this.backoff.reset();
      });
    }, wait);
  }

  /** Whether writes other than captures and check-offs must wait ("Offline"). */
  isOffline(): boolean {
    return this.offline;
  }

  /**
   * A status change (a check-off) from any surface: shown at once, sent
   * through the status op, the server's row kept; offline, or when the
   * connection goes on the way, it waits on the device. A refusal throws
   * (only its fields go back).
   */
  async sendStatus(input: {
    taskId: string;
    /** A status id, or a category word (`taskStatusWord`). */
    status: string;
    /** What the row shows meanwhile. */
    fields: Partial<Task>;
    recurrence?: RecurrenceRule | null;
  }): Promise<"saved" | "queued"> {
    const queue = (): "queued" => {
      this.enqueue({
        kind: "status",
        id: crypto.randomUUID(),
        taskId: input.taskId,
        status: input.status,
        recurrence: input.recurrence,
        fields: input.fields,
      });
      return "queued";
    };
    // Behind anything already waiting for this task (a capture, or an older
    // check-off the flush hasn't finished), so the writes land in order.
    if (this.offline || this.hasOutboxEntries(input.taskId)) return queue();
    const write = this.begin([
      {
        table: "tasks",
        patch: { id: input.taskId, fields: input.fields as Record<string, unknown> },
      },
    ]);
    try {
      const saved = await this.runtime.tasks.opSetStatus({
        workspaceId: this.workspaceId,
        taskId: input.taskId,
        status: input.status,
        recurrence: input.recurrence ?? undefined,
      });
      write.settle({ tasks: [saved] });
      return "saved";
    } catch (e) {
      write.fail();
      if (isNetworkError(e)) {
        this.wentOffline();
        return queue();
      }
      throw e;
    }
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
      await drainOutbox(this.outbox, {
        running: () => !this.offline && !this.disposed,
        send: async (entry) => {
          try {
            return { ok: true, value: await this.send(entry) };
          } catch (error) {
            return { ok: false, error };
          }
        },
        isNetwork: isNetworkError,
        sent: (entry, answers) => {
          const op = this.outboxOps.get(entry.id);
          this.outboxOps.delete(entry.id);
          this.applyAnswers(answers);
          if (op !== undefined) this.dropOverlays(op);
          this.persistNow();
          this.changed();
        },
        offline: () => this.setOffline(true),
        // Refused: it won't go through later either. It left the outbox; say
        // so and show what the server holds.
        refused: (entry, e) => {
          const op = this.outboxOps.get(entry.id);
          this.outboxOps.delete(entry.id);
          if (op !== undefined) this.dropOverlays(op);
          this.persistNow();
          this.changed();
          const what = entry.kind === "create" ? `“${entry.task.title || "Untitled"}”` : "a change";
          toast.error(`Couldn't sync ${what}`, {
            description: e instanceof Error ? e.message : undefined,
          });
        },
      });
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
      if (entry.queue) {
        // A lost connection keeps the entry (sent again: the create is the same
        // task, the add a no-op); a refused add leaves the task unqueued.
        await this.queueOp(null, () =>
          tasks.opQueueAdd({ workspaceId: this.workspaceId, taskId: saved.id }),
        ).catch((e) => {
          if (isNetworkError(e)) throw e;
          return [];
        });
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

  /** A table's rows as shown (overlays on top), the same array until it changes. */
  private rendered<T extends SyncTableName>(name: T): SyncRows[T][] {
    return this.table(name).view() as unknown as SyncRows[T][];
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

  private archivedView: {
    tasks: SyncRows["tasks"][];
    buckets: SyncRows["buckets"][];
    split: ArchivedSplit;
  } | null = null;

  /**
   * Archived projects and their tasks ride apart in the bundle (TV-U6), so
   * every surface (Home, the Calendar, counts, capture) skips them without
   * knowing about archiving; the Tasks module joins them back. Each output
   * keeps its identity while its inputs do (readers and `sameBundle` compare
   * by identity): a task edit keeps both project lists, a project rename
   * keeps both task lists unless the archived set changed.
   */
  private splitArchivedRows(
    tasks: SyncRows["tasks"][],
    buckets: SyncRows["buckets"][],
  ): ArchivedSplit {
    const view = this.archivedView;
    if (view && view.tasks === tasks && view.buckets === buckets) return view.split;
    const prev = view?.split ?? null;
    const reuse = <T>(old: T[] | undefined, next: T[]): T[] =>
      old && sameList(old, next) ? old : next;

    let liveBuckets: SyncRows["buckets"][];
    let archivedBuckets: SyncRows["buckets"][];
    if (prev && view?.buckets === buckets) {
      liveBuckets = prev.buckets;
      archivedBuckets = prev.archivedBuckets;
    } else {
      const next = splitArchived(buckets, []);
      liveBuckets = reuse(prev?.buckets, next.buckets);
      archivedBuckets = reuse(prev?.archivedBuckets, next.archivedBuckets ?? []);
    }

    let liveTasks: SyncRows["tasks"][];
    let archivedTasks: SyncRows["tasks"][];
    if (prev && view?.tasks === tasks && prev.archivedBuckets === archivedBuckets) {
      liveTasks = prev.tasks;
      archivedTasks = prev.archivedTasks;
    } else {
      const ids = new Set(archivedBuckets.map((b) => b.id));
      const live = ids.size === 0 ? tasks : tasks.filter((t) => !ids.has(t.bucketId));
      const archived = ids.size === 0 ? [] : tasks.filter((t) => ids.has(t.bucketId));
      liveTasks = live === tasks ? tasks : reuse(prev?.tasks, live);
      archivedTasks = reuse(prev?.archivedTasks, archived);
    }

    const split: ArchivedSplit = {
      buckets: liveBuckets,
      tasks: liveTasks,
      archivedBuckets,
      archivedTasks,
    };
    this.archivedView = { tasks, buckets, split };
    return split;
  }

  private buildSnapshot(): StoreSnapshot {
    const prev = this.lastSnapshot;
    const shown = this.splitArchivedRows(this.rendered("tasks"), this.rendered("buckets"));
    const { tasks, buckets, archivedBuckets, archivedTasks } = shown;
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
      prev.bundle.archivedBuckets === archivedBuckets &&
      prev.bundle.archivedTasks === archivedTasks &&
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
          archivedBuckets,
          archivedTasks,
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
    const { counts: commentCounts, stamps: commentStamps } =
      prev && prev.commentsSource === comments
        ? { counts: prev.snapshot.commentCounts, stamps: prev.snapshot.commentStamps }
        : countComments(comments);
    const files = this.rendered("attachments");
    const { counts: attachmentCounts, stamps: attachmentStamps } =
      prev && prev.attachmentsSource === files
        ? { counts: prev.snapshot.attachmentCounts, stamps: prev.snapshot.attachmentStamps }
        : countAttachments(files);
    const queue = this.queueRows();
    // The tasks waiting in the outbox (a List row's clock, TV-U10), the same
    // set object until it changes so rows don't redraw for nothing.
    const pendingIds = this.outbox.list().map((e) => (e.kind === "create" ? e.task.id : e.taskId));
    const prevPending = prev?.snapshot.pendingTaskIds;
    const pendingTaskIds =
      prevPending &&
      prevPending.size === new Set(pendingIds).size &&
      pendingIds.every((id) => prevPending.has(id))
        ? prevPending
        : new Set(pendingIds);
    const snapshot: StoreSnapshot = {
      workspaceId: this.workspaceId,
      userId: this.userId,
      loaded: this.loaded,
      error: this.error,
      syncError: this.syncError,
      fromCache: this.fromCache,
      restLoaded: this.restLoaded,
      offline: this.offline,
      pending: this.outbox.length,
      pendingTaskIds,
      loadStamp: this.loadStamp,
      bundle,
      queue: prev && sameList(prev.snapshot.queue, queue) ? prev.snapshot.queue : queue,
      kept: this.kept,
      completions: this.rendered("completions"),
      commentCounts,
      commentStamps,
      attachmentCounts,
      attachmentStamps,
      sessions: this.rendered("sessions"),
      reminders: this.rendered("reminders"),
      waiting: this.rendered("waiting"),
      views: this.rendered("views"),
      agentSessions: this.rendered("agentSessions"),
    };
    this.lastSnapshot = { snapshot, bundle, commentsSource: comments, attachmentsSource: files };
    return snapshot;
  }

  private lastSnapshot: {
    snapshot: StoreSnapshot;
    bundle: TasksModuleBundle;
    commentsSource: readonly SyncRows["comments"][];
    attachmentsSource: readonly SyncRows["attachments"][];
  } | null = null;
}

/**
 * Finished files per task, and each task's file stamp: its newest file change
 * plus the live count (a delete that drops the row moves it). A file still
 * uploading (a Realtime row before it's finished) never counts.
 */
export function countAttachments(files: readonly SyncRows["attachments"][]): {
  counts: ReadonlyMap<string, number>;
  stamps: ReadonlyMap<string, string>;
} {
  const counts = new Map<string, number>();
  const newest = new Map<string, string>();
  for (const f of files) {
    if (f.status !== "ready") continue;
    const seen = newest.get(f.taskId);
    if (!seen || f.updatedAt > seen) newest.set(f.taskId, f.updatedAt);
    if (f.deletedAt) continue;
    counts.set(f.taskId, (counts.get(f.taskId) ?? 0) + 1);
  }
  const stamps = new Map<string, string>();
  for (const [taskId, at] of newest) stamps.set(taskId, `${at}#${counts.get(taskId) ?? 0}`);
  return { counts, stamps };
}

/** Live comments per task, and each task's comment stamp: its newest
 *  comment change plus the live count (a delete that drops the row moves it). */
function countComments(comments: readonly SyncRows["comments"][]): {
  counts: ReadonlyMap<string, number>;
  stamps: ReadonlyMap<string, string>;
} {
  const counts = new Map<string, number>();
  const newest = new Map<string, string>();
  for (const c of comments) {
    const seen = newest.get(c.taskId);
    if (!seen || c.updatedAt > seen) newest.set(c.taskId, c.updatedAt);
    if (c.deletedAt) continue;
    counts.set(c.taskId, (counts.get(c.taskId) ?? 0) + 1);
  }
  const stamps = new Map<string, string>();
  for (const [taskId, at] of newest) stamps.set(taskId, `${at}#${counts.get(taskId) ?? 0}`);
  return { counts, stamps };
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

// ── One store per person and workspace ──────────────────────────────────────

const registry = new StoreRegistry<WorkspaceStore>();
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
  return registry.get(
    runtime.tasks,
    userId,
    workspaceId,
    () => new WorkspaceStore(runtime, userId, workspaceId, storeOptions),
  );
}

/** The workspace's store if one is running (capture, the bell); null otherwise. */
export function findWorkspaceStore(
  runtime: ModuoRuntime,
  workspaceId: string,
): WorkspaceStore | null {
  return registry.find(runtime.tasks, workspaceId);
}

/**
 * The device copies as the person lifecycle sees them. Cutting a copy down
 * to what waits keeps its outbox (plus what the stores that just stopped
 * held) and no rows; an older version stamp makes the next store that opens
 * it take the outbox and read everything else again.
 */
function taskCopies(cache: SyncCache): OwnedCopies<OutboxEntry> {
  return {
    keys: () => cache.keys(),
    async keepOnlyWaiting(key, inMemory) {
      let kept = 0;
      await cache.update(key, (stored) => {
        const outbox: OutboxEntry[] = [];
        const seen = new Set<string>();
        const stack = [
          ...(Array.isArray(stored?.outbox) ? (stored.outbox as OutboxEntry[]) : []),
          ...inMemory,
        ];
        for (const entry of stack) {
          if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) continue;
          seen.add(entry.id);
          outbox.push(entry);
        }
        kept = outbox.length;
        return { v: 0, savedAt: Date.now(), tables: {}, restLoaded: false, outbox };
      });
      return kept;
    },
    deleteWhere: (match) => cache.deleteWhere(match),
    clear: () => cache.clear(),
  };
}

const people = personLifecycle({
  registry,
  scopeOf: (store) => store.runtime.tasks,
  copies: () => taskCopies(storeOptions.cache ?? deviceCache()),
  waiting: (store) => store.waitingEntries(),
});

/**
 * Who is signed in now (the auth shell calls this on every change).
 *  - Someone: stores and device copies of anyone else go, so a second
 *    account on this device never reads the first one's rows. What another
 *    person still has waiting to sync stays (no rows, under their key) until
 *    they sign in here again.
 *  - Nobody (null): the stores stop, but the copy stays. A session can be
 *    null without a sign-out (an expired token that couldn't refresh offline);
 *    its waiting captures must survive until it's back. A real sign-out calls
 *    `wipeSyncCopies`.
 */
export function attachSyncUser(userId: string | null): Promise<void> {
  return people.attachUser(userId);
}

/**
 * Signed out (by the person, or by auth-js on its own when a refresh token
 * dies): every store stops and every device copy loses its rows, but what
 * still waits to sync stays under its person's key and goes out the next time
 * they sign in here. Account deletion passes `keepWaiting: false`: the
 * account is gone, so is everything.
 */
export function wipeSyncCopies(opts: { keepWaiting?: boolean } = {}): Promise<void> {
  return people.wipe(opts);
}

/**
 * How many writes wait to sync in every running store, Tasks' and Chat's (a
 * sign-out warns first; both keep theirs on the device).
 */
export function waitingSyncCount(): number {
  return waitingEverywhere();
}

/**
 * The person's workspace list came back: device copies of workspaces not on
 * it (left, removed, deleted) go, and so do their stores.
 */
export function keepWorkspaceCopies(
  userId: string,
  workspaceIds: readonly string[],
): Promise<void> {
  return people.keepWorkspaces(userId, workspaceIds);
}
