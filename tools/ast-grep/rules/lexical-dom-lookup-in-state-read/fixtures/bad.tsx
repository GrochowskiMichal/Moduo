// Pre-fix shape: the state read has no editor bound.
export function keyAt(editor: LexicalEditor, el: HTMLElement) {
  return editor.getEditorState().read(() => {
    // @flag
    const node = $getNearestNodeFromDOMNode(el);
    return node?.getKey() ?? null;
  });
}
