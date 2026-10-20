// TS-3b (specs/tanstack-spine.md), built and tested but NOT imported by the
// app yet: wiring it puts TanStack DB's query engine and `react-db` in the
// first load (+59 KB gzip, past AC9's cap) for a read the cached map already
// answers in O(1). Wire it when a read needs it (TS-3c brings collections into
// the write path). Per-task reads as narrow, indexed TanStack
// DB live queries over the rows the store shows. A task by id and a task's
// subtasks each touch a handful of rows through an
// index, so they build in well under a millisecond and recompute only when
// one of their rows changes. Whole-workspace data (the sorted task list,
// sidebar counts, every row's facts with its comment count) stays the cached derivations in
// `features/tasks/derived.ts`: at 10k tasks on @tanstack/db 0.15.1 a
// whole-workspace live query costs 40–65 ms to build (groupBy ~35 ms,
// includes ~110 ms), which a warm open can't pay (docs/decisions/data.md).
//
// The rows are the store's as shown (overlays on top), fed into a local
// collection after each store change, so an optimistic edit shows here at
// once. Live-query results carry TanStack's virtual props and are their own
// objects; the hooks hand back the store's objects (by key), so a row here is
// the same object every other surface holds. Writes stay on the store (TS-3c
// moves them).

import {
  BasicIndex,
  type ChangeMessageOrDeleteKeyMessage,
  type Collection,
  createCollection,
  eq,
  isNull,
  not,
} from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import type { WorkspaceStore } from "../store";
import type { SyncRows } from "../types";

type Task = SyncRows["tasks"];

type Keyed = { id: string };

/** A collection that mirrors an array the store hands out, by object identity. */
export type ShownRows<R extends Keyed> = {
  readonly collection: Collection<R, string>;
  /** Write what changed since the last array (the same array: nothing). */
  feed(rows: readonly R[]): void;
  /** The store's object for a key (live-query rows are TanStack's own). */
  source(id: string): R | undefined;
  dispose(): void;
};

let nextId = 0;

export function shownRows<R extends Keyed>(
  name: string,
  indexed: readonly (keyof R & string)[],
): ShownRows<R> {
  let push: ((messages: ChangeMessageOrDeleteKeyMessage<R, string>[]) => void) | null = null;
  let lastArray: readonly R[] | null = null;
  const written = new Map<string, R>();
  const collection = createCollection<R, string>({
    id: `shown:${name}:${nextId++}`,
    getKey: (r) => r.id,
    gcTime: 0,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        push = (messages) => {
          begin();
          for (const m of messages) write(m);
          commit();
        };
        markReady();
        return () => {
          push = null;
        };
      },
    },
  });
  for (const field of indexed) {
    collection.createIndex((row) => (row as Record<string, unknown>)[field], {
      indexType: BasicIndex,
    });
  }
  return {
    collection,
    feed(rows) {
      if (rows === lastArray || !push) return;
      lastArray = rows;
      const messages: ChangeMessageOrDeleteKeyMessage<R, string>[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        seen.add(row.id);
        const was = written.get(row.id);
        if (was === row) continue;
        messages.push({ type: was ? "update" : "insert", value: row });
        written.set(row.id, row);
      }
      if (written.size !== seen.size) {
        for (const id of written.keys()) {
          if (seen.has(id)) continue;
          messages.push({ type: "delete", key: id });
          written.delete(id);
        }
      }
      if (messages.length > 0) push(messages);
    },
    source: (id) => written.get(id),
    dispose() {
      push = null;
      written.clear();
      collection.cleanup().catch(() => undefined);
    },
  };
}

/** One store's shown subtasks (tasks with a parent), kept fed while the store lives. */
type TasksLive = {
  subtasks: ShownRows<Task>;
};

const live = new WeakMap<WorkspaceStore, TasksLive>();

/**
 * The store's live rows, made on first use and fed after every store change.
 * Only tasks with a parent go in (a few percent of a workspace): the panel's
 * subtasks ask on the open's first render when a task is selected, and
 * mirroring all 10k tasks there cost the warm open ~25 ms (dev build).
 */
export function tasksLiveOf(store: WorkspaceStore): TasksLive {
  let made = live.get(store);
  if (made) return made;
  const subtasks = shownRows<Task>("subtasks", ["parentId"]);
  let from: readonly Task[] | null = null;
  let children: Task[] = [];
  const feed = () => {
    if (store.isDisposed()) {
      subtasks.dispose();
      stop();
      return;
    }
    // Visible tasks only (an archived project's ride apart, TV-U6), as the
    // derivations see them; filtered again only when the tasks change.
    const tasks = store.getSnapshot().bundle.tasks;
    if (tasks !== from) {
      from = tasks;
      children = tasks.filter((t) => t.parentId !== null);
    }
    subtasks.feed(children);
  };
  const stop = store.subscribe(feed);
  made = { subtasks };
  live.set(store, made);
  feed();
  return made;
}

/** Warm the store's live rows after the first paint, off the open's critical path. */
export function warmTasksLive(store: WorkspaceStore): () => void {
  const idle = globalThis.requestIdleCallback;
  if (idle) {
    const handle = idle(() => tasksLiveOf(store), { timeout: 2_000 });
    return () => globalThis.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(() => tasksLiveOf(store), 500);
  return () => clearTimeout(timer);
}

const NO_TASKS: Task[] = [];

/** The store's objects for a live query's rows, the same array while they are. */
function useSources<R extends Keyed>(shown: ShownRows<R> | null, data: readonly R[]): R[] {
  return useMemo(() => {
    if (!shown || data.length === 0) return [];
    const out: R[] = [];
    for (const row of data) {
      const own = shown.source(row.id);
      if (own) out.push(own);
    }
    return out;
  }, [shown, data]);
}

/**
 * A task's live, non-archived subtasks in position order (as
 * `subtasksByParent` has them), through the `parentId` index.
 */
export function useLiveSubtasks(store: WorkspaceStore | null, parentId: string): Task[] {
  const shown = store ? tasksLiveOf(store).subtasks : null;
  const { data } = useLiveQuery({
    query: (q) =>
      shown
        ? q
            .from({ t: shown.collection })
            .where(({ t }) => eq(t.parentId, parentId))
            .where(({ t }) => isNull(t.deletedAt))
            .where(({ t }) => not(eq(t.status, "archived")))
            .orderBy(({ t }) => t.position)
        : undefined,
  });
  const rows = useSources(shown, (data ?? NO_TASKS) as Task[]);
  return rows.length === 0 ? NO_TASKS : rows;
}
