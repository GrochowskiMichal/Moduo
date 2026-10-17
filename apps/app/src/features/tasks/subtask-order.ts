// Moving a subtask among its parent's subtasks (TV-U10; the panel's list and
// the List's nested rows): a parent's subtasks keep their own order in every
// view, whatever the view sorts by, so a move among them always writes a
// place. Pure: no React, no IO.

import { positionNextTo } from "./dnd/drop-mode";
import type { Task } from "./model";

/**
 * The position that puts `movingId` at `toIndex` among `siblings` (its
 * parent's subtasks, in order), or null when it wouldn't move.
 */
export function subtaskPositionAt(
  allByPosition: ReadonlyArray<Pick<Task, "id" | "position">>,
  siblings: ReadonlyArray<Pick<Task, "id">>,
  movingId: string,
  toIndex: number,
): string | null {
  const from = siblings.findIndex((t) => t.id === movingId);
  const target = siblings[toIndex];
  if (from < 0 || toIndex === from || !target) return null;
  return positionNextTo(
    allByPosition,
    { id: target.id, edge: toIndex < from ? "before" : "after" },
    movingId,
  );
}
