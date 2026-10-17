// Dropping a task on the Tasks rail (tasks-v2 §8, TV-U4). Pure: no React, no IO.
//
//   • a project row → move it there; its subtasks follow, and it goes to the
//     end of that project's manual order;
//   • the Inbox row → nothing: the Inbox is private, and a shared task never
//     turns private by a drop (tasks-v3 §edge cases). The row is still a
//     droppable, so a drag released on it lands nowhere instead of falling
//     through to the Board's nearest column;
//   • the Queue row → add it to my queue;
//   • My tasks → assign it to me.
//
// The rail rows are dnd-kit droppables with ids `rail:*`, resolved by a
// prefix-filtered `pointerWithin` branch of the page's one collision, so they
// only take a drop the pointer is actually over: a card dragged near the rail
// never snaps to it by distance.

import { type CollisionDetection, closestCenter, pointerWithin } from "@dnd-kit/core";

import { betweenPositions } from "../helpers";
import type { Task } from "../model";
import type { TaskDropWrite } from "./drop-write";

export const RAIL_DROP_PREFIX = "rail:";
/** The sidebar's sortable project rows (TV-U6): their own prefix, so a task
 *  drop never lands on one and a project drag sorts only among them. */
export const RAIL_SORT_PREFIX = "railsort:";

/** The `data` a rail row's droppable carries. */
export type RailDropTarget =
  | { type: "rail"; target: "bucket"; bucketId: string }
  | { type: "rail"; target: "queue" }
  | { type: "rail"; target: "mine" };

export function railDroppableId(target: RailDropTarget): string {
  return target.target === "bucket"
    ? `${RAIL_DROP_PREFIX}bucket:${target.bucketId}`
    : `${RAIL_DROP_PREFIX}${target.target}`;
}

export function asRailDropTarget(data: unknown): RailDropTarget | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { type?: unknown; target?: unknown; bucketId?: unknown };
  if (d.type !== "rail") return null;
  if (d.target === "queue" || d.target === "mine") return data as RailDropTarget;
  if (d.target === "bucket" && typeof d.bucketId === "string") return data as RailDropTarget;
  return null;
}

export type RailDropAction =
  | { kind: "move"; taskId: string; bucketId: string }
  | { kind: "queue"; taskId: string }
  | { kind: "assign-me"; taskId: string; userId: string };

/**
 * What a drop on a rail row does, or null when it does nothing (the Inbox
 * row; the task is already in that project, already queued or closed,
 * already mine). The row only tints when this is non-null.
 */
export function railDropAction(
  target: RailDropTarget,
  task: Pick<Task, "id" | "bucketId" | "status" | "assigneeId">,
  ctx: { queuedTaskIds: ReadonlySet<string>; currentUserId: string | null; inboxId: string | null },
): RailDropAction | null {
  switch (target.target) {
    case "bucket":
      if (target.bucketId === ctx.inboxId) return null;
      return task.bucketId === target.bucketId
        ? null
        : { kind: "move", taskId: task.id, bucketId: target.bucketId };
    case "queue":
      if (task.status === "done" || task.status === "archived") return null;
      return ctx.queuedTaskIds.has(task.id) ? null : { kind: "queue", taskId: task.id };
    case "mine":
      if (!ctx.currentUserId || task.assigneeId === ctx.currentUserId) return null;
      return { kind: "assign-me", taskId: task.id, userId: ctx.currentUserId };
  }
}

/**
 * The write for moving a task to another project by a drop (a rail row, a
 * Board project column). A subtask moved on its own comes out to the top
 * level there: a subtask lives in its parent's project (research §3), so it
 * never sits under a parent elsewhere.
 */
export function projectMoveWrite(
  task: Pick<Task, "id" | "parentId">,
  bucketId: string,
  parent: Pick<Task, "bucketId"> | null,
): TaskDropWrite {
  const write: TaskDropWrite = { taskId: task.id, bucketId };
  if (task.parentId && parent?.bucketId !== bucketId) write.parentId = null;
  return write;
}

/**
 * The page collision's rail branch: `pointerWithin` over the `rail:*`
 * droppables only. Empty when the pointer isn't on a rail row, so the caller
 * falls through to the centre view's own strategy.
 */
export const railCollision: CollisionDetection = (args) =>
  pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) =>
      String(c.id).startsWith(RAIL_DROP_PREFIX),
    ),
  });

/** Whether a droppable belongs to the rail or the hub — never the centre view's. */
export function isSideDroppable(id: string | number): boolean {
  const s = String(id);
  return s.startsWith(RAIL_DROP_PREFIX) || s.startsWith(RAIL_SORT_PREFIX) || s.startsWith("link:");
}

/** The page collision's branch for a sidebar project drag: the sortable
 *  project rows only, closest centre (a list reorder). */
export const railSortCollision: CollisionDetection = (args) =>
  closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) =>
      String(c.id).startsWith(RAIL_SORT_PREFIX),
    ),
  });

/**
 * Where a task moved to another project goes when the drop didn't place it:
 * the end of that project's manual order, after its last task and before
 * whatever follows in the one order (an empty project takes the very end).
 * `moving` is the task and its subtasks; `allByPosition` every task, in
 * position order.
 */
export function bucketEndPosition(input: {
  moving: ReadonlySet<string>;
  bucketId: string;
  allByPosition: ReadonlyArray<Pick<Task, "id" | "bucketId" | "position">>;
}): string {
  const rest = input.allByPosition.filter((t) => !input.moving.has(t.id));
  let lastIdx = -1;
  rest.forEach((t, i) => {
    if (t.bucketId === input.bucketId) lastIdx = i;
  });
  return lastIdx < 0
    ? betweenPositions(rest[rest.length - 1]?.position ?? null, null)
    : betweenPositions(rest[lastIdx].position, rest[lastIdx + 1]?.position ?? null);
}
