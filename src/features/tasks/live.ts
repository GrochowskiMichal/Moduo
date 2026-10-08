// Live updates for Tasks (TV-D5, specs/tasks-v2.md §12 + decision 10): the
// pure half. `realtime.ts` turns Supabase Realtime `postgres_changes` into
// `LiveChange`s; this file decides how one lands in the module's state.
//
// Three rules keep a teammate's change from fighting your own edits:
//   1. While one of your own calls is in flight (or just settled), changes
//      wait in a buffer (`LiveGate`). An optimistic edit is never replaced by
//      the echo of an earlier save, and a row you just removed isn't put back
//      by the late echo of its insert.
//   2. A change for a row you already have lands only if it is newer by the
//      server's `updated_at`. After a save settles the local row is the server's
//      own copy, so its echo is "not newer" and is dropped.
//   3. Realtime is a latency layer, never the source of truth: a reconnect or
//      coming back to the app refetches (see `use-tasks-module.ts`).

import type { ModuoRuntime } from "../../lib/runtime.types";
import {
  bucketRowToModel,
  sortQueueEntries,
  tagLinkRowToModel,
  tagRowToModel,
  taskQueueRowToModel,
  taskRowToModel,
} from "../../lib/task-rows";
import type { Bucket, Tag, TagLink, Task, TaskQueueEntry, TasksModuleBundle } from "./model";

/** The tables Tasks listens to (all in the `supabase_realtime` publication). */
export const LIVE_TABLES = ["tasks", "buckets", "tags", "tag_links", "task_queue"] as const;
export type LiveTable = (typeof LIVE_TABLES)[number];

type Upsert<T extends LiveTable, R> = { table: T; kind: "upsert"; row: R };

export type LiveChange =
  | Upsert<"tasks", Task>
  | Upsert<"buckets", Bucket>
  | Upsert<"tags", Tag>
  | Upsert<"tag_links", TagLink>
  | Upsert<"task_queue", TaskQueueEntry>
  | { table: LiveTable; kind: "delete"; id: string };

/** The part of a Realtime `postgres_changes` payload we read. */
export type LivePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE" | string;
  new?: unknown;
  old?: unknown;
};

/**
 * A Realtime payload → a change, or null when it can't be read (an unknown
 * shape is ignored; the next refetch carries the truth). A DELETE carries only
 * the primary key: Realtime never sends a deleted row's other columns to a
 * table with row-level security.
 */
