import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  INDENT_CONTENT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  type LexicalNode,
} from "lexical";
import { $isListItemNode } from "@lexical/list";
import { $createToggleNode, $isToggleNode, ToggleNode } from "../nodes/ToggleNode";

export type ToggleTitleEnterAction = "remove" | "body" | "sibling";

export function resolveToggleTitleEnterAction(options: { titleText: string; isOpen: boolean }): ToggleTitleEnterAction {
  if (options.titleText.trim().length === 0) return "remove";
  return options.isOpen ? "body" : "sibling";
}

function findToggleChildFromSelection(): { toggle: ToggleNode; child: LexicalNode } | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  let node: LexicalNode | null = selection.anchor.getNode();
  while (node) {
    const parent: LexicalNode | null = node.getParent();
    if (parent && $isToggleNode(parent)) {
      return { toggle: parent, child: node };
    }
    node = parent;
  }
  return null;
}

function isAtSelectionStart(): boolean {
  const selection = $getSelection();
  return $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.offset === 0;
}

function removeToggleShell(toggle: ToggleNode, selectStart = true): void {
  const children = toggle.getChildren();
  const firstChild = children[0];

  if (!firstChild) {
    const paragraph = $createParagraphNode();
    toggle.replace(paragraph);
    paragraph.selectStart();
    return;
  }

  let previous: LexicalNode | null = null;
  for (const child of children) {
    if (previous) {
      previous.insertAfter(child);
    } else {
      toggle.insertBefore(child);
    }
    previous = child;
  }

  toggle.remove();
  if ($isElementNode(firstChild)) {
    selectStart ? firstChild.selectStart() : firstChild.selectEnd();
  } else {
    firstChild.selectPrevious();
  }
}

function insertToggleBodyParagraph(toggle: ToggleNode, titleChild: LexicalNode): void {
  const paragraph = $createParagraphNode();
  toggle.setOpen(true);
  titleChild.insertAfter(paragraph);
  paragraph.selectStart();
}

function insertSiblingToggle(toggle: ToggleNode): void {
  const sibling = $createToggleNode(false, "");
  toggle.insertAfter(sibling);
  sibling.selectEnd();
}

function selectionHasListItemAncestor(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

  let node: LexicalNode | null = selection.anchor.getNode();
  while (node) {
    if ($isListItemNode(node)) return true;
    node = node.getParent();
  }
  return false;
}

export function NotesToggleInteractionPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest<HTMLElement>("[data-toggle-button]");
      const wrapper = button?.closest<HTMLElement>("[data-toggle-key]");
      const key = wrapper?.dataset.toggleKey;
      if (!key) return;

      event.preventDefault();
      editor.update(() => {
        const node = $getNodeByKey(key);
        if ($isToggleNode(node)) node.toggleOpen();
      });
    };

    root.addEventListener("pointerdown", onPointerDown);
    return () => root.removeEventListener("pointerdown", onPointerDown);
  }, [editor]);

  return null;
}

