// What a drop writes, and what its Undo toast says (TV-U4). Pure: no React,
// no IO. Every surface that drops a task — the List, the Board, the rail, the
// List's move keys — turns its gesture into one `TaskDropWrite`, and
// `useTasksModule.dropTask` saves it in order and offers the Undo (call a).

import { PRIORITY_LABELS } from "../helpers";
import type { PriorityLevel, Task } from "../model";
import { STATUS_KEY_LABELS, type StatusKey, statusKeyOf } from "../statuses";
import type { ListDropPlan } from "./drop-mode";

/**
 * One task's writes. Saved in this order, each after the one before has
 * landed (never two writes to the same row at once):
 * 1. the field-level write: `parentId`, `bucketId` (its subtasks follow, done
 *    and Won't do ones too), `priority`, and `position` when no status rides;
 * 2. the status op (`tasks_op_set_status`), carrying `position` when it rides;
 * 3. the assign op (`tasks_op_assign`).
 * Absent fields don't change.
 */
export type TaskDropWrite = {
  taskId: string;
  parentId?: string | null;
  bucketId?: string;
  position?: string;
  priority?: PriorityLevel | null;
  /** A status key: the legacy value, or "backlog" (TV-D9). Saved as its
   *  category, so Backlog stays Backlog through a drop and its Undo. */
  status?: StatusKey;
  assigneeId?: string | null;
};

/** The fields a drop can change, in the order Undo checks them. */
export const DROP_FIELDS = [
  "parentId",
  "bucketId",
  "position",
  "priority",
  "status",
  "assigneeId",
] as const satisfies ReadonlyArray<keyof TaskDropWrite & keyof Task>;

export type DropField = (typeof DROP_FIELDS)[number];

/** A List drop's plan as the one write shape. */
export function writeFromPlan(plan: ListDropPlan): TaskDropWrite {
  const write: TaskDropWrite = { taskId: plan.taskId };
  if (plan.parentId !== undefined) write.parentId = plan.parentId;
  if (plan.bucketId !== undefined) write.bucketId = plan.bucketId;
  if (plan.position !== undefined) write.position = plan.position;
  if (plan.fields?.status !== undefined) write.status = plan.fields.status;
  if (plan.fields?.priority !== undefined) write.priority = plan.fields.priority;
  if (plan.fields?.assigneeId !== undefined) write.assigneeId = plan.fields.assigneeId;
  return write;
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * Undo's write: each field the drop changed goes back to what it was before,
 * unless it changed again since (a teammate, another tab, a later edit): Undo
 * never overwrites a newer change. `kept` names the fields it left alone.
 * `write` must be the one that was saved (with any position the move added).
 */
export function undoWrite(input: {
  write: TaskDropWrite;
  before: Pick<Task, DropField | "statusCategory">;
  /** The row as the drop saved it. */
  after: Pick<Task, DropField | "statusCategory">;
  /** The row now. */
  current: Pick<Task, DropField | "statusCategory">;
}): { write: TaskDropWrite | null; kept: DropField[] } {
  const { write, before, after, current } = input;
  // A status reads as its key, so a backlog task (stored "todo") goes back to
  // Backlog, not To do (TV-D9).
  const value = (task: Pick<Task, DropField | "statusCategory">, field: DropField) =>
    field === "status" ? statusKeyOf(task) : task[field];
  const revert: Record<string, unknown> = {};
  const kept: DropField[] = [];
  for (const field of DROP_FIELDS) {
    if (write[field] === undefined) continue;
    if (!same(value(current, field), value(after, field))) {
      kept.push(field);
      continue;
    }
    if (same(value(before, field), value(current, field))) continue;
    revert[field] = value(before, field) ?? null;
  }
  if (Object.keys(revert).length === 0) return { write: null, kept };
  return { write: { taskId: write.taskId, ...revert } as TaskDropWrite, kept };
}

/** Names the toast needs, looked up by the view. */
export type DropNames = {
  bucketName: (id: string) => string;
  assigneeName: (id: string) => string;
  taskTitle: (id: string) => string;
};

/**
 * What the Undo toast says: the most telling change, in the one grammar
 * ("Moved to Website", "Moved to In progress", "Assigned to Sam", "Moved under
 * “Plan launch”", "Moved").
 */
export function dropLabel(
  write: TaskDropWrite,
  names: DropNames,
  before?: Pick<Task, "parentId">,
): string {
  // Under a parent says where, its project included (a subtask lives there).
  if (write.parentId) return `Moved under “${names.taskTitle(write.parentId)}”`;
  if (write.bucketId !== undefined) return `Moved to ${names.bucketName(write.bucketId)}`;
  if (write.status !== undefined) return `Moved to ${STATUS_KEY_LABELS[write.status]}`;
  if (write.assigneeId !== undefined) {
    return write.assigneeId ? `Assigned to ${names.assigneeName(write.assigneeId)}` : "Unassigned";
  }
  if (write.priority !== undefined) {
    return write.priority ? `Set to ${PRIORITY_LABELS[write.priority]}` : "Priority cleared";
  }
  if (write.parentId === null && before?.parentId) {
    return `Moved out of “${names.taskTitle(before.parentId)}”`;
  }
  return "Moved";
}
