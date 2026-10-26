/**
 * The note's reading column: the positioned box every editor overlay (block
 * handles, table bars, comment bubbles, the meta line) is placed in and
 * listens on. Found by its mark, not as the editable's parent: the editable
 * sits in its own wrapper (a contenteditable must not be a flex child).
 */
export function noteColumn(root: HTMLElement | null | undefined): HTMLElement | null {
  if (!root) return null;
  return root.closest<HTMLElement>("[data-note-column]") ?? root.parentElement;
}
