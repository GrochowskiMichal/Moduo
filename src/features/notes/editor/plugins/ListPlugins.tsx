import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import { $isListItemNode } from "@lexical/list";

export function NotesListTabIndentationPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        if (!event) return false;
        const listContext = editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return { inListItem: false, canIndent: false };
          let node = selection.anchor.getNode();
          while (node && !$isListItemNode(node)) {
            const parent = node.getParent();
            if (!parent) break;
            node = parent;
          }
          if (!$isListItemNode(node)) return { inListItem: false, canIndent: false };

          const hasPreviousSibling = $isListItemNode(node.getPreviousSibling());

          return {
            inListItem: true,
            canIndent: hasPreviousSibling,
          };
        });
        if (!listContext.inListItem) return false;

        event.preventDefault();

        if (!event.shiftKey && !listContext.canIndent) {
          return true;
        }

        editor.dispatchCommand(event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  return null;
}
