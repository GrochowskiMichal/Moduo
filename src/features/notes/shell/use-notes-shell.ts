/**
 * State for the refreshed Notes shell (specs/notes-refresh.md NR-2): the open
 * note (URL-held `?id=`), lazy drafts and the capture shortcuts, the stored
 * sections, and the right panel. Composition lives in notes-shell.tsx.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onCreateNew } from "../../../components/app/create-events";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { dispatchLayoutPanelsSet, useFeaturePanelState } from "../../layout/panel-events";
import { type Draft, type DraftEvent, draftReducer, hasDraftContent } from "../draft-note";
import { tryDeriveNoteBody } from "../editor/doc-markdown";
import { useNotesModule } from "../hooks/use-notes-module";
import type { Note } from "../model";
import {
  consumeNotesNextPanelDefault,
  type NotesPanelVariantId,
  readNotesPanelVariant,
  writeNotesPanelVariant,
} from "../panel-prefs";
import type { NotesSearch } from "../search";
import { buildSidebarSections } from "../sections";

export type NotesShellState = ReturnType<typeof useNotesShell>;

export function useNotesShell() {
  const { runtime, userId, userEmail, configError } = useAuth();
  const workspace = useWorkspace();
  const { selectedWorkspaceId: workspaceId, modulePermissions } = workspace;
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as NotesSearch;

  const module = useNotesModule(runtime, {
    userId,
    workspaceId,
    modulePermission: modulePermissions.notes,
    withFavorites: true,
  });
  const { notes, favorites, loading, engine, canEdit, degraded } = module;
  const selectedId = search.id ?? null;

  const select = useCallback(
    (id: string | null, replace = false) => {
      void navigate({
        to: "/notes",
        replace,
        search: (prev: Record<string, unknown>) => {
          const next = { ...prev };
          delete next.action;
          if (id) next.id = id;
          else delete next.id;
          return next;
        },
      });
    },
    [navigate],
  );

  // ── lazy drafts (AC3) ──────────────────────────────────────────────────────
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const dispatchDraft = useCallback(
    (event: DraftEvent) => {
      const step = draftReducer(draftRef.current, event);
      draftRef.current = step.draft;
      setDraft(step.draft);
      for (const effect of step.effects) {
        if (effect.type === "discard") void engine?.discardDraft(effect.id);
        else void module.materializeDraft(effect.draft);
      }
    },
    [engine, module.materializeDraft],
  );

  /** A focused new note: in the Inbox (root), under a page (`parentId`), or
   * straight into Pages (`toPages`). Exists only here until its first character. */
  const openDraft = useCallback(
    (parentId: string | null = null, opts: { toPages?: boolean; replace?: boolean } = {}) => {
      if (!engine || !canEdit || degraded) return;
      const id = crypto.randomUUID();
      engine.openDraft(id);
      dispatchDraft({ type: "open", draft: { id, parentId, toPages: opts.toPages } });
      select(id, opts.replace ?? false);
    },
    [engine, canEdit, degraded, dispatchDraft, select],
  );

  useEffect(() => {
    dispatchDraft({ type: "navigate", toId: selectedId });
  }, [selectedId, dispatchDraft]);

  // A new engine (workspace switch, re-sign-in) discarded the old one's
  // drafts: drop ours too, and close it, or its editor would mount on the new
  // engine as an ordinary note and queue a push for a note that never existed.
  const engineRef = useRef(engine);
  useEffect(() => {
    if (engineRef.current === engine) return;
    engineRef.current = engine;
    const stale = draftRef.current;
    if (!stale) return;
    draftRef.current = null;
    setDraft(null);
    if (selectedId === stale.id) select(null, true);
  }, [engine, selectedId, select]);

  // The first real character materializes the draft — exactly once.
  const draftId = draft?.id ?? null;
  useEffect(() => {
    if (!draftId || !engine || !engine.isDraft(draftId)) return;
    const doc = engine.getOrCreateSession(draftId).doc;
    const onUpdate = () => {
      if (hasDraftContent(tryDeriveNoteBody(doc)?.text ?? ""))
        dispatchDraft({ type: "content", id: draftId });
    };
    doc.on("update", onUpdate);
    return () => doc.off("update", onUpdate);
  }, [draftId, engine, dispatchDraft]);

  // Capture: palette / ⌘⇧N (`?action=new`) and ⌘N / the bottom bar's +.
  const openDraftRef = useRef(openDraft);
  useEffect(() => {
    openDraftRef.current = openDraft;
  });
  useEffect(() => {
    if (search.action === "new" && canEdit && !loading) {
      openDraftRef.current(null, { replace: true });
    }
  }, [search.action, canEdit, loading]);
  useEffect(() => onCreateNew(() => openDraftRef.current(null)), []);

  // Stale deep link: loaded and the id is neither a note nor the draft.
  useEffect(() => {
    if (loading || !selectedId) return;
    if (selectedId === draftId && engine?.isDraft(draftId)) return;
    if (!notes.some((n) => n.id === selectedId)) select(null, true);
  }, [loading, selectedId, draftId, notes, select, engine]);

  // Opening a note jumps it to the front of the blank-note repair queue.
  useEffect(() => {
    if (loading || !selectedId || selectedId === draftId) return;
    void module.repairNoteNow(selectedId);
  }, [loading, selectedId, draftId, module.repairNoteNow]);

  // ── sections (the draft shows as an Untitled row where it will land) ───────
  const draftNote = useMemo<Note | null>(
    () => (draft && workspaceId ? draftAsNote(draft, workspaceId, userId) : null),
    [draft, workspaceId, userId],
  );
  const sidebarNotes = useMemo(
    () => (draftNote && !notes.some((n) => n.id === draftNote.id) ? [...notes, draftNote] : notes),
    [notes, draftNote],
  );
  const sections = useMemo(
    () => buildSidebarSections({ notes: sidebarNotes, favorites }),
    [sidebarNotes, favorites],
  );
  const selectedNote = useMemo(
    () => (selectedId ? (notes.find((n) => n.id === selectedId) ?? null) : null),
    [notes, selectedId],
  );

  // ── right panel: closed by default, variant remembered (AC5) ──────────────
  const panels = useFeaturePanelState("notes");
  const [panelVariant, setPanelVariant] = useState<NotesPanelVariantId>("detail");
  useEffect(() => {
    if (!userId || !workspaceId) return;
    setPanelVariant(readNotesPanelVariant(userId, workspaceId));
  }, [userId, workspaceId]);
  useEffect(() => {
    if (!userId || !consumeNotesNextPanelDefault(userId)) return;
    dispatchLayoutPanelsSet({ feature: "notes", left: panels.left, right: false });
    // Once per user, on first mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const setPanelOpen = useCallback(
    (open: boolean) =>
      dispatchLayoutPanelsSet({ feature: "notes", left: panels.left, right: open }),
    [panels.left],
  );
  const showPanelVariant = useCallback(
    (variant: NotesPanelVariantId) => {
      setPanelVariant(variant);
      if (userId && workspaceId) writeNotesPanelVariant(userId, workspaceId, variant);
      if (!panels.right) setPanelOpen(true);
    },
    [userId, workspaceId, panels.right, setPanelOpen],
  );

  return {
    runtime,
    userId,
    userEmail,
    configError,
    workspace,
    workspaceId,
    module,
    selectedId,
    selectedNote,
    select,
    draft,
    openDraft,
    sections,
    sidebarNotes,
    panelOpen: panels.right,
    setPanelOpen,
    panelVariant,
    showPanelVariant,
  };
}

function draftAsNote(draft: Draft, workspaceId: string, userId: string | null): Note {
  const now = new Date().toISOString();
  return {
    id: draft.id,
    workspaceId,
    createdBy: userId,
    parentId: draft.parentId,
    title: "",
    icon: null,
    isPinned: false,
    // Sorts last among siblings until the real create assigns a position.
    position: "~",
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    shareMode: draft.parentId ? "inherit" : "custom",
    workspaceShared: false,
    inInbox: draft.parentId === null && !draft.toPages,
    fullWidth: false,
  };
}
