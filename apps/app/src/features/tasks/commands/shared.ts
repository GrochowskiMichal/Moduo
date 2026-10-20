// The helpers every Tasks aggregate's commands share: why an edit can't
// start, how a refused write says so, the single-task intent op, the queue
// op chain, the project op chain. Made once per command set (`createShared`),
// reading the store's data when they run.

import {
  isBacklogTask,
  legacyTaskStatus,
  type TaskStatusCategory,
  taskCategoryOf,
} from "@contracts/vocabularies";
import { toast } from "sonner";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { isNetworkError } from "../../../lib/sync/network";
import type { OverlayChange, PendingWrite, WorkspaceStore } from "../../../lib/sync/store";
import type { TagContext } from "../../tags/store";
import type { ProjectStatus, RecurrenceRule, Task, TaskQueueEntry, TaskStatus } from "../model";
import { statusesForBucketOf } from "../selectors";
import { optimisticStatus } from "../statuses";
import type { TaskCommandsContext } from "./context";

/** Optimistic placeholder id, not yet a real server uuid. */
export const isTempId = (id: string) => id.startsWith("tmp-");

export const NO_EDIT = "You don't have edit access to Tasks in this workspace.";
/** A queued capture that wasn't created (refused, or waiting offline): no queue op, no toast. */
export const NOT_CREATED = new Error("not created");
export const STILL_SAVING = "Still saving that task — try again in a moment.";
/** An archive whose Move didn't go through (that said why already): no archive. */
export const NOT_MOVED = new Error("not moved");

/** A change that can't wait for the network (default g): said once, never queued. */
export function sayOffline(): void {
  toast("Offline", {
    description:
      "This change needs a connection. Captures and check-offs wait on this device and sync when you're back.",
  });
}

/** One field write of a task, as an overlay change. */
export const patchOf = (id: string, fields: Partial<Task>): OverlayChange => ({
  table: "tasks",
  patch: { id, fields: fields as Record<string, unknown> },
});

/** A task's status as it was, for an Undo: its own status when it has one. */
export function statusBack(before: Task): Partial<Task> {
  return before.statusId
    ? {
        statusId: before.statusId,
        statusCategory: taskCategoryOf(before),
        status: legacyTaskStatus(taskCategoryOf(before)),
      }
    : {
        statusCategory: taskCategoryOf(before),
        status: legacyTaskStatus(taskCategoryOf(before)),
      };
}

export type Failed = (e: unknown, fallback: string) => void;

/**
 * Say why a write didn't go through. A lost connection (the browser may not
 * know yet) is "Offline", and the store holds further edits until it's back.
 */
export function makeFailed(store: WorkspaceStore | null): Failed {
  return (e, fallback) => {
    if (isNetworkError(e)) {
      store?.wentOffline();
      sayOffline();
      return;
    }
    toast.error(e instanceof Error ? e.message : fallback);
  };
}

export type ApplyOpOptions = {
  extra?: OverlayChange[];
  /** Rows the server drops with this op (queue rows of a closed task). */
  forget?: string[];
  /** Tasks the answer took out of my sight (TV-D13: an unfiled task
   *  handed into someone else's Inbox): dropped from the copy at once. */
  leaves?: (saved: Task) => string[];
  offline?: { status: string; recurrence?: RecurrenceRule | null };
  /** Once the server took it (a caller's own toast, say "Taken", TV-U15). */
  onSaved?: (saved: Task) => void;
};

export type Shared = ReturnType<typeof createShared>;

