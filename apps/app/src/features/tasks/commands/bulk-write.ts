// The bulk writes (tasks-v3 §4, calls 82b and a/e; TV-U12): a selection's
// change as ONE write on the store and ONE Undo. Every task still goes
// through its own server op (which checks that person may edit that task),
// so a partly refused batch keeps what saved and says "3 of 4 changed". This
// file holds the field write (`bulkWrite`); `bulk.ts` the delete, queue,
// Waiting on and tag ones.

import { type TaskStatusCategory, taskStatusWord } from "@contracts/vocabularies";
import { toast } from "sonner";

import { isNetworkError } from "../../../lib/sync/network";
import type { OverlayChange, WorkspaceStore } from "../../../lib/sync/store";
import type { TaskFieldPatch } from "../../../lib/task-rows";
import { undoToast } from "../../../lib/undo-toast";
import { type BulkRefusal, bulkResultText, type BulkWrite, dueDayOf, tasksWord } from "../bulk";
import { byIdOf } from "../derived";
import { undoWrite } from "../dnd/drop-write";
import type { RecurrenceRule, Task } from "../model";
import { handedOutOfSight, patchOfWrite, planTaskWrite, type WriteRefusal } from "../write-plan";
import type { TaskCommandsContext, TaskPeers } from "./context";
import { NO_EDIT, type Shared } from "./shared";

/** What a selection's toast says of a task that was left out. */
const REFUSED: Record<WriteRefusal, string | null> = {
  "no-edit": NO_EDIT,
  deleted: null,
  "still-saving": "It’s still saving.",
  archived: "Its project is archived.",
};

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
  fields: TaskFieldPatch;
  /** What the task shows (a status part that waits on the device shows it until it goes). */
  shown: Partial<Task>;
  moving: boolean;
  queueRows: string[];
  /** The work session a reschedule moves with the task (kept on show until its row comes back). */
  sessionMove: SessionMove | null;
};

type SessionMove = { id: string; fields: { startsAt: string; endsAt: string } };

export function createBulkWrite(ctx: TaskCommandsContext, shared: Shared, peers: TaskPeers) {
  const { store, runtime, workspaceId, data, bumpActivity } = ctx;
  const { applyQueueFollow, editBlocked, failed, planContext } = shared;

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
    const lineupBefore = data().myQueueEntries.map((e) => e.taskId);
    const byId = byIdOf(data().allTasks);
    // The rules are `planTaskWrite`'s, as for one task's edit; this side
    // only runs the ops.
    const planCtx = planContext();
    const refused = new Map<string, BulkRefusal>();
    const planned: Planned[] = [];
    const changes: OverlayChange[] = [];
    for (const write of writes) {
      const before = byId.get(write.taskId);
      if (!before) continue;
      const plan = planTaskWrite(before, patchOfWrite(write), planCtx);
      if (plan.kind === "noop") continue;
      if (plan.kind === "refused") {
        // A deleted task is left out quietly; archived ones are read-only
        // (TV-U6), and one still saving can't be written yet.
        const message = REFUSED[plan.reason];
        if (message) refused.set(write.taskId, { title: before.title, message });
        continue;
      }
      // The status op carries the rule: Undo's own (the one before), else the
      // check-off advances a repeat's pointer (spec §5d); the place and the
      // rule ride with it. Done, archived or backlog leaves every queue.
      if (plan.status) applyQueueFollow(write.taskId, plan.queue);
      // The task, a parent's subtasks shown in the new project at once (the
      // server carries the ones this person can edit), the queue rows a
      // status change takes out.
      changes.push(...plan.overlay);
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
      planned.push({
        write,
        before,
        category: plan.status?.category,
        statusRecurrence: plan.status?.recurrence,
        fields: plan.fields,
        shown: plan.shown,
        moving: plan.moving,
        queueRows: plan.queue.rowIds,
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
    // A status part that waits on the device behind an older check-off.
    const statusQueued = new Set<string>();
    const assignSaved = new Set<string>();
    const sessionSaved = new Set<string>();
    let offlineError: unknown = null;
    /** One task's status op: its server row, or null when it waits on the device. */
    const sendStatusPart = async (p: Planned, category: TaskStatusCategory) => {
      const { write } = p;
      const status = write.statusId ?? taskStatusWord(category);
      if (store.statusMustWait(write.taskId)) {
        // An older check-off for it is still on its way (MOD-561): this one
        // waits on the device behind it, or the older one would land last.
        void store.enqueue({
          kind: "status",
          id: crypto.randomUUID(),
          taskId: write.taskId,
          status,
          recurrence: p.statusRecurrence,
          ...(write.position !== undefined ? { position: write.position } : {}),
          fields: p.shown,
        });
        statusQueued.add(write.taskId);
        return null;
      }
      const row = await store.sendingStatus(
        write.taskId,
        rt.tasks.opSetStatus({
          workspaceId: ws,
          taskId: write.taskId,
          status,
          recurrence: p.statusRecurrence,
          position: write.position,
        }),
      );
      statusSaved.add(write.taskId);
      return row;
    };
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
            const row = await sendStatusPart(p, p.category);
            if (row) rows.push(row);
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
      if (
        p.category !== undefined &&
        !statusSaved.has(p.write.taskId) &&
        !statusQueued.has(p.write.taskId)
      ) {
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
    const sight = planContext();
    for (const p of changed) {
      if (p.write.assigneeId === undefined || !assignSaved.has(p.write.taskId)) continue;
      const row = saved.get(p.write.taskId);
      if (row) gone.push(...handedOutOfSight(row, p.before, sight));
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
        // A status part that waited on the device has no server row yet:
        // what the person made (and shows meanwhile) is what Undo reverses.
        const after = statusQueued.has(p.write.taskId)
          ? { ...(saved.get(p.write.taskId) ?? p.before), ...p.shown }
          : saved.get(p.write.taskId);
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
