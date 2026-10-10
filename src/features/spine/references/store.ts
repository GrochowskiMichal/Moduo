// The reference store: lazy, batched, cached previews for one workspace
// (tasks-v3 §11, research §8). A reference asks for its facts when it renders
// (`want`); asks made in the same tick go out as one read per kind; answers
// stay cached for the session and refresh in place when Realtime says the item
// changed, when the window comes back, or when a cached answer is older than a
// few minutes. A card's facts (the hover preview) are asked for only on hover.
//
// The store never holds a title for an item the reader can't open: such an id
// is cached as `{ status: "private" }`, which has no title field at all.

import { referenceKey, referenceKind } from "./kinds";
import { type ResolveContext, resolverFor } from "./resolvers";
import type {
  ReferenceKind,
  ReferenceLevel,
  ReferenceRef,
  ReferenceResolution,
  ReferenceState,
} from "./types";

type Entry = {
  kind: ReferenceKind;
  type: string;
  id: string;
  state: ReferenceState;
  /** The deepest level answered so far (card ⊇ chip). */
  loaded: ReferenceLevel | null;
  /** When the last answer landed. */
  fetchedAt: number;
  /** A newer answer is wanted (Realtime, a return, age). */
  stale: boolean;
  /** Who's showing it, per level. */
  chipViews: number;
  cardViews: number;
  /** A read is out for this level. */
  inflight: ReferenceLevel | null;
  /** Bumped by every invalidation; a read that raced one is read again. */
  gen: number;
  sentGen: number;
};

/** What changed, in the store's terms (the provider maps Realtime onto this). */
export type ReferenceLiveChange =
  | { table: "tasks"; id: string; parentId?: string | null; bucketId?: string | null }
  | { table: "buckets"; id: string }
  | { table: "tags"; id: string };

export type ReferenceStoreOptions = {
  context: () => ResolveContext | null;
  /** Schedules a batch (default: the next macrotask, so one render's asks join). */
  schedule?: (fn: () => void) => void;
  now?: () => number;
  /** An answer older than this is re-read the next time it's shown. */
  maxAgeMs?: number;
};

const BATCH = 100;
const LOADING: ReferenceState = { status: "loading" };

export class ReferenceStore {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private version = 0;
  private queue = new Map<
    string,
    { kind: ReferenceKind; type: string; level: ReferenceLevel; ids: Set<string> }
  >();
  private scheduled = false;
  private handles = new Map<string, Promise<string | null>>();
  private readonly schedule: (fn: () => void) => void;
  private readonly now: () => number;
  private readonly maxAgeMs: number;

  constructor(private readonly opts: ReferenceStoreOptions) {
    this.schedule = opts.schedule ?? ((fn) => setTimeout(fn, 0));
    this.now = opts.now ?? (() => Date.now());
    this.maxAgeMs = opts.maxAgeMs ?? 5 * 60_000;
  }

  // ── reading ───────────────────────────────────────────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Changes whenever any answer does (for useSyncExternalStore). */
  getSnapshot = (): number => this.version;

  /** What a reference shows now. Never fetches; pair it with {@link want}. */
  read(ref: ReferenceRef): ReferenceState {
    return this.entries.get(referenceKey(ref))?.state ?? LOADING;
  }

  /** Whether the card's facts have arrived (the hover preview waits on this). */
  hasCard(ref: ReferenceRef): boolean {
    const e = this.entries.get(referenceKey(ref));
    return !!e && (e.loaded === "card" || e.state.status !== "ready");
  }

  /** Whether any shown reference is of a kind Realtime keeps live (tasks, projects, tags). */
  hasLiveKinds(): boolean {
    for (const e of this.entries.values()) {
      if ((e.chipViews > 0 || e.cardViews > 0) && isLiveKind(e.kind)) return true;
    }
    return false;
  }

  // ── asking ────────────────────────────────────────────────────────────────

