// The bulk writes (tasks-v3 §4, calls 82b and a/e; TV-U12): a selection's
// change as ONE write on the store and ONE Undo. Every task still goes
// through its own server op (which checks that person may edit that task),
// so a partly refused batch keeps what saved and says "3 of 4 changed". This
// file holds the field write (`bulkWrite`); `bulk.ts` the delete, queue,
// Waiting on and tag ones.

import { legacyTaskStatus, type TaskStatusCategory, taskStatusWord } from "@contracts/vocabularies";
import { toast } from "sonner";
import { isNetworkError } from "../../../lib/sync/network";
import type { OverlayChange, WorkspaceStore } from "../../../lib/sync/store";
import { dueOnToLocalInstant, editableTaskFields, withDueOn } from "../../../lib/task-rows";
import { undoToast } from "../../../lib/undo-toast";
import { type BulkRefusal, type BulkWrite, bulkResultText, dueDayOf, tasksWord } from "../bulk";
import { undoWrite } from "../dnd/drop-write";
import type { RecurrenceRule, Task } from "../model";
import { engineZone, recurrenceOnStatusChange } from "../recurrence-engine";
import { optimisticStatus, statusKeyCategory } from "../statuses";
import type { TaskCommandsContext, TaskPeers } from "./context";
import { isTempId, patchOf, type Shared } from "./shared";

/** How many tasks' ops are in flight at once. */
const POOL = 4;

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

/**
 * Run `work` over `items`, a few at a time. Stops starting new ones once
 * `stop()` says so (the connection went); those are reported as not run.
 */
