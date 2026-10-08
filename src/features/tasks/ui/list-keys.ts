// The Tasks List's own keys (spec §8) as a pure map from a keydown to an
// action, so the rules that keep the List a good neighbour are unit-tested:
//
//   • Modified keys aren't the List's (tasks-v2 Q1-1). Any ⌘/Ctrl/Alt combo
//     belongs to the app (⌘K palette, ⌘⇧K capture, ⌘N, ⌘1–7…) or to the OS
//     (⌘C/⌘V/⌘X), except the ones the List explicitly binds — today only ⌘⌫.
//     Swallowing one also hides it from `useGlobalShortcuts`, which skips any
//     event that was already default-prevented.
//   • A row's own controls keep their Space/Enter (Q1-2). Pressed on the
//     check-off, the queue toggle, a chip or a popover trigger, the key
//     activates that button instead of completing or editing the selected task.
//   • Keys typed in a row's portaled surfaces (its popovers, its context menu)
//     never reach the List, though React bubbles them up to it.
//
// Shift isn't a bail-out: letters match case-insensitively (TV-U5 claims ⇧J/⇧K
// for extending the selection, checked before the lowercase match).

export type ListKeyAction =
  | "next"
  | "prev"
  | "toggle-done"
  | "edit"
  | "capture"
  | "bucket"
  | "schedule"
  | "due"
  | "queue"
  | "expand"
  | "collapse"
  | "delete";

type ListKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">;

/**
 * The attribute a row puts on its title button. Clicking the title is how a
 * row gets selected (and Chromium focuses a clicked button), so on the
 * SELECTED row's title Space/Enter stay the List's keys — complete and edit.
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
  const { key, metaKey, ctrlKey, altKey } = event;
  if (metaKey || ctrlKey || altKey) {
    const command = (metaKey || ctrlKey) && !altKey;
    return command && (key === "Backspace" || key === "Delete") ? "delete" : null;
  }
  if (opts.onControl && (key === " " || key === "Enter")) return null;
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
      return "edit";
  }
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
