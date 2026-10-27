// Fixed: the handler is already in an update; do the work in place.
export function useUndoChip(editor: LexicalEditor) {
  return editor.registerCommand(
    KEY_ESCAPE_COMMAND,
    () => {
      const node = $getNodeByKey(key);
      if (!node) return false;
      node.remove();
      // A deferred update (a timer, a listener) is outside the command: fine.
      setTimeout(() => editor.update(() => $getRoot().selectEnd()), 0);
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
}
