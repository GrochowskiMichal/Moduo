import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModuoRuntime } from "../../../lib/runtime";
import { NotesSyncEngine } from "../sync/sync-engine";
import type { NoteKind, NoteMeta } from "../types";
import { generatePosition, initialPosition } from "../utils/position";

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sortNotes(a: NoteMeta, b: NoteMeta): number {
  if (a.parentId !== b.parentId) return (a.parentId ?? "").localeCompare(b.parentId ?? "");
  return a.position.localeCompare(b.position);
}

function normalizeKind(kind: unknown): NoteKind {
  return kind === "note" ? "note" : "folder";
}

function normalizeNote(note: any): NoteMeta {
  return {
    id: note.id,
    workspaceId: note.workspaceId ?? note.workspace_id,
    ownerId: note.ownerId ?? note.owner_id,
    parentId: note.parentId ?? note.parent_id ?? null,
    title: note.title ?? "Untitled",
    icon: note.icon ?? null,
    kind: normalizeKind(note.kind),
    tags: Array.isArray(note.tags) ? note.tags : [],
    isPinned: !!(note.isPinned ?? note.is_pinned),
    position: note.position ?? initialPosition(),
    isArchived: !!(note.isArchived ?? note.is_archived),
    createdAt: note.createdAt ?? note.created_at ?? nowIso(),
    updatedAt: note.updatedAt ?? note.updated_at ?? nowIso(),
    deletedAt: note.deletedAt ?? note.deleted_at ?? null,
  };
}

type UseNotesParams = {
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: "none" | "view" | "edit" | "admin";
};

