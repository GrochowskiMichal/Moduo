// Pure ordering math for drag-to-reorder. No React, no IO — unit-tested.
//
// Lists and boards are ordered by `position` (a Lexorank-style text column), so
// a reorder slots a fractional key between the new neighbours. The personal
// Queue moves through its own op (see queue.ts).

import { betweenPositions } from "./helpers";
import type { Task } from "./model";

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
  const before = toIndex > 0 ? (ordered[toIndex - 1]?.position ?? null) : null;
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
