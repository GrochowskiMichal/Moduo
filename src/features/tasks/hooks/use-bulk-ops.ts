// The bulk writes (tasks-v3 §4, calls 82b and a/e; TV-U12): a selection's
// change as ONE write on the store and ONE Undo. Every task still goes
// through its own server op (which checks that person may edit that task),
// so a partly refused batch keeps what saved and says "3 of 4 changed". Used
// inside `useTasksModule`, which hands over the store and its helpers.

import {
  legacyTaskStatus,
  type TaskStatusCategory,
  taskStatusWord,
} from "@contracts/vocabularies";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { isNetworkError } from "../../../lib/sync/network";
import type { OverlayChange, WorkspaceStore } from "../../../lib/sync/store";
import { dueOnToLocalInstant, editableTaskFields, localDayOf } from "../../../lib/task-rows";
import { undoToast } from "../../../lib/undo-toast";
import { attachOrDetachMany, type TagContext } from "../../tags/store";
import {
  type BulkRefusal,
  type BulkWrite,
  bulkResultText,
  dueDayOf,
  tasksWord,
} from "../bulk";
import { undoWrite } from "../dnd/drop-write";
import { betweenPositions } from "../helpers";
import type {
  Bucket,
  ProjectStatus,
  RecurrenceRule,
  Task,
  TaskQueueEntry,
  TaskStatus,
  TaskWaitingEntry,
} from "../model";
import { endOfQueue } from "../queue";
import { engineZone, recurrenceOnStatusChange } from "../recurrence-engine";
import { optimisticStatus, statusKeyCategory } from "../statuses";

/** How many tasks' ops are in flight at once. */
const POOL = 4;

const isTempId = (id: string) => id.startsWith("tmp-");

const patchOf = (id: string, fields: Partial<Task>): OverlayChange => ({
  table: "tasks",
  patch: { id, fields: fields as Record<string, unknown> },
});

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

/**
 * Run `work` over `items`, a few at a time. Stops starting new ones once
 * `stop()` says so (the connection went); those are reported as not run.
 */
async function runPool<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
  stop: () => boolean,
): Promise<T[]> {
  const notRun: T[] = [];
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (stop()) {
        notRun.push(item);
        continue;
      }
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, lane));
  return notRun;
}

export type BulkOpsDeps = {
  store: WorkspaceStore | null;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
  /** Every task, archived ones too, as they are now. */
  tasksRef: { readonly current: readonly Task[] };
  /** The projects (and Inbox) I can see now. */
  bucketsRef: { readonly current: readonly Bucket[] };
  /** My line-up now. */
  myQueueRef: { readonly current: readonly TaskQueueEntry[] };
  statusesForBucket: (bucketId: string) => ProjectStatus[];
  queueFollowStatus: (
    taskId: string,
    status: TaskStatus | TaskStatusCategory | "deleted",
  ) => { changes: OverlayChange[]; rowIds: string[] };
  /** Says why an edit can't start (no access, offline); true when it can't. */
  editBlocked: () => boolean;
  /** Says why a write didn't go through (a lost connection: "Offline"). */
  failed: (e: unknown, fallback: string) => void;
  /** The trail moved (the panel re-reads it). */
  onSaved: () => void;
  reloadTrash: () => Promise<void>;
  restoreQueuePlace: (taskId: string, lineupBefore: string[]) => void;
  runQueueOp: (
    optimistic: (mine: TaskQueueEntry[]) => TaskQueueEntry[],
    op: (rt: ModuoRuntime, ws: string) => Promise<TaskQueueEntry[]>,
    onSaved?: () => void,
  ) => boolean;
  optimisticEntry: (taskId: string, position: string) => TaskQueueEntry;
  /** A backlog task's move to To do (queuing it does that), or null. */
  backlogToTodo: (task: Task) => Partial<Task> | null;
  tagContext: () => TagContext | null;
};

export type BulkWriteOptions = {
  /** What the toast says once `main` selected tasks and `followers` brought along changed. */
  label: (main: number, followers: number) => string;
  /** Tasks the change brought along (a finished parent's subtasks): counted apart, never named. */
  followers?: ReadonlySet<string>;
  /** False for Undo's own write: no second Undo, and quiet unless something was refused. */
  undoable?: boolean;
};