export function NotesToggleEscapePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterToggleKey = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return false;

        const shouldToggle = editor.getEditorState().read(() => Boolean(findToggleChildFromSelection()));
        if (!shouldToggle) return false;

        event.preventDefault();
        editor.update(() => {
          const context = findToggleChildFromSelection();
          if (context) context.toggle.toggleOpen();
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const unregisterBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event: KeyboardEvent) => {
        const shouldEscape = editor.getEditorState().read(() => {
          const context = findToggleChildFromSelection();
          return Boolean(context && context.toggle.getFirstChild() === context.child && isAtSelectionStart());
        });

        if (!shouldEscape) return false;

        event.preventDefault();
        editor.update(() => {
          const context = findToggleChildFromSelection();
          if (!context || context.toggle.getFirstChild() !== context.child) return;
          removeToggleShell(context.toggle);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event && (event.metaKey || event.ctrlKey)) return false;

        const action = editor.getEditorState().read<"remove" | "body" | "sibling" | null>(() => {
          const context = findToggleChildFromSelection();
          if (!context) return null;

          const { toggle, child } = context;
          const firstChild = toggle.getFirstChild();
          if (firstChild === child) {
            return resolveToggleTitleEnterAction({
              titleText: child.getTextContent(),
              isOpen: toggle.isOpen(),
            });
          }
          return null;
        });

        if (!action) return false;

        event?.preventDefault();
        editor.update(() => {
          const context = findToggleChildFromSelection();
          if (!context) return;

          const { toggle, child } = context;
          if (action === "remove" && toggle.getFirstChild() === child) {
            removeToggleShell(toggle);
            return;
          }
          if (action === "body" && toggle.getFirstChild() === child) {
            insertToggleBodyParagraph(toggle, child);
            return;
          }
          if (action === "sibling" && toggle.getFirstChild() === child) {
            insertSiblingToggle(toggle);
          }
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    return () => {
      unregisterToggleKey();
      unregisterBackspace();
      unregisterEnter();
    };
  }, [editor]);

  return null;
}

export function NotesToggleTabPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const applyToggleTabAction = (event: KeyboardEvent): boolean => {
      const action = editor.getEditorState().read<"indent" | "outdent" | null>(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
        if (selectionHasListItemAncestor()) return null;

        let node: LexicalNode | null = selection.anchor.getNode();
        while (node) {
          const parent: LexicalNode | null = node.getParent();
          if (parent && $isToggleNode(parent)) {
            return event.shiftKey && parent.getFirstChild() !== node ? "outdent" : null;
          }
          if (parent?.getType() === "root") {
            if (event.shiftKey) return null;
            const previousSibling = node.getPreviousSibling();
            return $isToggleNode(previousSibling) ? "indent" : null;
          }
          node = parent;
        }
        return null;
      });

      if (!action) return false;

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

        let node: LexicalNode | null = selection.anchor.getNode();
        while (node) {
          const parent: LexicalNode | null = node.getParent();
          if (action === "outdent" && parent && $isToggleNode(parent) && parent.getFirstChild() !== node) {
            parent.insertAfter(node);
            if ($isElementNode(node)) node.selectStart();
            return;
          }
          if (action === "indent" && parent?.getType() === "root") {
            const previousSibling = node.getPreviousSibling();
            if (!$isToggleNode(previousSibling)) return;
            previousSibling.append(node);
            previousSibling.setOpen(true);
            if ($isElementNode(node)) node.selectStart();
            return;
          }
          node = parent;
        }
      });
      return true;
    };

    const unregisterTabCommand = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent) => {
        if (!event) return false;
        const handled = applyToggleTabAction(event);
        if (!handled) return false;
        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const root = editor.getRootElement();
    if (!root) return unregisterTabCommand;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const activeElement = document.activeElement;
      if (!activeElement || !root.contains(activeElement)) return;

      event.preventDefault();
      event.stopPropagation();

      const listContext = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return { inListItem: false, canIndent: false };
        let node: LexicalNode | null = selection.anchor.getNode();
        while (node && !$isListItemNode(node)) {
          const parent: LexicalNode | null = node.getParent();
          if (!parent) break;
          node = parent;
        }
        if (!$isListItemNode(node)) return { inListItem: false, canIndent: false };
        return {
          inListItem: true,
          canIndent: $isListItemNode(node.getPreviousSibling()),
        };
      });

      if (listContext.inListItem) {
        if (event.shiftKey || listContext.canIndent) {
          editor.dispatchCommand(event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined);
        }
        return;
      }

      if (applyToggleTabAction(event)) return;
      editor.dispatchCommand(event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined);
    };

    root.addEventListener("keydown", onKeyDown, true);
    return () => {
      unregisterTabCommand();
      root.removeEventListener("keydown", onKeyDown, true);
    };
  }, [editor]);

  return null;
}
