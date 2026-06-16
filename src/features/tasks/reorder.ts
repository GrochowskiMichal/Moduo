// Pure ordering math for drag-to-reorder. No React, no IO — unit-tested.
//
// Two ordering schemes live in the Tasks model:
//   • the commit queue is ordered by `commitOrder` (an integer column), so a
//     reorder renumbers the affected rows;
//   • lists/boards are ordered by `position` (a Lexorank-style text column), so
//     a reorder slots a fractional key between the new neighbours.
// These helpers compute the *minimum* set of writes for a move under each scheme
// and are shared by every drag surface (queue, board, …).

import { betweenPositions } from "./helpers";
import type { Task } from "./model";

/**
 * Renumber a committed queue to `orderedIds`. Returns only the `(id,
 * commitOrder)` pairs whose order actually changed — 1-based and contiguous —
 * so a reorder persists the fewest rows (and self-heals any sparse/legacy
 * numbering on the first move). Ids not present in `current` are ignored.
 *
 * `current` is the queue in its existing order (already `commitOrder`-sorted).
 */
export function commitOrderUpdates(
  orderedIds: string[],
  current: Array<Pick<Task, "id" | "commitOrder">>,
): Array<{ id: string; commitOrder: number }> {
  const currentById = new Map(current.map((t) => [t.id, t.commitOrder ?? null]));
  const updates: Array<{ id: string; commitOrder: number }> = [];
  let rank = 0;
  for (const id of orderedIds) {
    if (!currentById.has(id)) continue;
    rank += 1;
    if (currentById.get(id) !== rank) updates.push({ id, commitOrder: rank });
  }
  return updates;
}

/**
 * The `position` string for a task placed at `toIndex` within `ordered` — the
 * list in its *target* visual order, INCLUDING the moved task sitting at
 * `toIndex`. Slots a fractional key strictly between the new neighbours (either
 * bound may be absent at the ends). Pure; used by board within-column reorder.
 */
export function positionForReorder(
  ordered: Array<Pick<Task, "position">>,
  toIndex: number,
): string {
  const before = toIndex > 0 ? ordered[toIndex - 1]?.position ?? null : null;
  const after = ordered[toIndex + 1]?.position ?? null;
  return betweenPositions(before, after);
}

/**
 * Move the item at `fromIndex` to `toIndex` in a copy of `list` (immutable
 * `arrayMove`). Out-of-range indices clamp to the ends. Mirrors dnd-kit's
 * `arrayMove` so the reorder math can be tested without pulling in the library.
 */
export function moveItem<T>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  const next = list.slice();
  const from = Math.max(0, Math.min(list.length - 1, fromIndex));
  const to = Math.max(0, Math.min(list.length - 1, toIndex));
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
