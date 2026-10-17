// The Board's keys (TV-U11; keymap "rows" plus the Board's ←→): the List's
// key map (list-keys.ts) with the arrows turned sideways. Pure, so the rules
// are unit-tested:
//
//   • ↑↓ (and j/k) move within a column; ←→ go to the next column that has
//     cards, at the nearest place (research §4).
//   • ⌥⇧↑/↓ move the card among its column's cards (manual order only);
//     ⌥⇧←/→ move it to the next column that takes it (its field changes).
//   • ⏎ opens, `e` edits, Space and `x` finish, ⇧S status, `c` adds into the
//     selected card's column, `s` `d` `b` `q` ⌘⌫ as in the List.
//   • `>` and `<` (nesting) are the List's: a board has no row above.

import { isRowControl, type ListKeyAction, listKeyAction } from "./list-keys";

export type BoardKeyAction =
  | Exclude<ListKeyAction, "expand" | "collapse" | "nest" | "unnest">
  | "left"
  | "right"
  | "move-left"
  | "move-right";

type BoardKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey"> &
  Partial<Pick<KeyboardEvent, "shiftKey">>;

/** The Board action a keydown asks for, or null when the key isn't the Board's. */
export function boardKeyAction(
  event: BoardKey,
  opts: { onControl?: boolean } = {},
): BoardKeyAction | null {
  const { key, metaKey, ctrlKey, altKey, shiftKey } = event;
  if (altKey && shiftKey && !metaKey && !ctrlKey) {
    if (key === "ArrowLeft") return "move-left";
    if (key === "ArrowRight") return "move-right";
  }
  const action = listKeyAction(event, opts);
  switch (action) {
    case "expand":
      return "right";
    case "collapse":
      return "left";
    case "nest":
    case "unnest":
      return null;
    default:
      return action;
  }
}

/**
 * The Board action for a keydown that reached the board: null for keys from
 * a portaled surface (a card's menu or popover), modified keys, and a card
 * control's own Space/Enter.
 */
export function boardKeyActionFor(
  event: BoardKey & { target: EventTarget | null },
  board: Element,
): BoardKeyAction | null {
  if (!(event.target instanceof Node) || !board.contains(event.target)) return null;
  return boardKeyAction(event, { onControl: isRowControl(event.target, board) });
}

/** The cards a person can walk to, column by column, in order. */
export type BoardGrid = ReadonlyArray<{ id: string; ids: readonly string[] }>;

/**
 * Where a cursor key takes the selection: the next card in the column (↑↓),
 * or the nearest card of the next column that has cards (←→). With nothing
 * selected (or a selection off the board) any key starts at the first card.
 * Null: nowhere to go.
 */
export function moveInGrid(
  grid: BoardGrid,
  selectedId: string | null,
  dir: "up" | "down" | "left" | "right",
): string | null {
  const col = selectedId ? grid.findIndex((c) => c.ids.includes(selectedId)) : -1;
  if (col < 0) return grid.find((c) => c.ids.length > 0)?.ids[0] ?? null;
  const ids = grid[col].ids;
  const at = ids.indexOf(selectedId as string);
  if (dir === "up") return at > 0 ? ids[at - 1] : null;
  if (dir === "down") return at < ids.length - 1 ? ids[at + 1] : null;
  const step = dir === "left" ? -1 : 1;
  for (let i = col + step; i >= 0 && i < grid.length; i += step) {
    const next = grid[i].ids;
    if (next.length > 0) return next[Math.min(at, next.length - 1)];
  }
  return null;
}
