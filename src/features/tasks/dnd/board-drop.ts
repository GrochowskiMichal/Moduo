// What a Board drop does (TV-U4, TV-U11). Pure: no React, no DOM, no IO.
//
// Within a cell (a column, or a column's part of a lane) it reorders, only
// where the board is one project's manual order (order.ts, default m);
// sorted, it asks to switch back; across projects (All, My tasks, the Queue)
// there's nothing to reorder. Into another column the column's field changes
// (a status, a section, a person, a team, a priority, a project: its
// subtasks follow), and into another lane the lane's; the place only where
// the order is manual. A project task never goes into the Inbox column (a
// shared task never turns private by a drop), a column without a field (an
// area) takes nothing, and Project lanes never move a task to another
// project (that stays a deliberate Move, call 85's research).

import type { TaskWaitingKind } from "@contracts/vocabularies";
import type { BoardTarget } from "../board-columns";
import { statusNameKey } from "../board-columns";
import type { ProjectStatus, Task } from "../model";
import type { DragOrder } from "../order";
import { boardDropPosition } from "../reorder";
import { canMoveInto } from "./drop-mode";
import type { TaskDropWrite } from "./drop-write";
import { projectMoveWrite } from "./rail-drop";

/** One place on the board a card can be dropped. */
export type BoardCellRef = {
  /** The droppable's id. */
  id: string;
  column: { id: string; label: string; target: BoardTarget | null };
  /** The lane, when the board has lanes. */
  lane: { key: string; label: string; target: BoardTarget | null } | null;
  /** Every task in the cell, in order, hidden completed ones included. */
  all: ReadonlyArray<Pick<Task, "id" | "position">>;
};

export type BoardDropDecision =
  /** Nothing happens. */
  | { kind: "none" }
  /** Sorted: nothing moves; the toast asks to go back to manual order. */
  | { kind: "ask-manual" }
  | { kind: "write"; write: TaskDropWrite; label: string }
  /** Into a Waiting on column (TV-U12): the task waits on that one too. */
  | {
      kind: "waiting";
      entry: { kind: TaskWaitingKind; ref: string | null; label: string | null };
      label: string;
    };

export type BoardDropContext = {
  inboxId: string | null;
  /** A project's statuses (the Inbox's: the workspace default). */
  statusesFor: (bucketId: string) => readonly ProjectStatus[];
  /** The task's parent, when it has one (a project move may detach it). */
  parent: Pick<Task, "bucketId"> | null;
  /** The reader, so a toast says "Assigned to you" (MOD-137). */
  selfId?: string | null;
};

/**
 * A target's name inside a sentence: "you" when it names the reader (whose
 * column reads "You", MOD-137), otherwise the column's label.
 */
export function targetName(
  target: BoardTarget | null,
  label: string,
  selfId: string | null | undefined,
): string {
  if (!selfId || !target) return label;
  const self =
    (target.field === "assignee" && target.value === selfId) ||
    (target.field === "waiting" && target.kind === "person" && target.ref === selfId);
  return self ? "you" : label;
}

/** Whether a target takes this task: never the Inbox for a project's task. */
export function targetAccepts(
  target: BoardTarget | null,
  task: Pick<Task, "bucketId">,
  inboxId: string | null,
): boolean {
  if (!target) return false;
  return target.field !== "project" || canMoveInto(target.value, task, inboxId);
}

/** The fields a target writes on one task (null: it doesn't take it). */
export function targetWrite(
  target: BoardTarget,
  task: Task,
  ctx: BoardDropContext,
): Omit<TaskDropWrite, "taskId" | "position"> | null {
  switch (target.field) {
    case "status": {
      if (target.statusId) return { status: target.key, statusId: target.statusId };
      if (target.name) {
        // Shared names across projects: the task's own project's status of
        // that name (53a), else the category's first.
        const own = ctx
          .statusesFor(task.bucketId)
          .find((s) => statusNameKey(s.name) === target.name);
        if (own) return { status: target.key, statusId: own.id };
      }
      return { status: target.key };
    }
    case "priority":
      return { priority: target.value };
    case "assignee":
      return { assigneeId: target.value };
    case "section":
      return { sectionId: target.value };
    case "team":
      return { teamId: target.value };
    case "project": {
      if (!canMoveInto(target.value, task, ctx.inboxId)) return null;
      const { taskId: _id, ...move } = projectMoveWrite(task, target.value, ctx.parent);
      return move;
    }
    case "waiting":
      // Not a field: `planBoardDrop` answers with the entry to add.
      return null;
  }
}

/** What the Undo toast says for a target, in the one grammar (TV-U4). */
export function targetLabel(target: BoardTarget, name: string): string {
  switch (target.field) {
    case "assignee":
      return target.value ? `Assigned to ${name}` : "Unassigned";
    case "priority":
      return target.value ? `Set to ${name}` : "Priority cleared";
    case "team":
      return target.value ? `Routed to ${name}` : "Team cleared";
    case "waiting":
      return `Waiting on ${name}`;
    default:
      return `Moved to ${name}`;
  }
}

export function planBoardDrop(input: {
  task: Task;
  source: BoardCellRef;
  dest: BoardCellRef;
  /** The card it was dropped on, or null for the cell itself (its end). */
  overId: string | null;
  order: DragOrder;
  ctx: BoardDropContext;
}): BoardDropDecision {
  const { task, source, dest, order, ctx } = input;
  const position =
    order === "manual"
      ? boardDropPosition({
          activeId: task.id,
          overId: input.overId,
          source: source.all,
          dest: source.id === dest.id ? source.all : dest.all,
        })
      : null;

  if (source.id === dest.id) {
    if (order === "sorted") return { kind: "ask-manual" };
    if (order !== "manual" || position === null) return { kind: "none" };
    return { kind: "write", write: { taskId: task.id, position }, label: "Moved" };
  }

  const columnMoved = source.column.id !== dest.column.id;
  const laneMoved = (source.lane?.key ?? null) !== (dest.lane?.key ?? null);
  let write: TaskDropWrite = { taskId: task.id };
  let label = "Moved";
  if (columnMoved && dest.column.target?.field === "waiting") {
    const { kind, ref, label: words } = dest.column.target;
    return {
      kind: "waiting",
      entry: { kind, ref, label: words },
      label: targetLabel(
        dest.column.target,
        targetName(dest.column.target, dest.column.label, ctx.selfId),
      ),
    };
  }
  if (columnMoved) {
    const target = dest.column.target;
    const fields = target ? targetWrite(target, task, ctx) : null;
    if (!target || !fields) return { kind: "none" };
    write = { ...write, ...fields };
    label = targetLabel(target, targetName(target, dest.column.label, ctx.selfId));
  }
  if (laneMoved) {
    const target = dest.lane?.target ?? null;
    const fields = target ? targetWrite(target, task, ctx) : null;
    if (!target || !fields || !dest.lane) return { kind: "none" };
    write = { ...write, ...fields };
    if (!columnMoved) label = targetLabel(target, targetName(target, dest.lane.label, ctx.selfId));
  }
  if (position !== null) write.position = position;
  return { kind: "write", write, label };
}
