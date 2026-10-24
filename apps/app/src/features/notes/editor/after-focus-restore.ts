/**
 * Run `fn` once the keystroke's editor update has settled. Lexical hands focus
 * back to the text when an update commits, so a menu or picker that takes
 * focus during the same keystroke loses it at once: the slash picker's input
 * went dead, and a Radix menu read the lost focus as a click away and closed
 * (docs/gotchas/notes.md). Returns a cancel.
 */
export const FOCUS_RESTORE_MS = 30;

export function afterFocusRestore(fn: () => void): () => void {
  const id = setTimeout(fn, FOCUS_RESTORE_MS);
  return () => clearTimeout(id);
}
