// The Timeline's keys (TV-TL1, keymap.md "Timeline", REPLAN 70) as a pure map
// from a keydown to an action, on the List's rules (list-keys.ts): modified
// keys belong to the app or the OS; a key typed in a field or a portaled menu
// never reaches the view.
//
//   ↑↓ · j k   move between rows
//   ← →        fold / unfold a project or section
//   ⏎          open (a task's full page; a project from All)
//   Space      complete a task (fold or unfold a header)
//   t          scroll to today
//   − =        zoom out / in (bare only: ⌘−/= stay the browser's)
//   ⇧[         hide or show the name column
//   Esc        clear the selection
//
// TV-TL2 adds ⌥←/→ (a day; ⇧ a week), D / ⇧D (the date picker / clear) and
// ⇧T (fit the selection): those keys fall through here (null) on purpose.

export type TimelineKeyAction =
  | "next"
  | "prev"
  | "fold"
  | "unfold"
  | "open"
  | "toggle"
  | "today"
  | "zoom-in"
  | "zoom-out"
  | "name-column"
  | "clear";

type Key = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** The Timeline action a keydown asks for, or null when the key isn't the view's. */
export function timelineKeyAction(event: Key): TimelineKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  // ⇧[ reads "{" on a US layout: match the physical key.
  if (event.shiftKey && event.code === "BracketLeft") return "name-column";
  switch (event.key) {
    case "ArrowDown":
      return event.shiftKey ? null : "next";
    case "ArrowUp":
      return event.shiftKey ? null : "prev";
    case "j":
    case "J":
      return event.shiftKey ? null : "next";
    case "k":
    case "K":
      return event.shiftKey ? null : "prev";
    case "ArrowLeft":
      return event.shiftKey ? null : "fold";
    case "ArrowRight":
      return event.shiftKey ? null : "unfold";
    case "Enter":
      return event.shiftKey ? null : "open";
    case " ":
      return event.shiftKey ? null : "toggle";
    case "t":
      return "today";
    case "-":
    case "_":
      return "zoom-out";
    case "=":
    case "+":
      return "zoom-in";
    case "Escape":
      return "clear";
    default:
      return null;
  }
}

/** Whether a keydown came from somewhere that keeps its own keys (a field, an editor). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
