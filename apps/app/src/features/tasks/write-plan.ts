// One task's write, decided before anything is sent (Track A3). A single edit
// (`patchTask`), a drop (`saveTaskWrite`) and a selection's change
// (`bulkWrite`) each ask `planTaskWrite` what the write is: whether it may
// start, what the task shows at once (and the rows that move or leave with
// it), and the parts each server op is sent. Pure, over plain data: the
// commands keep their own I/O (the store's write, the server ops, toasts,
// Undo), so the three paths can't drift apart on the rules again.

import {
  isBacklogTask,
  isClosedTask,
  legacyTaskStatus,
  normalizeTaskStatusCategory,
  taskCategoryOf,
  type TaskStatus,
  type TaskStatusCategory,
  taskStatusWord,
} from "@contracts/vocabularies";

import type { OverlayChange } from "../../lib/sync/store";
import {
  dueOnToLocalInstant,
  editableTaskFields,
  type TaskFieldPatch,
  withDueOn,
} from "../../lib/task-rows";
import type { BulkWrite } from "./bulk";
import type { TaskDropWrite } from "./dnd/drop-write";
import { subtasksByParent } from "./helpers";
import type { Bucket, ProjectStatus, RecurrenceRule, Task, TaskQueueEntry } from "./model";
import { recurrenceOnStatusChange } from "./recurrence-engine";
import { firstStatusOf, optimisticStatus, statusKeyCategory, statusSetFor } from "./statuses";

/** Optimistic placeholder id, not yet a real server uuid. */
export const isTempId = (id: string) => id.startsWith("tmp-");

/** One field write of a task, as an overlay change. */
export const patchOf = (id: string, fields: Partial<Task>): OverlayChange => ({
  table: "tasks",
  patch: { id, fields: fields as Record<string, unknown> },
});

/** A task's change: its fields, plus a repeat's one occurrence moving to a day
 *  (`tasks_op_move_occurrence`: the day shows, its pattern stays). */
export type WritePatch = Partial<Task> & { occurrenceOn?: string };

/** What a write is decided against: plain data, read from the store now. */
export type WritePlanContext = {
  userId: string | null;
  /** May this person edit Tasks here (and is there a store and runtime to write to)? */
  canEdit: boolean;
  /** Tasks of archived projects: read-only until unarchived (TV-U6). */
  archivedTaskIds: { has(id: string): boolean };
  /** Every project, archived ones too: status sets, an archived project's name. */
  bucketsById: ReadonlyMap<string, Pick<Bucket, "id" | "isSystem" | "name">>;
  statuses: readonly ProjectStatus[];
  /** Live subtasks by parent, done and Won't do ones too (`childrenByParentOf`). */
  subtasksByParent: ReadonlyMap<string, readonly Task[]>;
  /** Every queue row I can see, anyone's (TV-D2), and my own line-up. */
  queueRows: readonly TaskQueueEntry[];
  myQueueEntries: readonly TaskQueueEntry[];
  now: Date;
  /** The recurrence engine's zone (`engineZone()`). */
  zone: string;
};

/** Why a write can't start. "deleted" is quiet; the rest say so. */
export type WriteRefusal = "no-edit" | "deleted" | "still-saving" | "archived";

/** The status op's part (`tasks_op_set_status`): the place and the rule ride with it. */
export type StatusOp = {
  category: TaskStatusCategory;
  /** What the op is sent: the named status's id, else the category's word. */
  status: string;
  recurrence?: RecurrenceRule | null;
  position?: string;
};

/** What a status change does to the queues (`queueFollowOf`). */
export type QueueFollow = {
  /** Overlay changes taking the task out of the queues shown. */
  changes: OverlayChange[];
  /** The queue rows the server drops with it. */
  rowIds: string[];
  /** My row, kept on show until the next reload (a done task of mine). */
  keep?: TaskQueueEntry;
  /** Reopened: no longer kept on show. */
  unkeep: boolean;
};

