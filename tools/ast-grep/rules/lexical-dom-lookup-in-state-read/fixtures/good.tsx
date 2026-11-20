// Fixed: read through the editor.
export function keyAt(editor: LexicalEditor, el: HTMLElement) {
  return editor.read(() => $getNearestNodeFromDOMNode(el)?.getKey() ?? null);
}
