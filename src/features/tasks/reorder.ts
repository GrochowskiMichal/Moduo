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

/**
 * Where a board card lands (TV-U1): the `position` for `activeId` dropped on
 * the card `overId`, or at the end of the column when `overId` is null. Both
 * lists hold EVERY task of their column in order, hidden completed ones
 * included, so the new key can never equal a hidden task's (`position` also
 * orders the List). Within a column the card moves to the hovered card's
 * index, so it lands on the same side of it as on screen. Null = no move.
 */
export function boardDropPosition(input: {
  activeId: string;
  overId: string | null;
  /** The column the card comes from, every task in order. */
  source: ReadonlyArray<Pick<Task, "id" | "position">>;
  /** The column it's dropped in; the same array as `source` for a reorder. */
  dest: ReadonlyArray<Pick<Task, "id" | "position">>;
}): string | null {
  const { activeId, overId, source, dest } = input;
  if (source === dest) {
    if (overId === null) return null; // dropped on its own column's gutter
    const from = source.findIndex((t) => t.id === activeId);
    const to = source.findIndex((t) => t.id === overId);
    if (from < 0 || to < 0 || from === to) return null;
    return positionForReorder(moveItem(source, from, to), to);
  }
  const moving = source.find((t) => t.id === activeId);
  if (!moving) return null;
  const overIdx = overId === null ? -1 : dest.findIndex((t) => t.id === overId);
  const at = overIdx < 0 ? dest.length : overIdx;
  return positionForReorder([...dest.slice(0, at), moving, ...dest.slice(at)], at);
}