export type TaskWrite = {
  kind: "write";
  taskId: string;
  /** What the task shows at once: the whole change, normalised (the due day
   *  derived, status / statusId / category consistent, the advanced rule). */
  shown: Partial<Task>;
  /** Every column one field-level write sends: the status by category (its
   *  id only when the change named one), the rule and the place too. */
  columns: TaskFieldPatch;
  /** The field-level part when the status, the scheduled time and the
   *  assignee go by their own ops (the rule and the place ride the status op). */
  fields: TaskFieldPatch;
  status?: StatusOp;
  assigneeId?: string | null;
  scheduledAt?: string | null;
  occurrenceOn?: string;
  /** Into another project: one op that carries the subtasks (TV-D8). */
  moving: boolean;
  /** Subtasks shown in the new project at once. */
  movedChildIds: string[];
  queue: QueueFollow;
  /** Everything the write shows at once: the task's own patch first. */
  overlay: OverlayChange[];
  /** The overlay without the task's own patch (moved subtasks, queue rows leaving). */
  alongside: OverlayChange[];
  /** The repeat rule a check-off advanced (spec §5d); absent when the change carried its own. */
  advancedRecurrence?: RecurrenceRule;
  followUps: {
    /** "Done — next: Tomorrow, 9:00 AM". */
    nextOccurrence?: string;
    /** Out of Backlog or Won't do into an open status: paused reminders may come back. */
    restoreReminders: boolean;
    /** "Still in Backlog · Move to To do" (REPLAN 53). */
    moveToTodo: boolean;
    /** Call 87: into Done from an open status finishes the open subtasks. */
    finishOpenSubtasks: boolean;
  };
};

export type WritePlan =
  | { kind: "refused"; reason: WriteRefusal; projectName?: string | null }
  | { kind: "noop" }
  | TaskWrite;

const NO_QUEUE: QueueFollow = { changes: [], rowIds: [], unkeep: false };

/**
 * Mirror the server: done, archived, backlog or deleted leaves every queue
 * (TV-D2, TV-D9). Returns the overlay changes that take the task out of the
 * queues shown (the write that changes its status carries them, so a refusal
 * puts them back), and the queue rows the server will have dropped. A done
 * task of mine stays on show (kept) until the next reload; reopening drops it.
 */
export function queueFollowOf(
  taskId: string,
  status: TaskStatus | TaskStatusCategory | "deleted",
  queueRows: readonly TaskQueueEntry[],
  myQueueEntries: readonly TaskQueueEntry[],
): QueueFollow {
  if (status === "todo" || status === "in_progress") {
    return { changes: [], rowIds: [], unkeep: true };
  }
  const mine = status === "done" ? myQueueEntries.find((e) => e.taskId === taskId) : undefined;
  const rows = queueRows.filter((e) => e.taskId === taskId);
  return {
    changes: rows.map((e) => ({ table: "queue", remove: e.id }) as OverlayChange),
    rowIds: rows.map((e) => e.id),
    ...(mine ? { keep: mine } : {}),
    unkeep: false,
  };
}

const childrenMemo = new WeakMap<readonly Task[], Map<string, Task[]>>();

/**
 * Live subtasks by parent, Won't do ones too: what a move takes along (the
 * server carries done and Won't do subtasks with their parent, TV-D8).
 * `subtasksByParentOf` leaves Won't do out, as the lists do. Cached on the
 * live tasks' identity, as the selectors are.
 */
export function childrenByParentOf(liveTasks: readonly Task[]): Map<string, Task[]> {
  const hit = childrenMemo.get(liveTasks);
  if (hit) return hit;
  const map = subtasksByParent(liveTasks as Task[]);
  childrenMemo.set(liveTasks, map);
  return map;
}

/**
 * Someone else's unfiled task handed on into another Inbox (TV-D13, call 20)
 * is out of my sight once the assignment saved: it and the steps that went
 * with it are dropped, rather than kept until the next access check.
 */
