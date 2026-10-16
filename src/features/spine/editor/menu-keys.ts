// One keyboard regime for every caret menu in a Lexical surface (NR-4, AC7):
// the `/` commands, the `@` mentions and the Notes `[[` note picker.
// ↑ / ↓ move the highlight (wrapping), ↵ or Tab picks, Esc closes and keeps the
// typed text, and a pointer-down anywhere outside the menu closes it. The menu
// never takes focus: the caret stays in the text, so typing keeps filtering.
// Keys are taken from the editor only while a menu is open with something in
// it, so ordinary typing never loses a key.

import { mergeRegister } from "@lexical/utils";
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from "lexical";

export type MenuKeyHandlers = {
  /** A menu is drawn (Esc is taken only then). */
  isOpen: () => boolean;
  /** How many rows it has now (arrows and picks need at least one). */
  count: () => number;
  index: () => number;
  setIndex: (index: number) => void;
  pick: (index: number) => void;
  close: () => void;
};

/** The highlight after one arrow press, wrapping at both ends. */
export function stepMenuIndex(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return (((index + direction) % count) + count) % count;
}

/** Register the shared menu keys on `editor`; returns the cleanup. */
export function registerMenuKeys(editor: LexicalEditor, menu: MenuKeyHandlers): () => void {
  const hasRows = () => menu.isOpen() && menu.count() > 0;
  const arrow = (direction: 1 | -1) => (event: KeyboardEvent | null) => {
    if (!hasRows()) return false;
    event?.preventDefault();
    menu.setIndex(stepMenuIndex(menu.index(), menu.count(), direction));
    return true;
  };
  const pick = (event: KeyboardEvent | null) => {
    if (!hasRows()) return false;
    event?.preventDefault();
    menu.pick(Math.min(menu.index(), menu.count() - 1));
    return true;
  };
  return mergeRegister(
    editor.registerCommand(KEY_ARROW_DOWN_COMMAND, arrow(1), COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_ARROW_UP_COMMAND, arrow(-1), COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_ENTER_COMMAND, pick, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_TAB_COMMAND, pick, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        if (!menu.isOpen()) return false;
        event?.preventDefault();
        menu.close();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  );
}

/**
 * Close a menu on a pointer-down outside it (capture phase, so a click that
 * lands on something which stops propagation still counts). `inside` decides
 * what belongs to the menu. Returns the cleanup.
 */
export function closeOnOutsidePointer(
  inside: (target: Node) => boolean,
  close: () => void,
): () => void {
  if (typeof document === "undefined") return () => {};
  const onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && inside(event.target)) return;
    close();
  };
  document.addEventListener("pointerdown", onPointerDown, { capture: true });
  return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
}
