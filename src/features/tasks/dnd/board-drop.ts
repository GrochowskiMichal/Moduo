// What a Board drop does (TV-U4). Pure: no React, no DOM, no IO.
//
// Within a column it reorders, only where the board is one project's manual
// order (order.ts, default m); sorted, it asks to switch back; across
// projects (All, My tasks, the Queue) there's nothing to reorder. Across
// columns the column's field changes — status, or project (its subtasks
// follow) — with the place only where the order is manual. A project task
// never goes into the Inbox column (a shared task never turns private by a
// drop).

import type { Task } from "../model";
import type { DragOrder } from "../order";
import { boardDropPosition } from "../reorder";
import { STATUS_KEY_LABELS, type StatusKey } from "../statuses";
import { canMoveInto } from "./drop-mode";
import type { TaskDropWrite } from "./drop-write";
import { projectMoveWrite } from "./rail-drop";

export type BoardColumnRef = {
  id: string;
  dim: "status" | "bucket";
  value: string;
  /** Every task in the column, in order, hidden completed ones included. */
  all: ReadonlyArray<Pick<Task, "id" | "position">>;
};

export type BoardDropDecision =
  /** Nothing happens. */
  | { kind: "none" }
  /** Sorted: nothing moves; the toast asks to go back to manual order. */
  | { kind: "ask-manual" }
  | { kind: "write"; write: TaskDropWrite; label: string };

/** Whether a column takes this task: never the Inbox for a project's task. */
export function boardColumnAccepts(
  column: Pick<BoardColumnRef, "dim" | "value">,
  task: Pick<Task, "bucketId">,
  inboxId: string | null,
): boolean {
  return column.dim !== "bucket" || canMoveInto(column.value, task, inboxId);
}

export function planBoardDrop(input: {
  task: Task;
  /** The task's parent, when it has one (a project move may detach it). */
  parent: Pick<Task, "bucketId"> | null;
  source: BoardColumnRef;
  dest: BoardColumnRef;
  /** The card it was dropped on, or null for the column itself (its end). */
  overId: string | null;
  order: DragOrder;
  inboxId: string | null;
  bucketName: (id: string) => string;
}): BoardDropDecision {
  const { task, source, dest, order } = input;
  const position =
    order === "manual"
      ? boardDropPosition({
          activeId: task.id,
          overId: input.overId,
          source: source.all,
          dest: dest.all,
        })
      : null;

  if (source.id === dest.id) {
    if (order === "sorted") return { kind: "ask-manual" };
    if (order !== "manual" || position === null) return { kind: "none" };
    return { kind: "write", write: { taskId: task.id, position }, label: "Moved" };
  }

  const placed = position === null ? {} : { position };
  if (dest.dim === "status") {
    const status = dest.value as StatusKey;
    return {
      kind: "write",
      write: { taskId: task.id, status, ...placed },
      label: `Moved to ${STATUS_KEY_LABELS[status]}`,
    };
  }
  if (!boardColumnAccepts(dest, task, input.inboxId)) return { kind: "none" };
  return {
    kind: "write",
    write: { ...projectMoveWrite(task, dest.value, input.parent), ...placed },
    label: `Moved to ${input.bucketName(dest.value)}`,
  };
}