export function handedOutOfSight(
  saved: Task,
  before: Task,
  ctx: Pick<WritePlanContext, "bucketsById" | "userId" | "subtasksByParent">,
): string[] {
  if (
    saved.bucketId === before.bucketId ||
    ctx.bucketsById.has(saved.bucketId) ||
    saved.creatorId === ctx.userId ||
    saved.assigneeId === ctx.userId
  ) {
    return [];
  }
  return [
    saved.id,
    ...(ctx.subtasksByParent.get(saved.id) ?? [])
      .filter((t) => t.bucketId === before.bucketId)
      .map((t) => t.id),
  ];
}

/** A drop's or a selection's write as the change `planTaskWrite` takes. */
export function patchOfWrite(write: TaskDropWrite | BulkWrite): WritePatch {
  const patch: WritePatch = {};
  if (write.parentId !== undefined) patch.parentId = write.parentId;
  if (write.bucketId !== undefined) patch.bucketId = write.bucketId;
  if (write.position !== undefined) patch.position = write.position;
  if (write.priority !== undefined) patch.priority = write.priority;
  if (write.sectionId !== undefined) patch.sectionId = write.sectionId;
  if (write.teamId !== undefined) patch.teamId = write.teamId;
  if (write.assigneeId !== undefined) patch.assigneeId = write.assigneeId;
  // A status key (Backlog is its own) is saved as its category (TV-D9).
  if (write.status !== undefined) {
    const category = statusKeyCategory(write.status);
    patch.statusCategory = category;
    patch.status = legacyTaskStatus(category);
  }
  if (write.statusId) patch.statusId = write.statusId;
  if ("dueDate" in write && write.dueDate !== undefined) patch.dueDate = write.dueDate;
  if ("occurrenceOn" in write && write.occurrenceOn !== undefined) {
    patch.occurrenceOn = write.occurrenceOn;
  }
  if ("recurrence" in write && write.recurrence !== undefined) patch.recurrence = write.recurrence;
  if ("scheduledAt" in write && write.scheduledAt !== undefined) {
    patch.scheduledAt = write.scheduledAt;
  }
  return patch;
}

const pickStatus = (t: Task): Pick<Task, "status" | "statusId" | "statusCategory"> => ({
  status: t.status,
  statusId: t.statusId,
  statusCategory: taskCategoryOf(t),
});

/** Why `before` can't be written now, or null. */
function refusalOf(before: Task, ctx: WritePlanContext): WritePlan | null {
  if (!ctx.canEdit) return { kind: "refused", reason: "no-edit" };
  if (before.deletedAt) return { kind: "refused", reason: "deleted" };
  if (isTempId(before.id)) return { kind: "refused", reason: "still-saving" };
  if (ctx.archivedTaskIds.has(before.id)) {
    return {
      kind: "refused",
      reason: "archived",
      projectName: ctx.bucketsById.get(before.bucketId)?.name ?? null,
    };
  }
  return null;
}

const STATUS_KEYS = ["status", "statusId", "statusCategory"] as const;

/** Two scheduled times that are the same instant ("…+00:00" and "….000Z"). */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return (a ?? null) === (b ?? null);
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isNaN(x) || Number.isNaN(y) ? a === b : x === y;
}

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * The status a task keeps in `category` once it's in `set`, as the server
 * picks it: its own when the set has it; moved into another project, the
 * status of the same name there, else the category's first. A set this
 * reader can't see (empty) keeps the task's own.
 */
function keptStatusId(
  before: Task,
  category: TaskStatusCategory,
  set: readonly ProjectStatus[],
  statuses: readonly ProjectStatus[],
): string | null {
  if (!before.statusId || set.length === 0 || set.some((s) => s.id === before.statusId)) {
    return before.statusId ?? firstStatusOf(set, category)?.id ?? null;
  }
  const own = statuses.find((s) => s.id === before.statusId);
  const sameName = own
    ? set.find((s) => s.category === category && nameKey(s.name) === nameKey(own.name))
    : undefined;
  return sameName?.id ?? firstStatusOf(set, category)?.id ?? before.statusId;
}

