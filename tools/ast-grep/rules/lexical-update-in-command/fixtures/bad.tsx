// Pre-fix shape: a flag set inside a nested update, read after it.
export function useUndoChip(editor: LexicalEditor) {
  return editor.registerCommand(
    KEY_ESCAPE_COMMAND,
    () => {
      let undone = false;
      // @flag
      editor.update(() => {
        undone = true;
      });
      return undone;
    },
    COMMAND_PRIORITY_HIGH,
  );
}