export function createShared(ctx: TaskCommandsContext) {
  const { store, runtime, workspaceId, userId, data, env, bumpActivity } = ctx;
  const failed = makeFailed(store);

  /** Why an edit can't start now (said once), or null when it can. */
  const editBlocked = (): boolean => {
    if (!runtime || !workspaceId || !env().canEdit || !store) {
      toast.error(NO_EDIT);
      return true;
    }
    if (store.isOffline()) {
      sayOffline();
      return true;
    }
    return false;
  };

  /**
   * A task of an archived project is read-only until it's unarchived
   * (TV-U6): said once, and the edit doesn't start. Read from the store now,
   * so an archive's Undo (which unarchives first) and a refused archive can
   * put its tasks back in the same tick.
   */
  const archivedBlocked = (taskId: string): boolean => {
    const now = store?.getSnapshot().bundle;
    const task = now?.archivedTasks?.find((t) => t.id === taskId);
    if (!task) return false;
    const name = now?.archivedBuckets?.find((b) => b.id === task.bucketId)?.name;
    toast.error(`Unarchive “${name ?? "its project"}” to change its tasks.`);
    return true;
  };

  /** A write that didn't go through: its fields are back to the server's, and it says why. */
  const refused = (write: PendingWrite, e: unknown, fallback = "Something went wrong.") => {
    write.fail();
    failed(e, fallback);
  };

  /** The statuses a project's tasks use (the Inbox: the workspace default). */
  const statusesForBucket = (bucketId: string): ProjectStatus[] => {
    const d = data();
    return statusesForBucketOf(d.statuses, d.allBuckets, bucketId);
  };

  /** A backlog task's move to To do (queuing or scheduling it, REPLAN 53), for
   *  showing it before the server's own move comes back. Null otherwise. */
  const backlogToTodo = (task: Task): Partial<Task> | null =>
    isBacklogTask(task)
      ? optimisticStatus(task, { category: "todo" }, statusesForBucket(task.bucketId))
      : null;

  /**
   * Mirror the server: done, archived, backlog or deleted leaves every queue
   * (TV-D2, TV-D9). Returns the overlay changes that take the task out of the
   * queues shown (the write that changes its status carries them, so a refusal
   * puts them back), and the queue rows the server will have dropped. A done
   * task of mine stays on show (kept) until the next reload; reopening drops it.
   */
  const queueFollowStatus = (
    taskId: string,
    status: TaskStatus | TaskStatusCategory | "deleted",
  ): { changes: OverlayChange[]; rowIds: string[] } => {
    if (status === "todo" || status === "in_progress") {
      store?.unkeep(taskId);
      return { changes: [], rowIds: [] };
    }
    const d = data();
    const mine = d.myQueueEntries.find((e) => e.taskId === taskId);
    if (status === "done" && mine) store?.keep(mine);
    const rows = d.allQueueRows.filter((e) => e.taskId === taskId);
    return {
      changes: rows.map((e) => ({ table: "queue", remove: e.id }) as OverlayChange),
      rowIds: rows.map((e) => e.id),
    };
  };

  /**
   * Run a single-task intent op: shown at once, then the RPC (which checks
   * permission, enforces invariants, and logs attributed activity in one
   * transaction); the returned row becomes the copy. A refusal puts back only
   * what this op changed. `extra` rides in the same write (queue rows a
   * status change takes out). A status op (a check-off) that can't reach the
   * server waits on the device instead (`offline`).
   */
  const applyOp = (
    id: string,
    optimistic: Partial<Task>,
    op: () => Promise<Task>,
    opts: ApplyOpOptions = {},
  ) => {
    if (!runtime || !workspaceId || !env().canEdit || !store) {
      toast.error(NO_EDIT);
      return;
    }
    if (isTempId(id)) {
      toast.error(STILL_SAVING);
      return;
    }
    if (archivedBlocked(id)) return;
    const current = data().allTasks.find((t) => t.id === id);
    const toTodo =
      current && optimistic.scheduledAt && optimistic.statusCategory === undefined
        ? backlogToTodo(current)
        : null;
    const shown = { ...optimistic, ...toTodo, updatedAt: new Date().toISOString() };
    const queueing = opts.offline;
    // Offline, a capture still waiting to sync, or an older check-off still
    // waiting for this task: a check-off waits on the device, behind them (sent
    // live it would land first and the older one would win); anything else
    // says "Offline" (or "still saving" for a waiting capture).
    if (store.isOffline() || store.isQueuedCreate(id) || (queueing && store.hasOutboxEntries(id))) {
      if (!queueing) {
        if (store.isOffline()) sayOffline();
        else toast.error(STILL_SAVING);
        return;
      }
      store.enqueue({
        kind: "status",
        id: crypto.randomUUID(),
        taskId: id,
        status: queueing.status,
        recurrence: queueing.recurrence,
        fields: shown,
      });
      return;
    }
    const write = store.begin([patchOf(id, shown), ...(opts.extra ?? [])]);
    void op()
      .then((saved) => {
        write.settle({ tasks: [saved] });
        if (opts.forget?.length) store.forget("queue", opts.forget);
        const gone = opts.leaves?.(saved);
        if (gone?.length) store.forget("tasks", gone);
        bumpActivity();
        opts.onSaved?.(saved);
      })
      .catch((e) => {
        if (queueing && isNetworkError(e)) {
          // The connection went: the check-off waits on the device (the
          // server takes a repeated status as a no-op).
          write.fail();
          store.wentOffline();
          store.enqueue({
            kind: "status",
            id: crypto.randomUUID(),
            taskId: id,
            status: queueing.status,
            recurrence: queueing.recurrence,
            fields: shown,
          });
          return;
        }
        refused(write, e);
      });
  };

  /**
   * Send a new task (shown at once under a `tmp-` id, sent under its own id):
   * resolves to the saved task, or null. Offline, or when the connection goes
   * while it's on its way, it waits on the device under that id and resolves
   * null (it isn't saved yet): a resend never makes a second task.
   */
  const sendNewTask = (optimistic: Task, opts: { queue?: boolean } = {}): Promise<Task | null> => {
    if (!store) return Promise.resolve(null);
    return store.sendCreate(optimistic, opts).then(
      (result) => result.saved,
      (e) => {
        failed(e, "Couldn't create task.");
        return null;
      },
    );
  };

  /**
   * Send one queue op after every earlier one, from any surface (the store
   * keeps the one chain); its answer (my whole queue) becomes the copy.
   */
  const sendQueueOp = (
    optimistic: ((mine: TaskQueueEntry[]) => TaskQueueEntry[]) | null,
    op: () => Promise<TaskQueueEntry[]>,
    onSaved?: () => void,
  ) => {
    if (!store) return;
    void store.queueOp(optimistic, op).then(
      () => {
        bumpActivity();
        onSaved?.();
      },
      // Only the shown line-up goes; the copy holds the server's.
      (e) => {
        if (e !== NOT_CREATED) failed(e, "Couldn't update your queue.");
      },
    );
  };

  /**
   * Run a queue op (TV-D2): show `optimistic(my line-up)` at once, then the
   * RPC, which answers with my whole queue in order. The newest op's line-up
   * shows until it answers, so two quick toggles can't put back an older
   * line-up. On error: toast, and my line-up is the server's again. Returns
   * false when it couldn't start (no access, offline). `onSaved` runs once the
   * server has taken it (a drop's Undo toast).
   */
  const runQueueOp = (
    optimistic: (mine: TaskQueueEntry[]) => TaskQueueEntry[],
    op: (rt: ModuoRuntime, ws: string) => Promise<TaskQueueEntry[]>,
    onSaved?: () => void,
  ): boolean => {
    if (!userId || editBlocked()) return false;
    if (!runtime || !workspaceId || !store) return false;
    const rt = runtime;
    const ws = workspaceId;
    sendQueueOp(optimistic, () => op(rt, ws), onSaved);
    return true;
  };

  /** A placeholder row for my queue until the server's answer replaces it. */
  const optimisticEntry = (taskId: string, position: string): TaskQueueEntry => {
    const now = new Date().toISOString();
    return {
      id: `tmp-${crypto.randomUUID()}`,
      workspaceId: workspaceId ?? "",
      userId: userId ?? "",
      taskId,
      position,
      queuedAt: now,
      updatedAt: now,
    };
  };

  /** Writes to one project go out in order (a drag, then a colour, then Undo). */
  const projectChains = new Map<string, Promise<unknown>>();
  const chainProjectOp = <T>(id: string, op: () => Promise<T>): Promise<T> => {
    const prev = projectChains.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(op);
    projectChains.set(id, next);
    // A settled chain's entry goes, unless a newer op joined it.
    const clear = () => {
      if (projectChains.get(id) === next) projectChains.delete(id);
    };
    next.then(clear, clear);
    return next;
  };

  /** Where tag writes go, or null (with a toast) when this person can't edit Tasks. */
  const tagContext = (): TagContext | null => {
    if (editBlocked() || !runtime || !workspaceId) return null;
    return { runtime, workspaceId, userId };
  };

  /** Waits on an open task now (spec §5c). */
  const isBlocked = (id: string) => data().blockedIds.has(id);

  return {
    failed,
    editBlocked,
    archivedBlocked,
    refused,
    statusesForBucket,
    backlogToTodo,
    queueFollowStatus,
    applyOp,
    sendNewTask,
    sendQueueOp,
    runQueueOp,
    optimisticEntry,
    chainProjectOp,
    tagContext,
    isBlocked,
  };
}