export function useNotes(runtime: ModuoRuntime | null, params: UseNotesParams) {
  const { userId, workspaceId, modulePermission = "none" } = params;
  const canRead = modulePermission !== "none";
  const canEdit = modulePermission === "edit" || modulePermission === "admin";

  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const syncEngine = useMemo(() => {
    if (!runtime || !userId || !workspaceId) return null;
    return new NotesSyncEngine(runtime, userId, workspaceId);
  }, [runtime, userId, workspaceId]);

  const ensureSelectedNote = useCallback((current: NoteMeta[], preferredId?: string | null) => {
    const existingId = preferredId ?? selectedNoteId;
    const visible = current
      .filter((note) => !note.deletedAt && !note.isArchived)
      .sort(sortNotes);
    if (visible.length === 0) {
      setSelectedNoteId(null);
      return;
    }

    if (existingId && visible.some((note) => note.id === existingId)) {
      setSelectedNoteId(existingId);
      return;
    }

    setSelectedNoteId(visible[0].id);
  }, [selectedNoteId]);

  const loadNotes = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    const rows = await runtime.notes.list(workspaceId);
    const mapped = rows.map(normalizeNote).sort(sortNotes);
    setNotes(mapped);
    ensureSelectedNote(mapped);
  }, [ensureSelectedNote, runtime, workspaceId]);

  const updateNotesState = useCallback(
    (updater: (current: NoteMeta[]) => NoteMeta[]) => {
      let nextSnapshot: NoteMeta[] | null = null;
      setNotes((current) => {
        const next = updater(current).sort(sortNotes);
        nextSnapshot = next;
        return next;
      });
      if (nextSnapshot) ensureSelectedNote(nextSnapshot);
    },
    [ensureSelectedNote]
  );

  const upsertNoteInState = useCallback(
    (note: NoteMeta) => {
      updateNotesState((current) => {
        const index = current.findIndex((entry) => entry.id === note.id);
        if (index === -1) return [...current, note];
        const next = [...current];
        next[index] = note;
        return next;
      });
    },
    [updateNotesState]
  );

  useEffect(() => {
    if (!runtime || !workspaceId || !canRead) {
      setNotes([]);
      setSelectedNoteId(null);
      setLoading(false);
      return;
    }

    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        await loadNotes();
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [canRead, loadNotes, runtime, workspaceId]);

  useEffect(() => {
    if (!syncEngine) return;
    return () => {
      void syncEngine.destroy();
    };
  }, [syncEngine]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onRefresh = () => {
      void loadNotes();
    };
    window.addEventListener("moduo:data-refresh", onRefresh);
    return () => {
      window.removeEventListener("moduo:data-refresh", onRefresh);
    };
  }, [loadNotes]);

  const createNote = useCallback(async (parentId: string | null = null, kind: NoteKind = "note") => {
    if (!runtime || !userId || !workspaceId || !canEdit) return null;

    const siblings = notes
      .filter(
        (note) =>
          note.parentId === parentId &&
          !note.deletedAt
      )
      .sort((a, b) => a.position.localeCompare(b.position));

    const position = siblings.length
      ? generatePosition(siblings[siblings.length - 1]?.position, null)
      : initialPosition();

    const defaultTitle = kind === "folder" ? "New Note Folder" : "New Note";

    const note: NoteMeta = {
      id: safeId(),
      workspaceId,
      ownerId: userId,
      parentId,
      title: defaultTitle,
      icon: null,
      kind,
      tags: [],
      isPinned: false,
      position,
      isArchived: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
    };

    try {
      const saved = normalizeNote(await runtime.notes.upsert(note));
      upsertNoteInState(saved);
      setSelectedNoteId(saved.id);
      return saved.id;
    } catch (e) {
      console.error(`[useNotes] createNote upsert ERROR:`, e);
      await loadNotes();
      return null;
    }
  }, [canEdit, loadNotes, notes, runtime, upsertNoteInState, userId, workspaceId]);

  const updateNoteTitle = useCallback(async (noteId: string, title: string) => {
    if (!runtime || !workspaceId || !canEdit) return;
    const current = notes.find((note) => note.id === noteId);
    if (!current) return;

    const optimistic: NoteMeta = { ...current, title, updatedAt: nowIso() };
    upsertNoteInState(optimistic);
    try {
      const saved = normalizeNote(await runtime.notes.upsert(optimistic));
      upsertNoteInState(saved);
    } catch {
      upsertNoteInState(current);
      await loadNotes();
    }
  }, [canEdit, loadNotes, notes, runtime, upsertNoteInState, workspaceId]);

  const computePositionForMove = useCallback(
    (
      noteId: string,
      targetParentId: string | null,
      beforeId: string | null
    ) => {
      const siblings = notes
        .filter(
          (note) =>
            note.parentId === targetParentId &&
            note.id !== noteId &&
            !note.deletedAt
        )
        .sort((a, b) => a.position.localeCompare(b.position));

      if (!beforeId) {
        return generatePosition(siblings[siblings.length - 1]?.position ?? null, null);
      }

      const index = siblings.findIndex((note) => note.id === beforeId);
      if (index === -1) {
        return generatePosition(siblings[siblings.length - 1]?.position ?? null, null);
      }

      const prev = index > 0 ? siblings[index - 1] : null;
      const next = siblings[index];
      return generatePosition(prev?.position ?? null, next?.position ?? null);
    },
    [notes]
  );

  const moveNote = useCallback(async (noteId: string, newParentId: string | null, beforeId: string | null = null) => {
    if (!runtime || !workspaceId || !canEdit) return;
    const current = notes.find((note) => note.id === noteId);
    if (!current) return;
    if (newParentId === noteId) return;

    const notesById = new Map(
      notes
        .filter((note) => !note.deletedAt)
        .map((note) => [note.id, note] as const)
    );
    if (newParentId) {
      const targetParent = notesById.get(newParentId);
      if (!targetParent) return;

      const visited = new Set<string>();
      let cursor: string | null = newParentId;
      while (cursor && !visited.has(cursor)) {
        if (cursor === noteId) return;
        visited.add(cursor);
        cursor = notesById.get(cursor)?.parentId ?? null;
      }
    }

    const position = computePositionForMove(noteId, newParentId, beforeId);
    const optimistic: NoteMeta = {
      ...current,
      parentId: newParentId,
      position,
      updatedAt: nowIso(),
    };

    upsertNoteInState(optimistic);

    try {
      const saved = normalizeNote(await runtime.notes.move({
        workspaceId,
        noteId,
        newParentId,
        newPosition: position,
      }));
      upsertNoteInState(saved);
    } catch {
      upsertNoteInState(current);
      await loadNotes();
    }
  }, [canEdit, computePositionForMove, loadNotes, notes, runtime, upsertNoteInState, workspaceId]);

  const archiveNote = useCallback(async (noteId: string, isArchived: boolean) => {
    if (!runtime || !workspaceId || !canEdit) return;
    const current = notes.find((note) => note.id === noteId);
    if (!current) return;

    const optimistic: NoteMeta = { ...current, isArchived, updatedAt: nowIso() };
    upsertNoteInState(optimistic);
    try {
      const saved = normalizeNote(await runtime.notes.upsert(optimistic));
      upsertNoteInState(saved);
    } catch {
      upsertNoteInState(current);
      await loadNotes();
    }
  }, [canEdit, loadNotes, notes, runtime, upsertNoteInState, workspaceId]);

  const updateNoteTags = useCallback(async (noteId: string, tags: string[]) => {
    if (!runtime || !workspaceId || !canEdit) return;
    const current = notes.find((note) => note.id === noteId);
    if (!current) return;

    const cleanTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    const optimistic: NoteMeta = {
      ...current,
      tags: cleanTags,
      updatedAt: nowIso(),
    };
    upsertNoteInState(optimistic);
    try {
      const saved = normalizeNote(await runtime.notes.upsert(optimistic));
      upsertNoteInState(saved);
    } catch {
      upsertNoteInState(current);
      await loadNotes();
    }
  }, [canEdit, loadNotes, notes, runtime, upsertNoteInState, workspaceId]);

  const togglePin = useCallback(async (noteId: string, isPinned: boolean) => {
    if (!runtime || !workspaceId) return;
    const current = notes.find((note) => note.id === noteId);
    if (!current) return;

    const optimistic: NoteMeta = {
      ...current,
      isPinned,
      updatedAt: nowIso(),
    };
    upsertNoteInState(optimistic);
    try {
      const saved = normalizeNote(await runtime.notes.upsert(optimistic));
      upsertNoteInState(saved);
    } catch {
      upsertNoteInState(current);
      await loadNotes();
    }
  }, [loadNotes, notes, runtime, upsertNoteInState, workspaceId]);

  const deleteNote = useCallback(async (noteId: string) => {
    if (!runtime || !workspaceId || !canEdit) return;
    const deletedAt = nowIso();
    const current = notes.find((note) => note.id === noteId);
    if (!current) return;
    const optimistic: NoteMeta = {
      ...current,
      deletedAt,
      updatedAt: deletedAt,
    };

    upsertNoteInState(optimistic);
    try {
      const saved = normalizeNote(await runtime.notes.remove({
        workspaceId,
        noteId,
        deletedAt,
      }));
      upsertNoteInState(saved);
    } catch {
      upsertNoteInState(current);
      await loadNotes();
    }
  }, [canEdit, loadNotes, notes, runtime, upsertNoteInState, workspaceId]);

  const duplicateNote = useCallback(async (noteId: string) => {
    if (!runtime || !workspaceId || !canEdit) return null;
    const source = notes.find((note) => note.id === noteId && !note.deletedAt);
    if (!source) return null;

    try {
      const saved = normalizeNote(await runtime.notes.duplicate({
        workspaceId,
        sourceNoteId: source.id,
      }));
      upsertNoteInState(saved);
      setSelectedNoteId(saved.id);
      return saved.id;
    } catch {
      await loadNotes();
      return null;
    }
  }, [canEdit, loadNotes, notes, runtime, upsertNoteInState, workspaceId]);

  return {
    notes,
    loading,
    canEdit,
    selectedNoteId,
    setSelectedNoteId,
    createNote,
    updateNoteTitle,
    updateNoteTags,
    moveNote,
    archiveNote,
    deleteNote,
    duplicateNote,
    togglePin,
    syncEngine,
  };
}
