import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
} from "lexical";
import { $createLinkNode } from "@lexical/link";
import {
  NOTES_INSERT_CHILD_LINK_EVENT,
  clearQueuedNotesChildLink,
  consumeNotesChildLinks,
  type NotesInsertChildLinkEventDetail,
} from "../../ui/layout-events";

export function NotesChildLinkPlugin({ noteId }: { noteId: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const insertChildLink = (detail: NotesInsertChildLinkEventDetail) => {
      editor.focus();
      editor.update(() => {
        const paragraph = $createParagraphNode();
        const link = $createLinkNode(`moduo://notes/${detail.childId}`);
        link.append($createTextNode(detail.childTitle || "Untitled"));
        paragraph.append(link);
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertNodes([paragraph]);
        } else {
          $getRoot().append(paragraph);
        }
        paragraph.selectEnd();
      });
      clearQueuedNotesChildLink(detail.parentId, detail.childId);
    };

    for (const pending of consumeNotesChildLinks(noteId)) {
      insertChildLink(pending);
    }

    const onInsertChildLink = (event: Event) => {
      const detail = (event as CustomEvent<NotesInsertChildLinkEventDetail>).detail;
      if (!detail || detail.parentId !== noteId) return;
      insertChildLink(detail);
    };

    window.addEventListener(NOTES_INSERT_CHILD_LINK_EVENT, onInsertChildLink);
    return () => window.removeEventListener(NOTES_INSERT_CHILD_LINK_EVENT, onInsertChildLink);
  }, [editor, noteId]);

  return null;
}
