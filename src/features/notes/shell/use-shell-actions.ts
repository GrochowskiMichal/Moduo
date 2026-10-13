/**
 * What the refreshed shell's gestures do (specs/notes-refresh.md NR-2): the row
 * and top-bar menu actions, sidebar drops and `Move to…`, each mapped onto
 * one module op. Moving a shared note under a private parent asks first
 * ("Keep current access" / "Match the new parent"; Esc keeps), in place of
 * classic's `window.confirm`.
 */

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { shareFollowParent } from "../../sharing/follow-parent";
import { noteIsPrivate } from "../../sharing/rules";
import { betweenPositions, endPosition } from "../../tasks/helpers";
import { downloadTextFile, noteFileName } from "../export";
import type { Note } from "../model";
import { deriveBody } from "../sync/doc-text";
import { displayTitle } from "../title";
import { descendantIds } from "../tree";
import { type DropIntent, type DropTarget, resolveDropIntent } from "./drop-intent";
import type { RowAction } from "./row-menu";
import type { NotesShellState } from "./use-notes-shell";

export type SharingQuestion = { noteId: string; parentId: string; position: string };

export function useShellActions(
  shell: NotesShellState,
  deps: { trash: (id: string) => Promise<void> },
) {
  const { module, select, selectedId, runtime, workspaceId, sections, openDraft } = shell;
  const { notes, favorites, engine } = module;
  const [moveTarget, setMoveTarget] = useState<Note | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [sharingQuestion, setSharingQuestionState] = useState<SharingQuestion | null>(null);
  // The dialog can answer twice (the button, then its own close); the ref
  // makes the second answer a no-op.
  const questionRef = useRef<SharingQuestion | null>(null);
  const setSharingQuestion = useCallback((q: SharingQuestion | null) => {
    questionRef.current = q;
    setSharingQuestionState(q);
  }, []);

  const exportNote = useCallback(
    async (note: Note) => {
      const name = displayTitle(note.title);
      // The open note derives freshest from its live doc; others read body_md.
      let md =
        engine && note.id === selectedId
          ? deriveBody(engine.getOrCreateSession(note.id).doc).md
          : "";
      if (!md && runtime && workspaceId) {
        try {
          const docs = await runtime.notesV2.fetchExportDocs({ workspaceId, ids: [note.id] });
          md = docs[0]?.bodyMd ?? "";
        } catch {
          toast.error("Couldn't export the note.");
          return;
        }
      }
      downloadTextFile(noteFileName(name), md || `# ${name}\n`);
    },
    [engine, selectedId, runtime, workspaceId],
  );

  const trash = useCallback(
    (id: string) => {
      const leaving =
        selectedId && (selectedId === id || descendantIds(notes, id).includes(selectedId));
      void deps.trash(id);
      if (leaving) select(null, true);
    },
    [deps, notes, selectedId, select],
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
      void module.moveNote(q.noteId, q.parentId, q.position).then((moved) => {
        if (!moved || !match) return;
        shareFollowParent(q.noteId).catch(() => {
          toast.error("Moved, but couldn't change who can see it. Check its sharing.");
        });
      });
    },
    [module, setSharingQuestion],
  );

  const pickMoveTarget = useCallback(
    (target: DropTarget) => {
      if (!moveTarget) return;
      const favoritePositions = new Map(favorites.map((f) => [f.noteId, f.position]));
      const intent = resolveDropIntent({
        notes,
        layout: sections,
        favoritePositions,
        dragId: moveTarget.id,
        target,
        pos: { endPosition, betweenPositions },
      });
      if (intent) applyIntent(intent);
    },
    [moveTarget, favorites, notes, sections, applyIntent],
  );

  const onAction = useCallback(
    (action: RowAction, note: Note) => {
      switch (action) {
        case "favorite":
        case "unfavorite":
          module.setFavorite(note.id, action === "favorite");
          return;
        case "subpage":
          openDraft(note.id);
          return;
        case "duplicate":
          void module.duplicateNote(note.id).then((copyId) => {
            if (copyId) select(copyId);
          });
          return;
        case "move":
          setMoveTarget(note);
          return;
        case "export":
          void exportNote(note);
          return;
        case "publish":
          if (note.id !== selectedId) select(note.id);
          setPublishOpen(true);
          return;
        case "archive":
          module.archiveNote(note.id, true);
          return;
        case "trash":
          trash(note.id);
      }
    },
    [module, openDraft, select, selectedId, exportNote, trash],
  );

  return {
    onAction,
    applyIntent,
    trash,
    moveTarget,
    setMoveTarget,
    pickMoveTarget,
    publishOpen,
    setPublishOpen,
    sharingQuestion,
    answerSharing,
  };
}
