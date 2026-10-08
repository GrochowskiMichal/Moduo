// Dropping a task on the Tasks rail (tasks-v2 §8, TV-U4). Pure: no React, no IO.
//
//   • a bucket row (Inbox included) → move it there; its subtasks follow;
//   • the Queue row → add it to my queue;
//   • My tasks → assign it to me.
//
// The rail rows are dnd-kit droppables with ids `rail:*`, resolved by a
// prefix-filtered `pointerWithin` branch of the page's one collision (spec
// decision 14), so they only take a drop the pointer is actually over: a
// card dragged near the rail never snaps to it by distance.

import { type CollisionDetection, pointerWithin } from "@dnd-kit/core";

import { betweenPositions } from "../helpers";
import type { Task } from "../model";

export const RAIL_DROP_PREFIX = "rail:";

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
 * What a drop on a rail row does, or null when it would change nothing (the
 * task is already in that bucket, already queued or done, already mine). The
 * row only tints when this is non-null.
 */
export function railDropAction(
  target: RailDropTarget,
  task: Pick<Task, "id" | "bucketId" | "status" | "assigneeId">,
  ctx: { queuedTaskIds: ReadonlySet<string>; currentUserId: string | null },
): RailDropAction | null {
  switch (target.target) {
    case "bucket":
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
  return s.startsWith(RAIL_DROP_PREFIX) || s.startsWith("link:");
}

/**
 * The writes for moving a task to another bucket: the task goes to the end
 * of that bucket's manual order, and its subtasks follow it (keeping their
 * own order under it). `allByPosition` is every task, in position order.
 * A drop that placed it somewhere passes that `position` instead.
 */
export function bucketMovePatches(input: {
  task: Pick<Task, "id">;
  subtasks: ReadonlyArray<Pick<Task, "id" | "bucketId">>;
  bucketId: string;
  allByPosition: ReadonlyArray<Pick<Task, "id" | "bucketId" | "position">>;
  position?: string;
}): Array<{ id: string; patch: Partial<Pick<Task, "bucketId" | "position">> }> {
  const { task, subtasks, bucketId, allByPosition } = input;
  const followers = subtasks
    .filter((s) => s.bucketId !== bucketId)
    .map((s) => ({ id: s.id, patch: { bucketId } }));
  if (input.position !== undefined) {
    return [{ id: task.id, patch: { bucketId, position: input.position } }, ...followers];
  }
  const moving = new Set([task.id, ...subtasks.map((s) => s.id)]);
  const rest = allByPosition.filter((t) => !moving.has(t.id));
  let lastIdx = -1;
  rest.forEach((t, i) => {
    if (t.bucketId === bucketId) lastIdx = i;
  });
  // After the bucket's last task, before whatever follows it in the one
  // order; an empty bucket takes the very end.
  const position =
    lastIdx < 0
      ? betweenPositions(rest[rest.length - 1]?.position ?? null, null)
      : betweenPositions(rest[lastIdx].position, rest[lastIdx + 1]?.position ?? null);
  return [{ id: task.id, patch: { bucketId, position } }, ...followers];
}