export function parseLiveChange(table: LiveTable, payload: LivePayload): LiveChange | null {
  try {
    if (payload.eventType === "DELETE") {
      const id = (payload.old as { id?: unknown } | null | undefined)?.id;
      return typeof id === "string" ? { table, kind: "delete", id } : null;
    }
    if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return null;
    switch (table) {
      case "tasks":
        return { table, kind: "upsert", row: taskRowToModel(payload.new) };
      case "buckets":
        return { table, kind: "upsert", row: bucketRowToModel(payload.new) };
      case "tags":
        return { table, kind: "upsert", row: tagRowToModel(payload.new) };
      case "tag_links":
        return { table, kind: "upsert", row: tagLinkRowToModel(payload.new) };
      case "task_queue":
        return { table, kind: "upsert", row: taskQueueRowToModel(payload.new) };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * A Postgres timestamp as microseconds since the epoch, or null. Realtime and
 * PostgREST format timestamptz differently (`2026-10-08 20:05:25.123456+00`
 * vs `…T…+00:00`), and two saves can land in the same millisecond, so this
 * keeps all six fractional digits.
 */
export function timestampMicros(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(
    ts.trim(),
  );
  if (!m) {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? null : ms * 1000;
  }
  let zone = m[4] ?? "Z";
  if (/^[+-]\d\d$/.test(zone)) zone = `${zone}:00`;
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const seconds = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (Number.isNaN(seconds)) return null;
  const micros = Number(`${m[3] ?? ""}000000`.slice(0, 6));
  return seconds * 1000 + micros;
}

/** Whether `incoming` is strictly newer than `local` (unknown stamps count as newer). */
export function isNewer(incoming: string | null | undefined, local: string | null | undefined) {
  const a = timestampMicros(incoming);
  const b = timestampMicros(local);
  if (a === null || b === null) return a !== null || b === null;
  return a > b;
}

type Row = { id: string; updatedAt?: string; deletedAt?: string | null };

/**
 * Upsert one row into a list by the rules above. Returns the same array when
 * nothing changes, so React can skip the render.
 */
function upsertRow<T extends Row>(list: T[], row: T): T[] {
  const index = list.findIndex((r) => r.id === row.id);
  const gone = !!row.deletedAt;
  if (index === -1) return gone ? list : [...list, row];
  const local = list[index]!;
  // Rows without updated_at (tag links) never change after insert.
  if (row.updatedAt === undefined || !isNewer(row.updatedAt, local.updatedAt)) return list;
  if (gone) return list.filter((r) => r.id !== row.id);
  const next = list.slice();
  next[index] = row;
  return next;
}

function removeRow<T extends Row>(list: T[], id: string): T[] {
  return list.some((r) => r.id === id) ? list.filter((r) => r.id !== id) : list;
}

/** Which bundle list each table lands in (the queue lives outside the bundle). */
const BUNDLE_KEY = {
  tasks: "tasks",
  buckets: "buckets",
  tags: "tags",
  tag_links: "tagLinks",
} as const satisfies Partial<Record<LiveTable, keyof TasksModuleBundle>>;

/** Apply one change to the module bundle (queue changes leave it untouched). */
export function mergeBundle(bundle: TasksModuleBundle, change: LiveChange): TasksModuleBundle {
  if (change.table === "task_queue") return bundle;
  const key = BUNDLE_KEY[change.table];
  const list = bundle[key] as Row[];
  const next =
    change.kind === "delete" ? removeRow(list, change.id) : upsertRow(list, change.row as Row);
  return next === list ? bundle : { ...bundle, [key]: next };
}

/**
 * Apply one change to the queue rows (other tables leave it untouched). A
 * person has a task in their queue at most once, so a newer row for the same
 * person and task replaces whatever was there, and the list stays in line-up
 * order (person, then position bytewise, like `sortQueueEntries`).
 */
export function mergeQueue(queue: TaskQueueEntry[], change: LiveChange): TaskQueueEntry[] {
  if (change.table !== "task_queue") return queue;
  if (change.kind === "delete") return removeRow(queue, change.id);
  const row = change.row as TaskQueueEntry;
  const same = queue.find(
    (e) => e.id === row.id || (e.userId === row.userId && e.taskId === row.taskId),
  );
  if (same && !isNewer(row.updatedAt, same.updatedAt)) return queue;
  return sortQueueEntries(queue.filter((e) => e !== same).concat(row));
}

/**
 * Leave out tags whose delete is waiting on its Undo toast (and their links),
 * so a refetch or a live change in that window can't bring them back.
 */
export function withoutHeldTags(
  bundle: TasksModuleBundle,
  held: ReadonlySet<string>,
): TasksModuleBundle {
  if (held.size === 0) return bundle;
  const tags = bundle.tags.filter((t) => !held.has(t.id));
  const tagLinks = bundle.tagLinks.filter((l) => !held.has(l.tagId));
  if (tags.length === bundle.tags.length && tagLinks.length === bundle.tagLinks.length) {
    return bundle;
  }
  return { ...bundle, tags, tagLinks };
}

/** How long changes keep waiting after your own last call settles. */
export const ECHO_GRACE_MS = 1_000;
/** The longest a change waits on calls that don't settle (a stalled request). */
export const MAX_HOLD_MS = 10_000;

/**
 * Holds live changes back while this module has its own calls in flight, and
 * for `graceMs` after the last one settles (the echo of a save usually arrives
 * after its response does). Then it hands the batch over in arrival order.
 */
export class LiveGate {
  private inFlight = 0;
  private buffer: LiveChange[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idleWaiters: (() => void)[] = [];
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every tracked write, so a refetch can tell it raced one. */
  writeSeq = 0;

  constructor(
    private readonly deliver: (changes: LiveChange[]) => void,
    private readonly graceMs = ECHO_GRACE_MS,
    private readonly maxHoldMs = MAX_HOLD_MS,
  ) {}

  /** Whether changes are being held right now. */
  get busy(): boolean {
    return this.inFlight > 0 || this.timer !== null;
  }

  /** Start a call; the returned function ends it (safe to call twice). */
  begin(opts: { write?: boolean } = {}): () => void {
    if (opts.write !== false) this.writeSeq += 1;
    this.inFlight += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.inFlight -= 1;
      if (this.inFlight === 0) this.startGrace();
    };
  }

  push(change: LiveChange): void {
    if (!this.busy) {
      this.deliver([change]);
      return;
    }
    this.buffer.push(change);
    // A request that never settles must not freeze teammates' changes: after
    // MAX_HOLD_MS what is held lands anyway (still newest-wins per row).
    this.holdTimer ??= setTimeout(() => {
      this.holdTimer = null;
      this.flushBuffer();
    }, this.maxHoldMs);
  }

  /** Run `fn` once nothing is held (now, if nothing is). */
  whenIdle(fn: () => void): void {
    if (this.busy) this.idleWaiters.push(fn);
    else fn();
  }

  /** Drop everything held (the module is switching workspace or unmounting). */
  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.timer = null;
    this.holdTimer = null;
    this.buffer = [];
    this.idleWaiters = [];
  }

  private startGrace(): void {
    // A macrotask at least: the caller's own `.then` (which swaps the saved
    // row in) must run before held echoes are compared against it.
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.inFlight > 0) return;
      this.flushBuffer();
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const fn of waiters) fn();
    }, this.graceMs);
  }

  private flushBuffer(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    const batch = this.buffer;
    this.buffer = [];
    if (batch.length > 0) this.deliver(batch);
  }
}

/**
 * The runtime with every `tasks.*` call counted by the gate, so the module's
 * own saves (and the reads that would replace its state) hold live changes
 * back. A write that goes around the runtime (the focus time total,
 * `focus-time-write.ts`) has to call `gate.begin()` itself.
 */
export function trackTaskCalls(runtime: ModuoRuntime, gate: LiveGate): ModuoRuntime {
  const tasks = runtime.tasks;
  const wrapped = {} as Record<string, unknown>;
  for (const [name, value] of Object.entries(tasks)) {
    if (typeof value !== "function") {
      wrapped[name] = value;
      continue;
    }
    wrapped[name] = (...args: unknown[]) => {
      const end = gate.begin();
      try {
        const result = (value as (...a: unknown[]) => unknown).apply(tasks, args);
        if (result && typeof (result as Promise<unknown>).finally === "function") {
          return (result as Promise<unknown>).finally(end);
        }
        end();
        return result;
      } catch (e) {
        end();
        throw e;
      }
    };
  }
  return { ...runtime, tasks: wrapped as ModuoRuntime["tasks"] };
}
