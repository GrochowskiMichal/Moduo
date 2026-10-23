/**
 * What the shell's gestures do (specs/notes-refresh.md NR-2): ⌫ to trash and
 * sidebar drops, each mapped onto one module op. Moving a shared note under a
 * private parent asks first ("Keep current access" / "Match the new parent";
 * Esc keeps). Notes carry no row or top-bar menu (Mike, 2026-10-24).
 */

import { useCallback, useRef, useState } from "react";

import { noteIsPrivate } from "../../sharing/rules";
import { descendantIds } from "../tree";
import type { DropIntent } from "./drop-intent";
import type { NotesShellState } from "./use-notes-shell";

export type SharingQuestion = { noteId: string; parentId: string; position: string };

export function useShellActions(
  shell: NotesShellState,
  trashWithDetach: (id: string) => Promise<void>,
) {
  const { module, select, selectedId } = shell;
  const { notes } = module;
  const [publishOpen, setPublishOpen] = useState(false);
  const [sharingQuestion, setSharingQuestionState] = useState<SharingQuestion | null>(null);
  // The dialog can answer twice (the button, then its own close); the ref
  // makes the second answer a no-op.
  const questionRef = useRef<SharingQuestion | null>(null);
  const setSharingQuestion = useCallback((q: SharingQuestion | null) => {
    questionRef.current = q;
    setSharingQuestionState(q);
  }, []);

  /** Trashing the open note (or a page above it) closes it. */
  const trash = useCallback(
    (id: string) => {
      const leaving = Boolean(
        selectedId && (selectedId === id || descendantIds(notes, id).includes(selectedId)),
      );
      void trashWithDetach(id);
      if (leaving) select(null, true);
    },
    [trashWithDetach, notes, selectedId, select],
  );

  const applyIntent = useCallback(
    (intent: DropIntent) => {
      switch (intent.kind) {
        case "favorite":
          module.setFavorite(intent.noteId, true, intent.position);
          return;
        case "file":
          module.fileNote(intent.noteId, intent.inInbox, intent.position);
          return;
        case "move": {
          const { noteId, parentId, position } = intent;
          // A shared note going under a private parent: ask, never silently.
          if (parentId && noteIsPrivate(parentId, notes) && !noteIsPrivate(noteId, notes)) {
            setSharingQuestion({ noteId, parentId, position });
            return;
          }
          void module.moveNote(noteId, parentId, position);
        }
      }
    },
    [module, notes, setSharingQuestion],
  );

  const answerSharing = useCallback(
    (match: boolean) => {
      const q = questionRef.current;
      setSharingQuestion(null);
      if (!q) return;
      // One server operation: the move and, for "Match the new parent", the
      // sharing change land together or not at all (a refusal toasts).
      void module.moveNote(q.noteId, q.parentId, q.position, { followParent: match });
    },
    [module, setSharingQuestion],
  );

  return {
    applyIntent,
    trash,
    publishOpen,
    setPublishOpen,
    sharingQuestion,
    answerSharing,
  };
}
