import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { notesLocalDB, getLocalPinMap, getMetaValue, setLocalPin, setMetaValue } from "../db/local-db";
import { NotesSyncEngine } from "../sync/sync-engine";
import { extractMentionedUserIds } from "../../workspaces/utils/mentions";
import type { NoteKind, NoteMeta, NotesSyncStatus } from "../types";
import { generatePosition, initialPosition } from "../utils/position";

type RemoteNote = {
  id: string;
  workspace_id: string;
  owner_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  kind?: NoteKind;
  tags?: string[];
  is_pinned?: boolean;
  position: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const BOOTSTRAP_LIMIT = 1000;

function mapRemoteNote(note: RemoteNote): NoteMeta {
  return {
    id: note.id,
    workspaceId: note.workspace_id,
    ownerId: note.owner_id,
    parentId: note.parent_id,
    title: note.title,
    icon: note.icon,
    kind: note.kind ?? "note",
    tags: Array.isArray(note.tags) ? note.tags : [],
    isPinned: note.is_pinned ?? false,
    position: note.position,
    isArchived: note.is_archived,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
    deletedAt: note.deleted_at,
  };
}

function normalizeNoteMeta(note: NoteMeta): NoteMeta {
  return {
    ...note,
    tags: Array.isArray(note.tags) ? note.tags : [],
  };
}

function sortNotes(a: NoteMeta, b: NoteMeta): number {
  if (a.parentId !== b.parentId) return (a.parentId ?? "").localeCompare(b.parentId ?? "");
  return a.position.localeCompare(b.position);
}

function metaKey(scopeKey: string): string {
  return `notes_last_bootstrap_at:${scopeKey}`;
}

type UseNotesParams = {
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: "none" | "view" | "edit" | "admin";
};

export function useNotes(supabase: SupabaseClient | null, params: UseNotesParams) {
  const { userId, workspaceId, modulePermission = "none" } = params;
  const scopeKey = userId && workspaceId ? `${userId}:${workspaceId}` : null;
  const canRead = modulePermission !== "none";
  const canEdit = modulePermission === "edit" || modulePermission === "admin";

  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<NotesSyncStatus>("synced");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const syncEngine = useMemo(() => {
    if (!supabase || !userId || !workspaceId || !canRead) return null;
    return new NotesSyncEngine(supabase, userId, workspaceId);
  }, [canRead, supabase, userId, workspaceId]);

  const mergeLocalPins = useCallback(async (source: NoteMeta[]): Promise<NoteMeta[]> => {
    if (!scopeKey) return source;
    const pins = await getLocalPinMap(scopeKey);
    if (pins.size === 0) return source;
    return source.map((note) =>
      pins.has(note.id) ? { ...note, isPinned: pins.get(note.id) ?? note.isPinned } : note
    );
  }, [scopeKey]);

  const loadLocal = useCallback(async () => {
    if (!workspaceId) return;
    const localNotes = await notesLocalDB.notes.where("workspaceId").equals(workspaceId).toArray();
    const normalizedNotes = localNotes.map((note) => normalizeNoteMeta(note as NoteMeta));
    if (normalizedNotes.some((note, index) => !Array.isArray((localNotes[index] as NoteMeta).tags))) {
      await notesLocalDB.notes.bulkPut(normalizedNotes);
    }
    const merged = await mergeLocalPins(normalizedNotes);
    merged.sort(sortNotes);
    setNotes(merged);
  }, [mergeLocalPins, workspaceId]);

  const ensureSelectedNote = useCallback((current: NoteMeta[], preferredId?: string | null) => {
    const existingId = preferredId ?? selectedNoteId;
    const visible = current
      .filter((note) => !note.deletedAt && !note.isArchived && note.kind !== "category")
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

  const bootstrapFromRemote = useCallback(async () => {
    if (!supabase || !workspaceId || !scopeKey || !canRead) return;

    let after = await getMetaValue(metaKey(scopeKey));

    for (let page = 0; page < 10; page += 1) {
      const { data, error } = await supabase.rpc("notes_bootstrap", {
        p_workspace_id: workspaceId,
        p_after_updated_at: after,
        p_limit: BOOTSTRAP_LIMIT,
      });

      if (error) throw error;

      const rows = (Array.isArray(data) ? data : []) as RemoteNote[];
      if (rows.length === 0) break;

      const mapped = rows.map(mapRemoteNote);
      await notesLocalDB.notes.bulkPut(mapped);

      const latest = rows[rows.length - 1]?.updated_at;
      if (latest) {
        after = latest;
        await setMetaValue(metaKey(scopeKey), latest);
      }

      if (rows.length < BOOTSTRAP_LIMIT) break;
    }

    await loadLocal();
  }, [canRead, loadLocal, scopeKey, supabase, workspaceId]);

  useEffect(() => {
    if (!syncEngine) return;
    return syncEngine.onStatus(setSyncStatus);
  }, [syncEngine]);

  useEffect(() => {
    if (!supabase || !workspaceId || !canRead) {
      setNotes([]);
      setSelectedNoteId(null);
      setLoading(false);
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      try {
        await loadLocal();
        await bootstrapFromRemote();
        if (!active) return;

        const latestNotes = await notesLocalDB.notes.where("workspaceId").equals(workspaceId).toArray();
        const mergedNotes = await mergeLocalPins(latestNotes);
        mergedNotes.sort(sortNotes);
        setNotes(mergedNotes);
        ensureSelectedNote(mergedNotes, null);

        const channel = supabase
          .channel(`notes-meta-${workspaceId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "notes",
              filter: `workspace_id=eq.${workspaceId}`,
            },
            async (payload) => {
              if (!active) return;
              if (payload.eventType === "DELETE") {
                const oldRow = payload.old as { id?: string };
                if (oldRow.id) await notesLocalDB.notes.delete(oldRow.id);
              } else {
                const row = payload.new as RemoteNote;
                if (row.workspace_id !== workspaceId) return;
                await notesLocalDB.notes.put(mapRemoteNote(row));
              }

              const localNotes = await notesLocalDB.notes.where("workspaceId").equals(workspaceId).toArray();
              const mergedNotes = await mergeLocalPins(localNotes);
              mergedNotes.sort(sortNotes);
              if (!active) return;
              setNotes(mergedNotes);
              ensureSelectedNote(mergedNotes);
            }
          )
          .subscribe();

        return () => {
          void supabase.removeChannel(channel);
        };
      } finally {
        if (active) setLoading(false);
      }
    };

    let cleanup: (() => void) | undefined;
    void run().then((fn) => {
      cleanup = fn;
    });

    return () => {
      active = false;
      if (cleanup) cleanup();
    };
  }, [bootstrapFromRemote, canRead, ensureSelectedNote, loadLocal, mergeLocalPins, supabase, workspaceId]);

  useEffect(() => {
    if (!syncEngine) return;
    return () => syncEngine.destroy();
  }, [syncEngine]);

  const createNote = useCallback(async (parentId: string | null = null, kind: NoteKind = "note") => {
    if (!supabase || !userId || !workspaceId || !canEdit) return null;

    const siblings = notes
      .filter((note) => note.parentId === parentId && !note.deletedAt)
      .sort((a, b) => a.position.localeCompare(b.position));

    const position = siblings.length
      ? generatePosition(siblings[siblings.length - 1]?.position, null)
      : initialPosition();

    const defaultTitle =
      kind === "category" ? "New Section" : kind === "folder" ? "New Note Folder" : "New Note";

    const { data, error } = await supabase
      .from("notes")
      .insert({
        workspace_id: workspaceId,
        owner_id: userId,
        parent_id: parentId,
        title: defaultTitle,
        kind,
        position,
      })
      .select("*")
      .single<RemoteNote>();

    if (error) throw error;

    const mapped = mapRemoteNote(data);
    await notesLocalDB.notes.put(mapped);
    setNotes((current) => [...current, mapped].sort(sortNotes));
    if (mapped.kind !== "category") setSelectedNoteId(mapped.id);

    if (mapped.kind !== "category") {
      await supabase.from("note_documents").upsert(
        {
          workspace_id: workspaceId,
          note_id: mapped.id,
          owner_id: userId,
          snapshot_b64: "",
          last_compacted_update_id: 0,
        },
        { onConflict: "note_id" }
      );
    }

    return mapped.id;
  }, [canEdit, notes, supabase, userId, workspaceId]);

  const updateNoteTitle = useCallback(async (noteId: string, title: string) => {
    if (!supabase || !workspaceId || !canEdit) return;

    setNotes((current) =>
      current.map((note) =>
        note.id === noteId ? { ...note, title, updatedAt: new Date().toISOString() } : note
      )
    );

    const { data, error } = await supabase
      .from("notes")
      .update({ title })
      .eq("id", noteId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single<RemoteNote>();

    if (error) throw error;

    const mapped = mapRemoteNote(data);
    await notesLocalDB.notes.put(mapped);
    setNotes((current) => current.map((note) => (note.id === noteId ? mapped : note)).sort(sortNotes));

    const mentionedUserIds = extractMentionedUserIds(title);
    if (mentionedUserIds.length > 0) {
      void supabase.rpc("workspace_emit_mentions", {
        p_workspace_id: workspaceId,
        p_module: "notes",
        p_resource_type: "note",
        p_resource_id: noteId,
        p_mentioned_user_ids: mentionedUserIds,
        p_payload: { context: "note_title" },
        p_dedupe_seed: `${noteId}:note_title:${Date.now()}`,
      });
    }
  }, [canEdit, supabase, workspaceId]);

  const computePositionForMove = useCallback(
    (noteId: string, targetParentId: string | null, beforeId: string | null) => {
      const siblings = notes
        .filter((note) => note.parentId === targetParentId && note.id !== noteId && !note.deletedAt)
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

  const moveNote = useCallback(
    async (noteId: string, newParentId: string | null, beforeId: string | null = null) => {
      if (!supabase || !workspaceId || !userId || !canEdit) return;
      const position = computePositionForMove(noteId, newParentId, beforeId);

      const { data, error } = await supabase.rpc("notes_move", {
        p_workspace_id: workspaceId,
        p_note_id: noteId,
        p_new_parent_id: newParentId,
        p_new_position: position,
      });

      if (error) throw error;

      const mapped = mapRemoteNote((data as RemoteNote) ?? {
        id: noteId,
        workspace_id: workspaceId,
        owner_id: userId,
        parent_id: newParentId,
        title: notes.find((n) => n.id === noteId)?.title ?? "Untitled",
        icon: null,
        kind: notes.find((n) => n.id === noteId)?.kind ?? "note",
        tags: notes.find((n) => n.id === noteId)?.tags ?? [],
        is_pinned: notes.find((n) => n.id === noteId)?.isPinned ?? false,
        position,
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      });

      await notesLocalDB.notes.put(mapped);
      setNotes((current) => current.map((note) => (note.id === noteId ? mapped : note)).sort(sortNotes));
    },
    [canEdit, computePositionForMove, notes, supabase, userId, workspaceId]
  );

  const archiveNote = useCallback(async (noteId: string, isArchived: boolean) => {
    if (!supabase || !workspaceId || !canEdit) return;

    const { data, error } = await supabase
      .from("notes")
      .update({ is_archived: isArchived })
      .eq("id", noteId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single<RemoteNote>();

    if (error) throw error;

    const mapped = mapRemoteNote(data);
    await notesLocalDB.notes.put(mapped);
    setNotes((current) => current.map((note) => (note.id === noteId ? mapped : note)).sort(sortNotes));
  }, [canEdit, supabase, workspaceId]);

  const updateNoteTags = useCallback(async (noteId: string, tags: string[]) => {
    if (!supabase || !workspaceId || !canEdit) return;
    const cleanTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];

    setNotes((current) =>
      current.map((note) =>
        note.id === noteId ? { ...note, tags: cleanTags, updatedAt: new Date().toISOString() } : note
      )
    );

    const { data, error } = await supabase
      .from("notes")
      .update({ tags: cleanTags })
      .eq("id", noteId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single<RemoteNote>();

    if (error) throw error;

    const mapped = mapRemoteNote(data);
    await notesLocalDB.notes.put(mapped);
    setNotes((current) => current.map((note) => (note.id === noteId ? mapped : note)).sort(sortNotes));
  }, [canEdit, supabase, workspaceId]);

  const togglePin = useCallback(async (noteId: string, isPinned: boolean) => {
    if (!scopeKey) return;

    setNotes((current) =>
      current.map((note) => (note.id === noteId ? { ...note, isPinned, updatedAt: new Date().toISOString() } : note))
    );
    await setLocalPin(scopeKey, noteId, isPinned);

    if (!supabase || !workspaceId || !canEdit) return;

    const { data, error } = await supabase
      .from("notes")
      .update({ is_pinned: isPinned })
      .eq("id", noteId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single<RemoteNote>();

    if (error) {
      const message = (error.message ?? "").toLowerCase();
      const isSchemaGap = error.code === "42703" || message.includes("is_pinned");
      if (!isSchemaGap) {
        console.warn("Pin sync failed; keeping local pin state.", error);
      }
      return;
    }

    const mapped = { ...mapRemoteNote(data), isPinned };
    await notesLocalDB.notes.put(mapped);
    setNotes((current) => current.map((note) => (note.id === noteId ? mapped : note)).sort(sortNotes));
  }, [canEdit, scopeKey, supabase, workspaceId]);

  const deleteNote = useCallback(async (noteId: string) => {
    if (!supabase || !workspaceId || !canEdit) return;

    const deletedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from("notes")
      .update({ deleted_at: deletedAt })
      .eq("id", noteId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .single<RemoteNote>();

    if (error) throw error;

    const mapped = mapRemoteNote(data);
    await notesLocalDB.notes.put(mapped);

    const next = notes
      .filter((note) => note.id !== noteId && !note.deletedAt && !note.isArchived && note.kind !== "category")
      .sort(sortNotes);
    setSelectedNoteId(next[0]?.id ?? null);
    setNotes((current) => current.map((note) => (note.id === noteId ? mapped : note)).sort(sortNotes));
  }, [canEdit, notes, supabase, workspaceId]);

  const duplicateNote = useCallback(async (noteId: string) => {
    if (!supabase || !userId || !workspaceId || !canEdit) return null;
    const source = notes.find((note) => note.id === noteId && !note.deletedAt);
    if (!source) return null;

    const siblings = notes
      .filter((note) => note.parentId === source.parentId && note.id !== source.id && !note.deletedAt)
      .sort((a, b) => a.position.localeCompare(b.position));

    const nextSibling = siblings.find((note) => source.position.localeCompare(note.position) < 0) ?? null;
    const position = generatePosition(source.position, nextSibling?.position ?? null);
    const copyTitle = `${source.title || "Untitled"} (Copy)`;

    const { data, error } = await supabase
      .from("notes")
      .insert({
        workspace_id: workspaceId,
        owner_id: userId,
        parent_id: source.parentId,
        title: copyTitle,
        kind: source.kind,
        tags: source.tags,
        is_pinned: false,
        position,
      })
      .select("*")
      .single<RemoteNote>();

    if (error) throw error;

    const mapped = mapRemoteNote(data);
    await notesLocalDB.notes.put(mapped);
    setNotes((current) => [...current, mapped].sort(sortNotes));

    if (mapped.kind !== "category") {
      const { data: sourceDoc } = await supabase
        .from("note_documents")
        .select("snapshot_b64,last_compacted_update_id")
        .eq("note_id", source.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle<{ snapshot_b64: string; last_compacted_update_id: number }>();

      await supabase.from("note_documents").upsert(
        {
          workspace_id: workspaceId,
          note_id: mapped.id,
          owner_id: userId,
          snapshot_b64: sourceDoc?.snapshot_b64 ?? "",
          last_compacted_update_id: sourceDoc?.last_compacted_update_id ?? 0,
        },
        { onConflict: "note_id" }
      );
      setSelectedNoteId(mapped.id);
    }

    return mapped.id;
  }, [canEdit, notes, supabase, userId, workspaceId]);

  return {
    notes,
    loading,
    canEdit,
    syncStatus,
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