  /**
   * Show a reference at a level: fetch it if it isn't cached (or is stale or
   * old), and keep it live while shown. Returns the release.
   */
  want(ref: ReferenceRef, level: ReferenceLevel = "chip"): () => void {
    const entry = this.entry(ref);
    if (level === "card") entry.cardViews += 1;
    else entry.chipViews += 1;
    this.ensure(entry, level);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (level === "card") entry.cardViews = Math.max(0, entry.cardViews - 1);
      else entry.chipViews = Math.max(0, entry.chipViews - 1);
    };
  }

  /** Read again whatever matches (or everything); shown ones go out now, the rest when next shown. */
  invalidate(match?: (kind: ReferenceKind, id: string) => boolean): void {
    for (const e of this.entries.values()) {
      if (match && !match(e.kind, e.id)) continue;
      e.stale = true;
      e.gen += 1;
      if (e.cardViews > 0) this.ensure(e, "card");
      else if (e.chipViews > 0) this.ensure(e, e.loaded === "card" ? "card" : "chip");
    }
  }

  /** Apply a live change: the item, its parent's counts, its project's progress. */
  applyLive(change: ReferenceLiveChange): void {
    if (change.table === "tasks") {
      const { id, parentId, bucketId } = change;
      this.invalidate(
        (kind, eid) =>
          (kind === "task" && (eid === id || eid === parentId)) ||
          (kind === "project" && !!bucketId && eid === bucketId),
      );
    } else if (change.table === "buckets") {
      // A rename reaches every task card that names the project.
      this.invalidate((kind, eid) => (kind === "project" && eid === change.id) || kind === "task");
    } else {
      this.invalidate((kind, eid) => kind === "tag" && eid === change.id);
    }
  }

  /** Whether a card may offer Complete here (the reader can edit tasks). */
  canCompleteTasks(): boolean {
    return !!this.opts.context()?.setTaskStatus;
  }

  /** A card's one action: complete or reopen a task, then read it again. */
  async completeTask(taskId: string, done: boolean): Promise<void> {
    const ctx = this.opts.context();
    if (!ctx?.setTaskStatus) throw new Error("You can’t change tasks here.");
    await ctx.setTaskStatus(taskId, done);
    this.invalidate((kind, id) => kind === "task" && id === taskId);
  }

  /** The id of the task a handle names, if the reader can see it (cached per session). */
  resolveHandle(handle: string): Promise<string | null> {
    const key = handle.trim().toUpperCase();
    const cached = this.handles.get(key);
    if (cached) return cached;
    const ctx = this.opts.context();
    if (!ctx) return Promise.resolve(null);
    const pending = ctx.previews
      .resolveHandle({ workspaceId: ctx.workspaceId, handle: key })
      .catch(() => {
        this.handles.delete(key);
        return null;
      });
    this.handles.set(key, pending);
    return pending;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private entry(ref: ReferenceRef): Entry {
    const key = referenceKey(ref);
    let e = this.entries.get(key);
    if (!e) {
      e = {
        kind: referenceKind(ref.type),
        type: ref.type,
        id: ref.id,
        state: LOADING,
        loaded: null,
        fetchedAt: 0,
        stale: false,
        chipViews: 0,
        cardViews: 0,
        inflight: null,
        gen: 0,
        sentGen: 0,
      };
      this.entries.set(key, e);
    }
    return e;
  }

  private ensure(e: Entry, level: ReferenceLevel): void {
    // Once a card has loaded, every re-read is a card read (answers never get shallower).
    const target: ReferenceLevel = level === "card" || e.loaded === "card" ? "card" : "chip";
    const deep = target === "card" ? e.loaded === "card" : e.loaded !== null;
    // A private or deleted answer has nothing deeper to show.
    const final = e.state.status === "private" || e.state.status === "deleted";
    const old = e.fetchedAt > 0 && this.now() - e.fetchedAt > this.maxAgeMs;
    const needed = !deep && !(final && e.loaded !== null);
    if (!needed && !e.stale && !old) return;
    if (e.inflight === "card" || e.inflight === target) return;
    e.inflight = target;
    e.sentGen = e.gen;
    const key = `${e.kind}:${target}:${e.kind === "other" ? e.type : ""}`;
    let batch = this.queue.get(key);
    if (!batch) {
      batch = { kind: e.kind, type: e.type, level: target, ids: new Set() };
      this.queue.set(key, batch);
    }
    batch.ids.add(e.id);
    if (!this.scheduled) {
      this.scheduled = true;
      this.schedule(() => this.flush());
    }
  }

  private flush(): void {
    this.scheduled = false;
    const batches = [...this.queue.values()];
    this.queue.clear();
    const ctx = this.opts.context();
    for (const batch of batches) {
      const ids = [...batch.ids];
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        if (!ctx) {
          this.settle(batch, chunk, null);
          continue;
        }
        resolverFor(batch.kind)(ctx, chunk, batch.level, batch.type).then(
          (answers) => this.settle(batch, chunk, answers),
          () => this.settle(batch, chunk, null),
        );
      }
    }
  }

  private settle(
    batch: { kind: ReferenceKind; type: string; level: ReferenceLevel },
    ids: string[],
    answers: Map<string, ReferenceResolution> | null,
  ): void {
    const prefix = batch.kind === "other" ? batch.type : batch.kind;
    for (const id of ids) {
      const e = this.entries.get(`${prefix}:${id}`);
      if (!e) continue;
      if (e.inflight === batch.level) e.inflight = null;
      const answer = answers?.get(id);
      if (!answer) {
        // A failed read keeps what was shown; a first read that failed says so.
        if (e.state.status === "loading") e.state = { status: "error" };
        continue;
      }
      e.state =
        answer.status === "ready"
          ? { status: "ready", facts: answer.facts }
          : answer.status === "deleted"
            ? { status: "deleted", kind: e.kind }
            : { status: "private" };
      e.loaded = batch.level === "card" ? "card" : (e.loaded ?? "chip");
      e.fetchedAt = this.now();
      // Changed again while this read was out: show it, and read once more.
      e.stale = e.gen !== e.sentGen;
      if (e.stale && (e.cardViews > 0 || e.chipViews > 0)) this.ensure(e, e.loaded);
    }
    this.version += 1;
    for (const fn of this.listeners) fn();
  }
}

function isLiveKind(kind: ReferenceKind): boolean {
  return kind === "task" || kind === "project" || kind === "tag";
}