function omit(fields: TaskFieldPatch, keys: readonly (keyof TaskFieldPatch)[]): TaskFieldPatch {
  const out: Record<string, unknown> = { ...fields };
  for (const k of keys) delete out[k];
  return out as TaskFieldPatch;
}

/**
 * Plan one task's write: refused (and why), nothing to send, or what it
 * shows at once and sends.
 */
export function planTaskWrite(before: Task, patch: WritePatch, ctx: WritePlanContext): WritePlan {
  const refusal = refusalOf(before, ctx);
  if (refusal) return refusal;

  // A new due date shows its day at once too (TV-D9).
  const { occurrenceOn, ...change } = withDueOn(patch);
  const assigneeId = change.assigneeId;
  const scheduledAt = change.scheduledAt;

  // A status by category (or a legacy value: the checkbox, Won't do) shows
  // the project's status for it at once (TV-D9); the server is told the
  // category, and picks the same one (or keeps one already in it). A named
  // status is taken as it is. The set is the project the task ends in.
  const set = statusSetFor(ctx.statuses, ctx.bucketsById.get(change.bucketId ?? before.bucketId));
  const namedId = change.statusId || undefined;
  const asked =
    change.statusCategory ??
    (change.status !== undefined ? normalizeTaskStatusCategory(change.status) : undefined);
  let category: TaskStatusCategory | undefined;
  let statusFields: Pick<Task, "status" | "statusId" | "statusCategory"> | null = null;
  if (namedId) {
    category = set.find((s) => s.id === namedId)?.category ?? asked ?? taskCategoryOf(before);
    statusFields = {
      statusId: namedId,
      statusCategory: category,
      status: legacyTaskStatus(category),
    };
  } else if (asked !== undefined) {
    category = asked;
    statusFields =
      category === taskCategoryOf(before)
        ? {
            statusId: keptStatusId(before, category, set, ctx.statuses),
            statusCategory: category,
            status: legacyTaskStatus(category),
          }
        : optimisticStatus(before, { category }, set);
  } else if (change.bucketId !== undefined && change.bucketId !== before.bucketId) {
    // Moved without a status change: the server keeps the category and finds
    // its status in the new project; shown at once, never sent.
    const statusId = keptStatusId(before, taskCategoryOf(before), set, ctx.statuses);
    if (statusId !== (before.statusId ?? null)) statusFields = { ...pickStatus(before), statusId };
  }

  // Advance-on-done (spec §5d): a status change on a recurring task keeps
  // the stored nextOccurrence pointer fresh — unless the change already
  // carries the rule itself (catch-up / skip, an Undo putting one back).
  let advancedRecurrence: RecurrenceRule | undefined;
  let statusRecurrence: RecurrenceRule | null | undefined;
  if (category !== undefined) {
    if (change.recurrence !== undefined) statusRecurrence = change.recurrence;
    else {
      advancedRecurrence =
        recurrenceOnStatusChange(before, legacyTaskStatus(category), ctx.now, ctx.zone) ??
        undefined;
      statusRecurrence = advancedRecurrence;
    }
  }

  // Scheduling a backlog task moves it to To do on the server (REPLAN 53):
  // shown at once, never sent.
  const toTodo =
    category === undefined &&
    scheduledAt &&
    !sameInstant(scheduledAt, before.scheduledAt) &&
    isBacklogTask(before)
      ? optimisticStatus(before, { category: "todo" }, set)
      : null;

  const status: StatusOp | undefined =
    category === undefined
      ? undefined
      : {
          category,
          // By id when the change names a project status, else by category word.
          status: namedId ?? taskStatusWord(category),
          ...(statusRecurrence !== undefined ? { recurrence: statusRecurrence } : {}),
          ...(change.position !== undefined ? { position: change.position } : {}),
        };

  // A status shown by category goes to the server as the category (the id
  // picked here is only what shows meanwhile).
  const columns = editableTaskFields({
    ...change,
    statusId: namedId,
    ...(category !== undefined
      ? { statusCategory: category, status: legacyTaskStatus(category) }
      : {}),
    ...(statusRecurrence !== undefined ? { recurrence: statusRecurrence } : {}),
  });
  const fields = omit(columns, [
    ...STATUS_KEYS,
    "scheduledAt",
    ...(status ? (["recurrence", "position"] as const) : []),
  ]);

  const nothingElse =
    status === undefined && assigneeId === undefined && occurrenceOn === undefined;
  if (nothingElse && Object.keys(columns).length === 0) return { kind: "noop" };
  // A scheduled time on its own that's already the task's changes nothing.
  if (
    nothingElse &&
    Object.keys(fields).length === 0 &&
    scheduledAt !== undefined &&
    sameInstant(scheduledAt, before.scheduledAt)
  ) {
    return { kind: "noop" };
  }

  const shown: Partial<Task> = {
    ...change,
    ...(occurrenceOn !== undefined
      ? { dueOn: occurrenceOn, dueDate: dueOnToLocalInstant(occurrenceOn) }
      : {}),
    ...statusFields,
    ...toTodo,
    ...(statusRecurrence !== undefined ? { recurrence: statusRecurrence } : {}),
  };

  // Moving a parent takes its subtasks along (TV-P0): shown at once for
  // every subtask, then settled by the server, which carries the ones you
  // can edit (TV-D8). One still saving isn't on the server to carry.
  const moving = change.bucketId !== undefined && change.bucketId !== before.bucketId;
  const movedChildIds = moving
    ? (ctx.subtasksByParent.get(before.id) ?? [])
        .filter((t) => !t.deletedAt && !isTempId(t.id) && t.bucketId !== change.bucketId)
        .map((t) => t.id)
    : [];

  // Done, archived or backlog leaves every queue on the server (TV-D2),
  // whichever op changes the status; the same write takes it out of the
  // queues shown.
  const queue =
    category === undefined
      ? NO_QUEUE
      : queueFollowOf(before.id, category, ctx.queueRows, ctx.myQueueEntries);

  const alongside: OverlayChange[] = [
    ...movedChildIds.map((id) => patchOf(id, { bucketId: change.bucketId })),
    ...queue.changes,
  ];
  const overlay = [
    patchOf(before.id, { ...shown, updatedAt: ctx.now.toISOString() }),
    ...alongside,
  ];

  const from = taskCategoryOf(before);
  return {
    kind: "write",
    taskId: before.id,
    shown,
    columns,
    fields,
    ...(status ? { status } : {}),
    ...(assigneeId !== undefined ? { assigneeId } : {}),
    ...(scheduledAt !== undefined ? { scheduledAt } : {}),
    ...(occurrenceOn !== undefined ? { occurrenceOn } : {}),
    moving,
    movedChildIds,
    queue,
    overlay,
    alongside,
    ...(advancedRecurrence ? { advancedRecurrence } : {}),
    followUps: {
      ...(category === "done" && advancedRecurrence?.nextOccurrence
        ? { nextOccurrence: advancedRecurrence.nextOccurrence }
        : {}),
      restoreReminders:
        (category === "todo" || category === "in_progress") &&
        (from === "backlog" || from === "wont_do"),
      // Assigning a backlog task or giving it a due date offers to plan it
      // (REPLAN 53): it stays in Backlog unless you say so.
      moveToTodo:
        isBacklogTask(before) &&
        category === undefined &&
        !toTodo &&
        ((assigneeId != null && assigneeId !== before.assigneeId) ||
          (change.dueDate != null && change.dueDate !== before.dueDate)),
      finishOpenSubtasks: category === "done" && !isClosedTask(before),
    },
  };
}
