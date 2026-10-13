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
// TV-TL2's (REPLAN 70; keymap rule 1 makes the ⌥ arrows explicit bindings,
// rule 2 checks ⇧ letters before the bare ones):
//   ⌥← ⌥→      move the date a day earlier / later (⌥⇧ a week)
//   d · ⇧D     the date picker · clear the due date
//   ⇧T         fit the selection (its marks in view)
//   ⇧↑ ⇧↓      extend the selection (TV-U12)
//   ⌘A         select every task row

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
  | "clear"
  | "shift-earlier"
  | "shift-later"
  | "shift-earlier-week"
  | "shift-later-week"
  | "date"
  | "clear-date"
  | "fit"
  | "extend-next"
  | "extend-prev"
  | "select-all";

type Key = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** How many days a ⌥ arrow moves a date (⇧ a week), signed; 0 when it isn't one. */
export function shiftDaysOf(action: TimelineKeyAction): number {
  switch (action) {
    case "shift-earlier":
      return -1;
    case "shift-later":
      return 1;
    case "shift-earlier-week":
      return -7;
    case "shift-later-week":
      return 7;
    default:
      return 0;
  }
}

/** The Timeline action a keydown asks for, or null when the key isn't the view's. */
export function timelineKeyAction(event: Key): TimelineKeyAction | null {
  // ⌥←/→ (⌥⇧ a week) move a date: explicit bindings past the modifier guard.
  if (event.altKey && !event.metaKey && !event.ctrlKey) {
    if (event.key === "ArrowLeft") return event.shiftKey ? "shift-earlier-week" : "shift-earlier";
    if (event.key === "ArrowRight") return event.shiftKey ? "shift-later-week" : "shift-later";
    return null;
  }
  // ⌘A selects every task row; every other modified key is the app's or the OS's.
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
    return event.key === "a" || event.key === "A" ? "select-all" : null;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  // ⇧[ reads "{" on a US layout: match the physical key.
  if (event.shiftKey && event.code === "BracketLeft") return "name-column";
  if (event.shiftKey && (event.key === "D" || event.key === "d")) return "clear-date";
  if (event.shiftKey && (event.key === "T" || event.key === "t")) return "fit";
  switch (event.key) {
    case "ArrowDown":
      return event.shiftKey ? "extend-next" : "next";
    case "ArrowUp":
      return event.shiftKey ? "extend-prev" : "prev";
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
    case "d":
      return "date";
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
