// The Tasks List's own keys (spec §8) as a pure map from a keydown to an
// action, so the rules that keep the List a good neighbour are unit-tested:
//
//   • Modified keys aren't the List's (tasks-v2 Q1-1). Any ⌘/Ctrl/Alt combo
//     belongs to the app (⌘K palette, ⌘⇧K capture, ⌘N, ⌘1–7…) or to the OS
//     (⌘C/⌘V/⌘X), except the ones the List explicitly binds: ⌘⌫, and ⌥⇧↑/↓
//     to move a task in the manual order (the keymap's move keys, TV-U4).
//     Swallowing one also hides it from `useGlobalShortcuts`, which skips any
//     event that was already default-prevented.
//   • A row's own controls keep their Space/Enter (Q1-2). Pressed on the
//     check-off, the queue toggle, a chip or a popover trigger, the key
//     activates that button instead of completing or editing the selected task.
//   • Keys typed in a row's portaled surfaces (its popovers, its context menu)
//     never reach the List, though React bubbles them up to it.
//
// Shift isn't a bail-out: letters match case-insensitively (⇧J/⇧K and ⇧↑/⇧↓
// extend the selection, TV-U12, checked before the lowercase match; ⇧S opens
// the status menu, TV-U10), and `>` / `<` (nest under the row above, un-nest;
// default k) match `event.key`, whatever the keyboard needs to type them.

export type ListKeyAction =
  | "next"
  | "prev"
  | "toggle-done"
  | "open"
  | "edit"
  | "capture"
  | "bucket"
  | "schedule"
  | "due"
  | "status"
  | "queue"
  | "focus-on"
  | "expand"
  | "collapse"
  | "delete"
  | "nest"
  | "unnest"
  | "move-up"
  | "move-down"
  /** ⇧↓ / ⇧J and ⇧↑ / ⇧K: the selection grows to the next row (TV-U12). */
  | "extend-next"
  | "extend-prev"
  /** ⌘A: every row the view shows. */
  | "select-all"
  /** Esc: back to the cursor alone (only while several are selected). */
  | "clear-selection";

type ListKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey"> &
  Partial<Pick<KeyboardEvent, "shiftKey">>;

/**
 * The attribute a row puts on its title button. Clicking the title is how a
 * row gets selected (and Chromium focuses a clicked button), so on the
 * SELECTED row's title Space/Enter stay the List's keys — complete and open.
 */
export const ROW_TITLE_ATTR = "data-row-title";

/**
 * Whether a keydown target is one of a row's own controls, which keep their
 * Space/Enter. The List container itself and the selected row's title are
 * not; another row's title (reached with Tab) is, so Space/Enter there select
 * that row rather than acting on a different, selected one.
 */
export function isRowControl(target: EventTarget | null, list: Element): boolean {
  if (!(target instanceof Element) || target === list) return false;
  const selectedTitle =
    target.hasAttribute(ROW_TITLE_ATTR) &&
    target.closest('[role="row"]')?.getAttribute("aria-selected") === "true";
  return !selectedTitle;
}

/**
 * The List action for a keydown that reached the List container: null for
 * keys from a portaled surface (outside the container in the DOM), modified
 * keys, and a row control's own Space/Enter.
 */
export function listKeyActionFor(
  event: ListKey & { target: EventTarget | null },
  list: Element,
): ListKeyAction | null {
  if (!(event.target instanceof Node) || !list.contains(event.target)) return null;
  return listKeyAction(event, { onControl: isRowControl(event.target, list) });
}

/** The List action a keydown asks for, or null when the key isn't the List's. */
export function listKeyAction(
  event: ListKey,
  opts: { onControl?: boolean } = {},
): ListKeyAction | null {
  const { key, metaKey, ctrlKey, altKey, shiftKey } = event;
  if (metaKey || ctrlKey || altKey) {
    if (altKey && shiftKey && !metaKey && !ctrlKey) {
      if (key === "ArrowUp") return "move-up";
      if (key === "ArrowDown") return "move-down";
    }
    const command = (metaKey || ctrlKey) && !altKey;
    // ⌘A selects the view (an explicit binding, keymap; never the page's text).
    if (command && !shiftKey && key.toLowerCase() === "a") return "select-all";
    return command && (key === "Backspace" || key === "Delete") ? "delete" : null;
  }
  if (opts.onControl && (key === " " || key === "Enter")) return null;
  if (key === "Escape") return "clear-selection";
  if (shiftKey) {
    if (key === "ArrowDown" || key.toLowerCase() === "j") return "extend-next";
    if (key === "ArrowUp" || key.toLowerCase() === "k") return "extend-prev";
  }
  switch (key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "prev";
    case "ArrowRight":
      return "expand";
    case "ArrowLeft":
      return "collapse";
    case " ":
      return "toggle-done";
    case "Enter":
      // ⏎ opens, `e` edits (decision 22, TV-U10).
      return "open";
    case ">":
      return "nest";
    case "<":
      return "unnest";
  }
  // ⇧S: the status menu (default k), before `s` (schedule) matches below.
  if (shiftKey && key.toLowerCase() === "s") return "status";
  // ⇧F "Focus on this" (call 31); a bare f stays Filter's (use-tasks-filters).
  if (shiftKey && key.toLowerCase() === "f") return "focus-on";
  switch (key.toLowerCase()) {
    case "j":
      return "next";
    case "k":
      return "prev";
    case "x":
      return "toggle-done";
    case "e":
      return "edit";
    case "c":
      return "capture";
    case "b":
      return "bucket";
    case "s":
      return "schedule";
    case "d":
      return "due";
    case "q":
      return "queue";
    default:
      return null;
  }
}
