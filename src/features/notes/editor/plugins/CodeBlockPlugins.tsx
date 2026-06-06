import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
} from "lexical";
import { $isCodeNode } from "@lexical/code";

export function NotesCodeBlockEscapePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const shouldExit = editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          let node = selection.anchor.getNode();
          while (node && !$isCodeNode(node)) {
            const parent = node.getParent();
            if (!parent) return false;
            node = parent;
          }
          if (!$isCodeNode(node)) return false;
          return selection.anchor.offset === node.getTextContentSize();
        });

        if (!shouldExit) return false;
        event?.preventDefault();
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          let node = selection.anchor.getNode();
          while (node && !$isCodeNode(node)) {
            const parent = node.getParent();
            if (!parent) return;
            node = parent;
          }
          if (!$isCodeNode(node)) return;
          const paragraph = $createParagraphNode();
          node.insertAfter(paragraph);
          paragraph.select();
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const root = editor.getRootElement();
    if (!root) return unregisterEnter;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(".notes-code-block")) return;

      const codeBlocks = [...root.querySelectorAll<HTMLElement>(".notes-code-block")];
      const clickedTarget = codeBlocks.reduce<{ block: HTMLElement; placement: "before" | "after" } | null>((match, block) => {
        if (match) return match;
        const rect = block.getBoundingClientRect();
        const withinX = event.clientX >= rect.left && event.clientX <= rect.right;
        if (!withinX) return null;
        if (event.clientY >= rect.top - 36 && event.clientY < rect.top) return { block, placement: "before" };
        if (event.clientY > rect.bottom && event.clientY <= rect.bottom + 36) return { block, placement: "after" };
        return null;
      }, null);
      if (!clickedTarget) return;

      event.preventDefault();
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(clickedTarget.block);
        if (!$isCodeNode(node)) return;
        if (clickedTarget.placement === "before") {
          const prev = node.getPreviousSibling();
          if (prev?.getType() === "paragraph" && prev.getTextContent() === "") {
            prev.selectStart();
            return;
          }
          const paragraph = $createParagraphNode();
          node.insertBefore(paragraph);
          paragraph.select();
          return;
        }
        const next = node.getNextSibling();
        if (next?.getType() === "paragraph" && next.getTextContent() === "") {
          next.selectStart();
          return;
        }
        const paragraph = $createParagraphNode();
        node.insertAfter(paragraph);
        paragraph.select();
      });
    };

    root.addEventListener("pointerdown", onPointerDown);
    return () => {
      unregisterEnter();
      root.removeEventListener("pointerdown", onPointerDown);
    };
  }, [editor]);

  return null;
}