/** One task's planned write, with the row it started from. */
type Planned = {
  write: BulkWrite;
  before: Task;
  category: TaskStatusCategory | undefined;
  /** The repeat rule the status op carries (advanced on a check-off). */
  statusRecurrence: RecurrenceRule | null | undefined;
  /** Field-level part (tasks_op_update). */
  fields: ReturnType<typeof editableTaskFields>;
  moving: boolean;
  queueRows: string[];
};

export function useBulkOps(deps: BulkOpsDeps) {
  const {
    store,
    runtime,
    workspaceId,
    userId,
    tasksRef,
    bucketsRef,
    myQueueRef,
    statusesForBucket,
    queueFollowStatus,
    editBlocked,
    failed,
    onSaved,
    reloadTrash,
    restoreQueuePlace,
    runQueueOp,
    optimisticEntry,
    backlogToTodo,
    tagContext,
  } = deps;

  const latestBulkWrite = useRef<
    (writes: readonly BulkWrite[], opts: BulkWriteOptions) => Promise<string[]>
  >(async () => []);

  /** Archived tasks are read-only (TV-U6): left out, quietly. */
  const isArchived = useCallback(
    (taskId: string) =>
      store?.getSnapshot().bundle.archivedTasks?.some((t) => t.id === taskId) ?? false,
    [store],
  );

  /**
   * Save one write per task as one store write: every row shows the change at
   * once; each task's ops go to the server (field edit, occurrence, status,
   * assignee, in that order); the rows that saved settle, the refused ones
   * show the server's again; then one toast with one Undo. Resolves to the
   * ids that changed.
   */
  const bulkWrite = useCallback(
    async (writes: readonly BulkWrite[], opts: BulkWriteOptions): Promise<string[]> => {
      if (writes.length === 0) return [];
      if (editBlocked() || !store || !runtime || !workspaceId) return [];
      const rt = runtime;
      const ws = workspaceId;
      const followers = opts.followers ?? new Set<string>();
      const now = new Date();
      const stamp = now.toISOString();
      const lineupBefore = myQueueRef.current.map((e) => e.taskId);
      const byId = new Map(tasksRef.current.map((t) => [t.id, t]));
      const refused = new Map<string, BulkRefusal>();
      const planned: Planned[] = [];
      const changes: OverlayChange[] = [];
      for (const write of writes) {
        const before = byId.get(write.taskId);
        if (!before || before.deletedAt) continue;
        if (isTempId(write.taskId)) {
          refused.set(write.taskId, { title: before.title, message: "It’s still saving." });
          continue;
        }
        if (isArchived(write.taskId)) {
          refused.set(write.taskId, { title: before.title, message: "Its project is archived." });
          continue;
        }
        const category = write.status === undefined ? undefined : statusKeyCategory(write.status);
        // A status op carries the rule: Undo's own (the one before), else the
        // check-off advances a repeat's pointer (spec §5d).
        const statusRecurrence =
          category === undefined
            ? undefined
            : write.recurrence !== undefined
              ? write.recurrence
              : (recurrenceOnStatusChange(before, legacyTaskStatus(category), now, engineZone()) ??
                undefined);
        const fields = editableTaskFields({
          parentId: write.parentId,
          bucketId: write.bucketId,
          priority: write.priority,
          sectionId: write.sectionId,
          teamId: write.teamId,
          // The place and the rule ride with the status op when there is one.
          position: category === undefined ? write.position : undefined,
          dueDate: write.dueDate,
          recurrence: category === undefined ? write.recurrence : undefined,
        });
        const moving = write.bucketId !== undefined && write.bucketId !== before.bucketId;
        const follow =
          category !== undefined
            ? queueFollowStatus(write.taskId, category)
            : { changes: [], rowIds: [] };
        const shown: Partial<Task> = {
          ...fields,
          ...(write.position !== undefined ? { position: write.position } : {}),
          ...(write.dueDate !== undefined
            ? { dueDate: write.dueDate, dueOn: localDayOf(write.dueDate) }
            : {}),
          ...(write.occurrenceOn !== undefined
            ? { dueOn: write.occurrenceOn, dueDate: dueOnToLocalInstant(write.occurrenceOn) }
            : {}),
          ...(category !== undefined
            ? optimisticStatus(
                before,
                write.statusId ? { statusId: write.statusId } : { category },
                statusesForBucket(write.bucketId ?? before.bucketId),
              )
            : {}),
          ...(statusRecurrence !== undefined ? { recurrence: statusRecurrence } : {}),
          ...(write.assigneeId !== undefined ? { assigneeId: write.assigneeId } : {}),
          updatedAt: stamp,
        };
        changes.push(patchOf(write.taskId, shown), ...follow.changes);
        // A parent's subtasks show in the new project at once (the server
        // carries the ones this person can edit).
        if (moving) {
          for (const t of tasksRef.current) {
            if (t.parentId === write.taskId && !t.deletedAt && t.bucketId !== write.bucketId) {
              changes.push(patchOf(t.id, { bucketId: write.bucketId }));
            }
          }
        }
        planned.push({
          write,
          before,
          category,
          statusRecurrence,
          fields,
          moving,
          queueRows: follow.rowIds,
        });
      }
      if (planned.length === 0) {
        if (refused.size > 0) {
          const text = bulkResultText("", {
            changed: 0,
            total: refused.size,
            refused: [...refused.values()],
          });
          toast.error(text.title, { description: text.description });
        }
        return [];
      }

      const shown = store.begin(changes);
      const saved = new Map<string, Task>();
      const changed: Planned[] = [];
      let offlineError: unknown = null;
      const notRun = await runPool(
        planned,
        async (p) => {
          const { write, before } = p;
          const rows: Task[] = [];
          try {
            if (Object.keys(p.fields).length > 0) {
              // A move is one op: the server moves the subtasks with it and
              // answers with every row it changed (TV-D8).
              if (p.moving) {
                rows.push(
                  ...(await rt.tasks.opUpdateTask({
                    workspaceId: ws,
                    taskId: write.taskId,
                    patch: p.fields,
                  })),
                );
              } else {
                rows.push(
                  await rt.tasks.updateTask({
                    workspaceId: ws,
                    taskId: write.taskId,
                    patch: p.fields,
                  }),
                );
              }
            }
            if (write.occurrenceOn !== undefined) {
              rows.push(
                await rt.tasks.opMoveOccurrence({
                  workspaceId: ws,
                  taskId: write.taskId,
                  dueOn: write.occurrenceOn,
                }),
              );
            }
            if (p.category !== undefined) {
              rows.push(
                await rt.tasks.opSetStatus({
                  workspaceId: ws,
                  taskId: write.taskId,
                  status: write.statusId ?? taskStatusWord(p.category),
                  recurrence: p.statusRecurrence,
                  position: write.position,
                }),
              );
            }
            if (write.assigneeId !== undefined) {
              rows.push(
                await rt.tasks.opAssign({
                  workspaceId: ws,
                  taskId: write.taskId,
                  assigneeId: write.assigneeId,
                }),
              );
            }
            changed.push(p);
          } catch (e) {
            if (isNetworkError(e)) offlineError = e;
            else refused.set(write.taskId, { title: before.title, message: messageOf(e) });
          } finally {
            // What saved stays, even when a later op of the same task didn't.
            for (const row of rows) saved.set(row.id, row);
          }
        },
        () => offlineError !== null,
      );
      shown.settle({ tasks: [...saved.values()] });
      const forget = changed.flatMap((p) => (p.category !== undefined ? p.queueRows : []));
      if (forget.length > 0) store.forget("queue", forget);
      // Someone else's unfiled task handed on into another Inbox is out of my
      // sight now (TV-D13, as `patchTask` does for one).
      const gone: string[] = [];
      for (const p of changed) {
        if (p.write.assigneeId === undefined) continue;
        const row = saved.get(p.write.taskId);
        if (
          row &&
          row.bucketId !== p.before.bucketId &&
          !bucketsRef.current.some((b) => b.id === row.bucketId) &&
          row.creatorId !== userId &&
          row.assigneeId !== userId
        ) {
          gone.push(row.id);
          for (const t of tasksRef.current) {
            if (t.parentId === row.id && t.bucketId === p.before.bucketId) gone.push(t.id);
          }
        }
      }
      if (gone.length > 0) store.forget("tasks", gone);
      if (changed.length > 0) onSaved();
      if (offlineError) failed(offlineError, "");

      const mainChanged = changed.filter((p) => !followers.has(p.write.taskId)).length;
      const followersChanged = changed.length - mainChanged;
      // A subtask brought along is never named (it may not be one you chose).
      const mainRefused = [...refused.entries()]
        .filter(([id]) => !followers.has(id))
        .map(([, r]) => r);
      // What the connection didn't let us send isn't counted either way.
      const unsent = notRun.filter((p) => !followers.has(p.write.taskId)).length;
      const text = bulkResultText(opts.label(mainChanged, followersChanged), {
        changed: mainChanged,
        total: mainChanged + mainRefused.length,
        refused: mainRefused,
      });
      if (unsent > 0 && !text.description) text.description = `${tasksWord(unsent)} waiting for the connection weren’t sent.`;
      if (changed.length === 0) {
        if (mainRefused.length > 0) toast.error(text.title, { description: text.description });
        return [];
      }
      if (opts.undoable === false) {
        if (mainRefused.length > 0) toast(text.title, { description: text.description });
        return changed.map((p) => p.write.taskId);
      }
      undoToast(text.title, {
        description: text.description,
        onUndo: () => {
          const reverse: BulkWrite[] = [];
          let kept = 0;
          for (const p of changed) {
            const after = saved.get(p.write.taskId);
            const current = tasksRef.current.find((t) => t.id === p.write.taskId);
            if (!after || !current || current.deletedAt) continue;
            const back: BulkWrite = { taskId: p.write.taskId };
            let keptHere = false;
            const drop = undoWrite({ write: p.write, before: p.before, after, current });
            if (drop.write) Object.assign(back, drop.write);
            if (drop.kept.length > 0) keptHere = true;
            if (p.write.dueDate !== undefined || p.write.occurrenceOn !== undefined) {
              const day = dueDayOf(current);
              if (day !== dueDayOf(after)) keptHere = true;
              else if (day !== dueDayOf(p.before)) {
                const was = dueDayOf(p.before);
                if (p.write.occurrenceOn !== undefined && was) back.occurrenceOn = was;
                else back.dueDate = p.before.dueDate ?? null;
              }
            }
            if (p.write.recurrence !== undefined && p.category === undefined) {
              if (current.recurrence?.rrule === after.recurrence?.rrule) {
                back.recurrence = p.before.recurrence ?? null;
              } else keptHere = true;
            }
            // A status going back takes its repeat rule back too, unless the
            // rule was edited since (as a drop's Undo does).
            if (back.status !== undefined) {
              back.recurrence =
                JSON.stringify(current.recurrence) === JSON.stringify(after.recurrence)
                  ? (p.before.recurrence ?? null)
                  : (current.recurrence ?? null);
            }
            if (keptHere) kept += 1;
            if (Object.keys(back).length > 1) reverse.push(back);
          }
          if (kept > 0) toast(`Undo kept a newer change to ${tasksWord(kept)}.`);
          if (reverse.length === 0) return;
          void latestBulkWrite.current(reverse, { label: () => "Undone", undoable: false }).then((back) => {
            // Back to open from a check-off that closed it: its queue place too.
            const queuedBefore = new Set(lineupBefore);
            for (const id of back) {
              const p = changed.find((c) => c.write.taskId === id);
              if (p?.category !== undefined && queuedBefore.has(id)) {
                restoreQueuePlace(id, lineupBefore);
              }
            }
          });
        },
      });
      return changed.map((p) => p.write.taskId);
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are read at call time.
    [
      store,
      runtime,
      workspaceId,
      userId,
      editBlocked,
      isArchived,
      statusesForBucket,
      queueFollowStatus,
      failed,
      onSaved,
      restoreQueuePlace,
    ],
  );
  // Undo calls the newest `bulkWrite` (it runs seconds later).
  latestBulkWrite.current = bulkWrite;

  /**
   * Delete several tasks as one write with one Undo (soft deletes; their
   * subtasks become top-level, as one delete does, and Undo re-attaches them).
   */
  const bulkDelete = useCallback(
    async (ids: readonly string[]) => {
      if (editBlocked() || !store || !runtime || !workspaceId) return;
      const rt = runtime;
      const ws = workspaceId;
      const refused = new Map<string, BulkRefusal>();
      const targets: Task[] = [];
      for (const id of ids) {
        const t = tasksRef.current.find((x) => x.id === id);
        if (!t || t.deletedAt) continue;
        if (isTempId(id) || isArchived(id)) {
          refused.set(id, { title: t.title, message: "It can’t be deleted right now." });
          continue;
        }
        targets.push(t);
      }
      if (targets.length === 0) return;
      const deleting = new Set(targets.map((t) => t.id));
      const children = tasksRef.current.filter(
        (t) => t.parentId && deleting.has(t.parentId) && !t.deletedAt && !deleting.has(t.id),
      );
      const follows = targets.map((t) => queueFollowStatus(t.id, "deleted"));
      const write = store.begin([
        ...targets.map((t) => ({ table: "tasks", remove: t.id }) as OverlayChange),
        ...children.map((c) => patchOf(c.id, { parentId: null })),
        ...follows.flatMap((f) => f.changes),
      ]);
      const deleted: Task[] = [];
      let offlineError: unknown = null;
      await runPool(
        targets,
        async (t) => {
          try {
            deleted.push(await rt.tasks.deleteTask({ workspaceId: ws, taskId: t.id }));
          } catch (e) {
            if (isNetworkError(e)) offlineError = e;
            else refused.set(t.id, { title: t.title, message: messageOf(e) });
          }
        },
        () => offlineError !== null,
      );
      write.settle({ tasks: deleted });
      const done = new Set(deleted.map((t) => t.id));
      const promoted = children.filter((c) => c.parentId && done.has(c.parentId));
      for (const c of promoted) store.patchCopy("tasks", c.id, { parentId: null });
      store.forget(
        "queue",
        follows.flatMap((f, i) => (done.has(targets[i].id) ? f.rowIds : [])),
      );
      if (offlineError) failed(offlineError, "");
      if (done.size > 0) {
        onSaved();
        void reloadTrash();
      }
      const text = bulkResultText(`Deleted ${tasksWord(done.size)}`, {
        changed: done.size,
        total: targets.length + refused.size,
        refused: [...refused.values()],
      });
      if (done.size === 0) {
        if (refused.size > 0) toast.error(text.title, { description: text.description });
        return;
      }
      undoToast(text.title, {
        description: text.description,
        onUndo: () => {
          void (async () => {
            const rows: Task[] = [];
            await runPool(
              [...done],
              async (id) => {
                rows.push(
                  await rt.tasks.updateTask({
                    workspaceId: ws,
                    taskId: id,
                    patch: { deletedAt: null },
                  }),
                );
              },
              () => false,
            );
            // Re-attach the subtasks still at the top level.
            await runPool(
              promoted.filter((c) => {
                const now = tasksRef.current.find((t) => t.id === c.id);
                return !now || now.parentId === null;
              }),
              async (c) => {
                rows.push(
                  await rt.tasks.updateTask({
                    workspaceId: ws,
                    taskId: c.id,
                    patch: { parentId: c.parentId },
                  }),
                );
              },
              () => false,
            );
            store.answer({ tasks: rows });
            onSaved();
            await reloadTrash();
          })().catch(() => toast.error("Couldn’t restore every task."));
        },
      });
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are read at call time.
    [
      editBlocked,
      store,
      runtime,
      workspaceId,
      isArchived,
      queueFollowStatus,
      failed,
      onSaved,
      reloadTrash,
    ],
  );

  /**
   * Focus (Q) on a selection: add the ones not in my line-up yet, at its end,
   * in order; or, when every one is in it already, take them all out. One
   * queue op, one Undo.
   */
  const bulkQueue = useCallback(
    (ids: readonly string[]) => {
      if (!store) return;
      const mine = new Set(myQueueRef.current.map((e) => e.taskId));
      const tasks = ids
        .map((id) => tasksRef.current.find((t) => t.id === id))
        .filter((t): t is Task => !!t && !t.deletedAt && !isTempId(t.id));
      const open = tasks.filter((t) => t.status !== "done" && t.status !== "archived");
      const removing = open.length > 0 && open.every((t) => mine.has(t.id));
      const queueAdd = (list: readonly string[], onSaved: () => void) => {
        // Queuing a backlog task moves it to To do (the server does it).
        const toTodo = list
          .map((id) => tasksRef.current.find((t) => t.id === id))
          .flatMap((t) => {
            const fields = t ? backlogToTodo(t) : null;
            return t && fields ? [patchOf(t.id, fields)] : [];
          });
        const shownTodo = toTodo.length > 0 ? store.begin(toTodo) : null;
        const started = runQueueOp(
          (lineup) => {
            const rest = lineup.filter((e) => !list.includes(e.taskId));
            let prev = endOfQueue(rest);
            const added: TaskQueueEntry[] = [];
            for (const id of list) {
              added.push(optimisticEntry(id, prev));
              prev = betweenPositions(prev, null);
            }
            return [...rest, ...added];
          },
          async (rt, ws) => {
            let last: TaskQueueEntry[] | null = null;
            let firstError: unknown = null;
            for (const id of list) {
              try {
                last = await rt.tasks.opQueueAdd({ workspaceId: ws, taskId: id, at: "end" });
              } catch (e) {
                if (isNetworkError(e)) throw e;
                firstError ??= e;
              }
            }
            if (!last) {
              shownTodo?.fail();
              throw firstError ?? new Error("Couldn’t add them to Focus.");
            }
            return last;
          },
          () => {
            onSaved();
            if (shownTodo) void store.syncNow().finally(() => shownTodo.settle());
          },
        );
        if (!started) shownTodo?.fail();
      };
      const queueRemove = (list: readonly string[], onSaved: () => void) => {
        runQueueOp(
          (lineup) => lineup.filter((e) => !list.includes(e.taskId)),
          async (rt, ws) => {
            let last: TaskQueueEntry[] = [];
            for (const id of list) {
              last = await rt.tasks.opQueueRemove({ workspaceId: ws, taskId: id });
            }
            return last;
          },
          onSaved,
        );
      };
      if (removing) {
        const list = open.map((t) => t.id);
        queueRemove(list, () =>
          undoToast(`Removed ${tasksWord(list.length)} from Focus`, {
            onUndo: () => queueAdd(list, () => {}),
          }),
        );
        return;
      }
      const list = open.filter((t) => !mine.has(t.id)).map((t) => t.id);
      if (list.length === 0) {
        toast("Done and Won’t do tasks can’t be added to Focus.");
        return;
      }
      queueAdd(list, () =>
        undoToast(`Added ${tasksWord(list.length)} to Focus`, {
          onUndo: () => queueRemove(list, () => {}),
        }),
      );
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are read at call time.
    [store, runQueueOp, optimisticEntry, backlogToTodo],
  );

  /** Waiting on someone or something, for each task: one write, one Undo. */
  const bulkWaiting = useCallback(
    async (
      ids: readonly string[],
      entry: { kind: TaskWaitingEntry["kind"]; ref?: string | null; label?: string | null },
      label: string,
      existing: readonly TaskWaitingEntry[],
    ) => {
      if (editBlocked() || !store || !runtime || !workspaceId) return;
      const rt = runtime;
      const ws = workspaceId;
      const now = new Date().toISOString();
      // Already waiting on that person: left as it is.
      const waitingAlready = new Set(
        entry.kind === "person"
          ? existing.filter((e) => e.kind === "person" && e.ref === entry.ref).map((e) => e.taskId)
          : [],
      );
      const tasks = ids
        .map((id) => tasksRef.current.find((t) => t.id === id))
        .filter(
          (t): t is Task =>
            !!t && !t.deletedAt && !isTempId(t.id) && !isArchived(t.id) && !waitingAlready.has(t.id),
        );
      if (tasks.length === 0) return;
      const shownRows = tasks.map(
        (t): TaskWaitingEntry => ({
          id: crypto.randomUUID(),
          workspaceId: ws,
          taskId: t.id,
          kind: entry.kind,
          ref: entry.ref ?? null,
          label: entry.label ?? null,
          since: now,
          createdBy: userId,
          updatedAt: now,
        }),
      );
      const write = store.begin(shownRows.map((r) => ({ table: "waiting", insert: r })));
      const rows: TaskWaitingEntry[] = [];
      const added: TaskWaitingEntry[] = [];
      const refused: BulkRefusal[] = [];
      let offlineError: unknown = null;
      await runPool(
        shownRows,
        async (r) => {
          try {
            rows.push(
              ...(await rt.tasks.addWaiting({
                workspaceId: ws,
                taskId: r.taskId,
                id: r.id,
                kind: r.kind,
                ref: r.ref,
                label: r.label,
              })),
            );
            added.push(r);
          } catch (e) {
            if (isNetworkError(e)) offlineError = e;
            else {
              const t = tasks.find((x) => x.id === r.taskId);
              refused.push({ title: t?.title ?? "", message: messageOf(e) });
            }
          }
        },
        () => offlineError !== null,
      );
      write.settle({ waiting: rows });
      if (offlineError) failed(offlineError, "");
      if (added.length > 0) onSaved();
      const text = bulkResultText(`${tasksWord(added.length)} waiting on ${label}`, {
        changed: added.length,
        total: tasks.length,
        refused,
      });
      if (added.length === 0) {
        if (refused.length > 0) toast.error(text.title, { description: text.description });
        return;
      }
      undoToast(text.title, {
        description: text.description,
        onUndo: () => {
          const back = store.begin(added.map((r) => ({ table: "waiting", remove: r.id })));
          void (async () => {
            const left: TaskWaitingEntry[] = [];
            await runPool(
              added,
              async (r) => {
                left.push(...(await rt.tasks.removeWaiting({ workspaceId: ws, entryId: r.id })));
              },
              () => false,
            );
            store.forget(
              "waiting",
              added.map((r) => r.id),
            );
            back.settle({ waiting: left });
            onSaved();
          })().catch((e) => {
            back.fail();
            failed(e, "Couldn’t undo it.");
          });
        },
      });
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are read at call time.
    [editBlocked, store, runtime, workspaceId, userId, isArchived, failed, onSaved],
  );

  /**
   * A tag on every task of a selection, or off every one when they all have
   * it: one toast, one Undo (tags live in the workspace tag store, TV-T1).
   */
  const bulkTag = useCallback(
    async (ids: readonly string[], tag: { id: string; name: string }, has: (id: string) => boolean) => {
      const ctx = tagContext();
      if (!ctx) return;
      const tasks = ids
        .map((id) => tasksRef.current.find((t) => t.id === id))
        .filter((t): t is Task => !!t && !t.deletedAt && !isTempId(t.id) && !isArchived(t.id));
      if (tasks.length === 0) return;
      const removing = tasks.every((t) => has(t.id));
      const touched = tasks.filter((t) => has(t.id) === removing);
      const entities = touched.map((t) => ({ entityType: "task", entityId: t.id }));
      const result = await attachOrDetachMany(ctx, tag.id, entities, !removing);
      const okIds = new Set(result.changed.map((e) => e.entityId));
      const refused = result.failed.map((f) => ({
        title: touched.find((t) => t.id === f.entity.entityId)?.title ?? "",
        message: f.message,
      }));
      const label = removing
        ? `Removed “${tag.name}” from ${tasksWord(okIds.size)}`
        : `Tagged ${tasksWord(okIds.size)} “${tag.name}”`;
      const text = bulkResultText(label, {
        changed: okIds.size,
        total: touched.length,
        refused,
      });
      if (okIds.size === 0) {
        if (refused.length > 0) toast.error(text.title, { description: text.description });
        return;
      }
      undoToast(text.title, {
        description: text.description,
        onUndo: () => {
          void attachOrDetachMany(ctx, tag.id, result.changed, removing).then((r) => {
            if (r.failed.length > 0) toast.error("Couldn’t undo every tag.");
          });
        },
      });
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are read at call time.
    [tagContext, isArchived],
  );

  return { bulkWrite, bulkDelete, bulkQueue, bulkWaiting, bulkTag };
}

export type BulkOps = ReturnType<typeof useBulkOps>;