export async function runPool<T>(
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

/** Archived tasks are read-only (TV-U6): left out, quietly. */
export const isArchivedIn = (store: WorkspaceStore | null, taskId: string): boolean =>
  store?.getSnapshot().bundle.archivedTasks?.some((t) => t.id === taskId) ?? false;

export type BulkWriteOptions = {
  /** What the toast says once `main` selected tasks and `followers` brought along changed. */
  label: (main: number, followers: number) => string;
  /** Tasks the change brought along (a finished parent's subtasks): counted apart, never named. */
  followers?: ReadonlySet<string>;
  /** False for Undo's own write: no second Undo, and quiet unless something was refused. */
  undoable?: boolean;
  /**
   * A quiet follow-up in the toast's body, offered once the change saved
   * (the Timeline's "Also move the 3 that wait on this", TV-TL2). It gets the
   * ids that changed and this change's own Undo: clicking the link closes this
   * toast, so the follow-up's write hands that Undo on (`alsoUndo`) and one
   * Undo puts both back.
   */
  followUp?: (
    changed: readonly string[],
    undoThis: () => void,
  ) => { label: string; onClick: () => void } | null;
  /** Undo of this write also undoes this (the change it followed up). */
  alsoUndo?: () => void;
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
  /** The work session a reschedule moves with the task (kept on show until its row comes back). */
  sessionMove: SessionMove | null;
};

type SessionMove = { id: string; fields: { startsAt: string; endsAt: string } };

export function createBulkWrite(ctx: TaskCommandsContext, shared: Shared, peers: TaskPeers) {
  const { store, runtime, workspaceId, userId, data, bumpActivity } = ctx;
  const { editBlocked, failed, queueFollowStatus, statusesForBucket } = shared;

  /** The session a reschedule moves: the one that starts at the task's old time. */
  const movedSession = (write: BulkWrite, before: Task): SessionMove | null => {
    if (write.scheduledAt === undefined || !before.scheduledAt || !store) return null;
    const from = Date.parse(before.scheduledAt);
    const by = Date.parse(write.scheduledAt) - from;
    if (!Number.isFinite(by)) return null;
    const session = store
      .getSnapshot()
      .sessions.find((s) => s.taskId === write.taskId && Date.parse(s.startsAt) === from);
    if (!session) return null;
    return {
      id: session.id,
      fields: {
        startsAt: new Date(Date.parse(session.startsAt) + by).toISOString(),
        endsAt: new Date(Date.parse(session.endsAt) + by).toISOString(),
      },
    };
  };

  const isArchived = (taskId: string) => isArchivedIn(store, taskId);

  /**
   * Save one write per task as one store write: every row shows the change at
   * once; each task's ops go to the server (field edit, occurrence, status,
   * assignee, in that order); the rows that saved settle, the refused ones
   * show the server's again; then one toast with one Undo. Resolves to the
   * ids that changed.
   */
  const bulkWrite = async (
    writes: readonly BulkWrite[],
    opts: BulkWriteOptions,
  ): Promise<string[]> => {
    if (writes.length === 0) return [];
    if (editBlocked() || !store || !runtime || !workspaceId) return [];
    const rt = runtime;
    const ws = workspaceId;
    const followers = opts.followers ?? new Set<string>();
    const now = new Date();
    const stamp = now.toISOString();
    const lineupBefore = data().myQueueEntries.map((e) => e.taskId);
    const byId = new Map(data().allTasks.map((t) => [t.id, t]));
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
        ...(write.dueDate !== undefined ? withDueOn({ dueDate: write.dueDate }) : {}),
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
        ...(write.scheduledAt !== undefined ? { scheduledAt: write.scheduledAt } : {}),
        updatedAt: stamp,
      };
      changes.push(patchOf(write.taskId, shown), ...follow.changes);
      // A session moved (the Timeline's hollow point): the session the task
      // shows moves with it at once, as the server moves it (the one that
      // started at the old time), so the row doesn't wait for the echo.
      const sessionMove = movedSession(write, before);
      if (sessionMove) {
        changes.push({
          table: "sessions",
          patch: { id: sessionMove.id, fields: sessionMove.fields },
        });
      }
      // A parent's subtasks show in the new project at once (the server
      // carries the ones this person can edit).
      if (moving) {
        for (const t of data().allTasks) {
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
        sessionMove,
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
    // Part of the task's change saved before a later op of it was refused
    // (or the connection went): it's named, and Undo still puts that part back.
    const partial: Planned[] = [];
    const statusSaved = new Set<string>();
    const assignSaved = new Set<string>();
    const sessionSaved = new Set<string>();
    let offlineError: unknown = null;
    const notRun = await runPool(
      planned,
      async (p) => {
        const { write, before } = p;
        const rows: Task[] = [];
        let landed = false;
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
            landed = true;
          }
          if (write.occurrenceOn !== undefined) {
            rows.push(
              await rt.tasks.opMoveOccurrence({
                workspaceId: ws,
                taskId: write.taskId,
                dueOn: write.occurrenceOn,
              }),
            );
            landed = true;
          }
          if (write.scheduledAt !== undefined) {
            rows.push(
              await rt.tasks.opReschedule({
                workspaceId: ws,
                taskId: write.taskId,
                scheduledAt: write.scheduledAt,
              }),
            );
            sessionSaved.add(write.taskId);
            landed = true;
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
            statusSaved.add(write.taskId);
            landed = true;
          }
          if (write.assigneeId !== undefined) {
            rows.push(
              await rt.tasks.opAssign({
                workspaceId: ws,
                taskId: write.taskId,
                assigneeId: write.assigneeId,
              }),
            );
            assignSaved.add(write.taskId);
          }
          changed.push(p);
        } catch (e) {
          if (landed) partial.push(p);
          if (isNetworkError(e)) {
            offlineError = e;
            // Cut off after part of it saved: named too, so the count adds up.
            if (landed) {
              refused.set(write.taskId, {
                title: before.title,
                message: "The connection went before the rest saved.",
                partial: true,
              });
            }
          } else {
            refused.set(write.taskId, {
              title: before.title,
              message: messageOf(e),
              ...(landed ? { partial: true } : {}),
            });
          }
        } finally {
          // What saved stays, even when a later op of the same task didn't.
          for (const row of rows) saved.set(row.id, row);
        }
      },
      () => offlineError !== null,
    );
    shown.settle({ tasks: [...saved.values()] });
    // What Undo puts back: every task with a part that saved.
    const landedAny = [...changed, ...partial];
    // A moved session stays where it went until its own row comes back.
    for (const p of landedAny) {
      if (p.sessionMove && sessionSaved.has(p.write.taskId)) {
        store.patchCopy("sessions", p.sessionMove.id, p.sessionMove.fields);
      }
    }
    // A refused check-off isn't kept on show in my queue (as one drop's isn't).
    for (const p of planned) {
      if (p.category !== undefined && !statusSaved.has(p.write.taskId)) {
        store.unkeep(p.write.taskId);
      }
    }
    const forget = planned.flatMap((p) =>
      p.category !== undefined && statusSaved.has(p.write.taskId) ? p.queueRows : [],
    );
    if (forget.length > 0) store.forget("queue", forget);
    // Someone else's unfiled task handed on into another Inbox is out of my
    // sight now (TV-D13, as `patchTask` does for one).
    const gone: string[] = [];
    for (const p of changed) {
      if (p.write.assigneeId === undefined || !assignSaved.has(p.write.taskId)) continue;
      const row = saved.get(p.write.taskId);
      if (
        row &&
        row.bucketId !== p.before.bucketId &&
        !data().allBuckets.some((b) => b.id === row.bucketId) &&
        row.creatorId !== userId &&
        row.assigneeId !== userId
      ) {
        gone.push(row.id);
        for (const t of data().allTasks) {
          if (t.parentId === row.id && t.bucketId === p.before.bucketId) gone.push(t.id);
        }
      }
    }
    if (gone.length > 0) store.forget("tasks", gone);
    if (landedAny.length > 0) bumpActivity();
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
    if (unsent > 0 && !text.description)
      text.description = `${tasksWord(unsent)} waiting for the connection weren’t sent.`;
    if (landedAny.length === 0) {
      if (mainRefused.length > 0) toast.error(text.title, { description: text.description });
      return [];
    }
    if (opts.undoable === false) {
      if (mainRefused.length > 0) toast(text.title, { description: text.description });
      return landedAny.map((p) => p.write.taskId);
    }
    // This change's Undo: what each task changed goes back, unless it changed since.
    const undoThis = () => {
      const reverse: BulkWrite[] = [];
      let kept = 0;
      for (const p of landedAny) {
        const after = saved.get(p.write.taskId);
        const current = data().allTasks.find((t) => t.id === p.write.taskId);
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
        // A moved session goes back, unless it moved again since.
        if (
          p.write.scheduledAt !== undefined &&
          p.before.scheduledAt &&
          sessionSaved.has(p.write.taskId)
        ) {
          if (current.scheduledAt === after.scheduledAt) {
            if (current.scheduledAt !== p.before.scheduledAt) {
              back.scheduledAt = p.before.scheduledAt;
            }
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
      void bulkWrite(reverse, { label: () => "Undone", undoable: false }).then((back) => {
        // Back to open from a check-off that closed it: its queue place too.
        const queuedBefore = new Set(lineupBefore);
        for (const id of back) {
          if (statusSaved.has(id) && queuedBefore.has(id)) {
            peers.restoreQueuePlace(id, lineupBefore);
          }
        }
      });
    };
    const followUp =
      opts.followUp?.(
        landedAny.map((p) => p.write.taskId),
        undoThis,
      ) ?? undefined;
    undoToast(text.title, {
      description: text.description,
      link: followUp,
      onUndo: () => {
        undoThis();
        // A follow-up's Undo puts back the change it followed, too.
        opts.alsoUndo?.();
      },
    });
    return landedAny.map((p) => p.write.taskId);
  };

  return { bulkWrite };
}
