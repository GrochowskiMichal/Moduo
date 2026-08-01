/**
 * Notes v2 module hook (Wave-3 NO-3) — bundle load + optimistic intent
 * mutations over the NO-1 runtime surface, with the NO-2 sync engine for
 * offline queueing, instant cache paint, the 30-day purge sweep, the one-time
 * redb import, and the welcome seed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Truncation } from "../../../lib/paged-select";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { undoToast } from "../../../lib/undo-toast";
import { endPosition } from "../../tasks/helpers";
import type { Note } from "../model";
import { repairNote, repairUnmaterializedNotes } from "../repair";
import { NotesSyncEngineV2, type NotesSyncStatusV2 } from "../sync/engine-v2";
import { readMetaCache, writeMetaCache } from "../sync/idb";
import { runRedbImportOnce } from "../sync/redb-import";
import { descendantIds, siblingsOf, wouldCreateCycle } from "../tree";

const WELCOME_FLAG_PREFIX = "moduo:notes:welcome-seeded:v1:";

type Params = {
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: string;
};

export type NotesModuleApi = ReturnType<typeof useNotesModule>;

export function useNotesModule(runtime: ModuoRuntime | null, params: Params) {
  const { userId, workspaceId, modulePermission = "none" } = params;
  const canRead = modulePermission !== "none";
  const canEdit = modulePermission === "edit" || modulePermission === "admin";

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  /** SCALE-1: collections the read had to cut — the page must show these. */
  const [truncated, setTruncated] = useState<Truncation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<NotesSyncStatusV2>("synced");
  const [welcomeNoteId, setWelcomeNoteId] = useState<string | null>(null);
  const reqRef = useRef(0);
  const serverLoadedRef = useRef(false);
  /** Optimistic creates whose op hasn't settled — merged into every server
   * bundle so a concurrent load() can't clobber a just-captured note. */
  const pendingCreatesRef = useRef(new Map<string, Note>());
  const notesRef = useRef<Note[]>([]);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const ready = Boolean(runtime && userId && workspaceId && canRead);

  // ── the sync engine (one per workspace) ────────────────────────────────────
  const refreshRef = useRef<() => void>(() => {});
  const fireRefresh = useCallback(() => refreshRef.current(), []);
  const engine = useMemo(() => {
    if (!ready) return null;
    return new NotesSyncEngineV2(runtime, workspaceId!, fireRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, runtime, workspaceId, fireRefresh]);

  useEffect(() => {
    if (!engine) return;
    const off = engine.onStatus(setSyncStatus);
    return () => {
      off();
      void engine.destroy();
    };
  }, [engine]);

  // ── load: cache paint → server refresh → cache write ──────────────────────
  const load = useCallback(async () => {
    if (!ready) {
      setNotes([]);
      setLoading(false);
      return;
    }
    const req = ++reqRef.current;
    try {
      const bundle = await runtime!.notesV2.listMeta(workspaceId!);
      if (reqRef.current !== req) return;
      serverLoadedRef.current = true;
      // Merge unsettled optimistic creates so a load racing a capture can't
      // drop the just-created note (and deselect it via the stale-id sweep).
      const merged = [...bundle.notes];
      for (const [id, note] of pendingCreatesRef.current) {
        if (!merged.some((n) => n.id === id)) merged.push(note);
      }
      setNotes(merged);
      setDegraded(bundle.degraded);
      setTruncated(bundle.truncated);
      setLoadError(null);
      setLoading(false);
      void writeMetaCache(workspaceId!, bundle.notes);
    } catch (e) {
      if (reqRef.current !== req) return;
      // Outage: keep whatever is painted (cache), surface quietly.
      setLoadError(e instanceof Error ? e.message : "Couldn't load notes.");
      setLoading(false);
    }
  }, [ready, runtime, workspaceId]);
  refreshRef.current = () => void load();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotes([]);
    setDegraded(false);
    setTruncated([]);
    setLoadError(null);
    serverLoadedRef.current = false;
    pendingCreatesRef.current.clear();
    if (!ready) {
      setLoading(false);
      return;
    }
    // Instant paint from the IDB cache (offline tree), then the live read.
    // Guarded on "a server bundle has RESOLVED", not on load() having merely
    // started — load() bumps reqRef synchronously, so the old guard never let
    // the cache paint at all (offline boot rendered an empty list).
    void readMetaCache(workspaceId!).then((cached) => {
      if (cancelled || !cached || serverLoadedRef.current) return;
      if (notesRef.current.length === 0 && cached.notes.length > 0) {
        setNotes((cached.notes as any[]).map((n) => n as Note));
        setLoading(false);
      }
    });
    void load();
    return () => {
      cancelled = true;
    };
  }, [ready, workspaceId, load]);

  // ── module-load passes: purge sweep, redb import, welcome seed ────────────
  const passesRanFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || loading || degraded || !canEdit) return;
    if (passesRanFor.current === workspaceId) return;
    passesRanFor.current = workspaceId;

    void runtime!.notesV2.purgeExpired(workspaceId!).then((r) => {
      if (r.count > 0) void load();
    });

    void runRedbImportOnce(runtime, workspaceId!).then((r) => {
      if (r && r.imported > 0) {
        toast(`Imported ${r.imported} note${r.imported === 1 ? "" : "s"} from this device.`);
        void load();
      }
    });

    // Blank-note backfill (NOTE-FIX-1): notes imported before the importer
    // materialized `doc_state` (and any body-only connector write) open EMPTY.
    // Repair them here rather than making the designer open every note — the
    // server's once-only guard makes it safe to race another device. Silent by
    // design: nothing visibly happened, the notes just stop being blank.
    const sweepWorkspace = workspaceId!;
    void repairUnmaterializedNotes(runtime!, sweepWorkspace, {
      // Push anything this device still has queued BEFORE deciding a note is
      // empty — an old-build device may hold an unpushed in-editor seed.
      drainLocalFirst: engine ? () => engine.wake() : undefined,
      shouldStop: () => passesRanFor.current !== sweepWorkspace,
      onRepaired: (noteId) => void engine?.pullNote(noteId),
    }).then((summary) => {
      if (summary.seeded > 0) void load();
      if (summary.failed > 0) {
        console.warn(`[notes] ${summary.failed} note(s) could not be repaired`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loading, degraded, canEdit, workspaceId]);

  /**
   * Repair ONE note straight away (NOTE-FIX-1) — the page calls this for the
   * note being opened. The sweep is sequential, so a large legacy import can
   * take tens of seconds; without this, clicking a not-yet-swept note still
   * shows it blank, and typing into it would push real updates + overwrite
   * `body_md`, making the imported content unrecoverable.
   *
   * Cheap when there is nothing to do: the server refuses instantly for an
   * already-materialized note.
   */
  const repairAttemptedRef = useRef(new Set<string>());
  const repairNoteNow = useCallback(
    async (noteId: string) => {
      if (!ready || !canEdit) return;
      // One attempt per note per visit — the server is the real guard, this
      // just avoids rebuilding a doc every time you click back to a note.
      if (repairAttemptedRef.current.has(noteId)) return;
      const note = notesRef.current.find((n) => n.id === noteId);
      if (!note || note.deletedAt) return;
      repairAttemptedRef.current.add(noteId);
      try {
        const docs = await runtime!.notesV2.fetchExportDocs({
          workspaceId: workspaceId!,
          ids: [noteId],
        });
        const bodyMd = docs[0]?.bodyMd ?? "";
        if (!bodyMd.trim()) return;
        const outcome = await repairNote(runtime!, workspaceId!, noteId, bodyMd);
        if (outcome === "seeded") {
          await engine?.pullNote(noteId);
          void load();
        }
      } catch {
        // Opportunistic — a blank note stays blank and the sweep retries.
        repairAttemptedRef.current.delete(noteId);
      }
    },
    [ready, canEdit, runtime, workspaceId, engine, load],
  );

  // Welcome seed: one deletable self-teaching note in a fresh workspace.
  useEffect(() => {
    if (!ready || loading || degraded || !canEdit || !workspaceId) return;
    if (notes.length > 0) return;
    const flag = `${WELCOME_FLAG_PREFIX}${workspaceId}`;
    try {
      if (window.localStorage.getItem(flag) === "done") return;
      window.localStorage.setItem(flag, "done");
    } catch {
      return;
    }
    const id = crypto.randomUUID();
    const optimistic = welcomeOptimisticNote(id, workspaceId, userId);
    setNotes([optimistic]);
    setWelcomeNoteId(id);
    pendingCreatesRef.current.set(id, optimistic);
    void runtime!.notesV2
      .create({ workspaceId, id, title: "Welcome to Notes", icon: "👋", position: endPosition([]) })
      .then(() => pendingCreatesRef.current.delete(id))
      .catch(() => {
        // degrade quietly — the seed is a nicety, never an error surface —
        // but don't burn the one-shot flag on a failed attempt.
        pendingCreatesRef.current.delete(id);
        setNotes((prev) => prev.filter((n) => n.id !== id));
        setWelcomeNoteId(null);
        try {
          window.localStorage.removeItem(flag);
        } catch {
          // ignore
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loading, degraded, canEdit, workspaceId, notes.length]);

  // ── optimistic mutation helpers ────────────────────────────────────────────

  const patchLocal = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  /** Run an engine meta-op after an optimistic patch; on a server rejection
   * reload the truth + toast. Offline queueing resolves as success. */
  const guard = useCallback(
    (fn: () => Promise<unknown>) => {
      if (!engine || !canEdit) return;
      void fn().catch((e) => {
        toast.error(e instanceof Error ? e.message : "Something went wrong.");
        void load();
      });
    },
    [engine, canEdit, load],
  );

  // ── mutations ──────────────────────────────────────────────────────────────

  const createNote = useCallback(
    (parentId: string | null = null): string | null => {
      if (!engine || !canEdit || !workspaceId) return null;
      const id = crypto.randomUUID();
      const position = endPosition(siblingsOf(notesRef.current, parentId));
      const now = new Date().toISOString();
      const optimistic: Note = {
        id,
        workspaceId,
        createdBy: userId,
        parentId,
        title: "",
        icon: null,
        isPinned: false,
        position,
        isArchived: false,
        publishedAt: null,
        publishToken: null,
        docVersion: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      setNotes((prev) => [...prev, optimistic]);
      pendingCreatesRef.current.set(id, optimistic);
      guard(() =>
        engine
          .runMetaOp("create", { workspaceId, id, parentId, title: "", position })
          .finally(() => pendingCreatesRef.current.delete(id)),
      );
      return id;
    },
    [engine, canEdit, workspaceId, userId, guard],
  );

  const renameNote = useCallback(
    (noteId: string, title: string) => {
      if (!engine || !workspaceId) return;
      const existing = notesRef.current.find((n) => n.id === noteId);
      if (!existing || existing.title === title) return;
      patchLocal(noteId, { title, updatedAt: new Date().toISOString() });
      guard(() => engine.runMetaOp("rename", { workspaceId, noteId, title }));
    },
    [engine, workspaceId, patchLocal, guard],
  );

  const moveNote = useCallback(
    (noteId: string, parentId: string | null, position: string) => {
      if (!engine || !workspaceId) return;
      if (wouldCreateCycle(notesRef.current, noteId, parentId)) return; // quiet no-op
      patchLocal(noteId, { parentId, position, updatedAt: new Date().toISOString() });
      guard(() => engine.runMetaOp("move", { workspaceId, noteId, parentId, position }));
    },
    [engine, workspaceId, patchLocal, guard],
  );

  const setIcon = useCallback(
    (noteId: string, icon: string | null) => {
      if (!engine || !workspaceId) return;
      patchLocal(noteId, { icon });
      guard(() =>
        engine.runMetaOp("setMeta", { workspaceId, noteId, patch: { icon: icon ?? "" } }),
      );
    },
    [engine, workspaceId, patchLocal, guard],
  );

  const togglePin = useCallback(
    (noteId: string) => {
      if (!engine || !workspaceId) return;
      const existing = notesRef.current.find((n) => n.id === noteId);
      if (!existing) return;
      const isPinned = !existing.isPinned;
      patchLocal(noteId, { isPinned });
      guard(() => engine.runMetaOp("setMeta", { workspaceId, noteId, patch: { isPinned } }));
    },
    [engine, workspaceId, patchLocal, guard],
  );

  const duplicateNote = useCallback(
    async (noteId: string): Promise<string | null> => {
      // Needs the server copy (doc_state + update tail) — connectivity required.
      if (!runtime || !canEdit || !workspaceId) return null;
      try {
        const copy = await runtime.notesV2.duplicate({ workspaceId, sourceNoteId: noteId });
        setNotes((prev) => [...prev, copy]);
        return copy.id;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't duplicate the note.");
        return null;
      }
    },
    [runtime, canEdit, workspaceId, load],
  );

  const archiveNote = useCallback(
    (noteId: string, archived: boolean) => {
      if (!engine || !workspaceId) return;
      if (!archived) {
        // Unarchive is a clean inverse of the flag only — a note that was taken
        // offline by archiving must be re-published explicitly (token is gone).
        patchLocal(noteId, { isArchived: false });
        guard(() => engine.runMetaOp("unarchive", { workspaceId, noteId }));
        return;
      }
      // Archiving takes the note (with its subtree) offline: the server clears
      // publish_token across the subtree (any public link 404s). Mirror it
      // optimistically and tell the user their link is gone (designer call).
      const descendants = new Set(descendantIds(notesRef.current, noteId));
      const wasPublished = notesRef.current.some(
        (n) => (n.id === noteId || descendants.has(n.id)) && n.publishedAt && n.publishToken,
      );
      setNotes((prev) =>
        prev.map((n) => {
          if (n.id === noteId)
            return { ...n, isArchived: true, publishedAt: null, publishToken: null };
          if (descendants.has(n.id)) return { ...n, publishedAt: null, publishToken: null };
          return n;
        }),
      );
      guard(() => engine.runMetaOp("archive", { workspaceId, noteId }));
      if (wasPublished) {
        toast("Archived — the public link was turned off.", {
          description: "Publish it again from the note header to share a fresh link.",
        });
      }
    },
    [engine, workspaceId, patchLocal, guard],
  );

  const restoreNote = useCallback(
    (noteId: string) => {
      if (!engine || !workspaceId) return;
      const ids = new Set([noteId, ...descendantIdsIncludingTrashed(notesRef.current, noteId)]);
      setNotes((prev) =>
        prev.map((n) => (ids.has(n.id) && n.deletedAt ? { ...n, deletedAt: null } : n)),
      );
      guard(() => engine.runMetaOp("restore", { workspaceId, noteId }));
    },
    [engine, workspaceId, guard],
  );

  const trashNote = useCallback(
    (
      noteId: string,
      opts?: {
        /** Task lines inside the trashed subtree (NO-5): tasks survive — fold
         * "N tasks detached · Delete them too?" into the ONE trash toast
         * (never a second toast, DESIGN_BRIEF §3b). */
        detachedTaskIds?: string[];
        onDeleteTasks?: (taskIds: string[]) => void;
        /** Runs alongside restore on Undo (the page re-creates the dropped
         * note↔task links). */
        onUndo?: () => void;
      },
    ) => {
      if (!engine || !workspaceId) return;
      const now = new Date().toISOString();
      const ids = new Set([noteId, ...descendantIds(notesRef.current, noteId)]);
      setNotes((prev) => prev.map((n) => (ids.has(n.id) ? { ...n, deletedAt: now } : n)));
      guard(() => engine.runMetaOp("trash", { workspaceId, noteId }));
      const extra = ids.size - 1;
      const taskIds = opts?.detachedTaskIds ?? [];
      const n = taskIds.length;
      const label = `Moved to Trash${extra > 0 ? ` (+${extra} nested)` : ""}${
        n > 0 ? ` · ${n} task${n === 1 ? "" : "s"} detached` : ""
      }`;
      // One toast, one grammar (DF-5): Undo in the action slot; the destructive
      // "delete the tasks too" escalation rides the body — never sonner's
      // `cancel` slot, where a destructive verb reads as the dismiss button.
      undoToast(label, {
        description: n > 0 ? "The tasks still live in Tasks." : undefined,
        onUndo: () => {
          restoreNote(noteId);
          opts?.onUndo?.();
        },
        danger:
          n > 0 && opts?.onDeleteTasks
            ? {
                label: n === 1 ? "Delete the task too" : "Delete the tasks too",
                onClick: () => opts.onDeleteTasks?.(taskIds),
              }
            : undefined,
      });
    },
    [engine, workspaceId, guard, restoreNote],
  );

  const purgeNote = useCallback(
    async (noteId: string) => {
      // Destructive + rare: connectivity required, no offline queue.
      if (!runtime || !canEdit || !workspaceId) return;
      try {
        await runtime.notesV2.purge({ workspaceId, noteId });
        const ids = new Set([noteId, ...descendantIdsIncludingTrashed(notesRef.current, noteId)]);
        setNotes((prev) => prev.filter((n) => !ids.has(n.id)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't delete the note.");
      }
    },
    [runtime, canEdit, workspaceId],
  );

  // Publish/unpublish need the server-minted token back (NO-9) — connectivity
  // required, no optimistic queue. The returned note carries published_at +
  // publish_token; patch it so the Published section + control reflect at once.
  const publishNote = useCallback(
    async (noteId: string): Promise<string | null> => {
      if (!runtime || !canEdit || !workspaceId) return null;
      try {
        const updated = await runtime.notesV2.publish({ workspaceId, noteId });
        patchLocal(noteId, {
          publishedAt: updated.publishedAt,
          publishToken: updated.publishToken,
        });
        return updated.publishToken;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't publish the note.");
        return null;
      }
    },
    [runtime, canEdit, workspaceId, patchLocal],
  );

  const unpublishNote = useCallback(
    async (noteId: string): Promise<void> => {
      if (!runtime || !canEdit || !workspaceId) return;
      try {
        await runtime.notesV2.unpublish({ workspaceId, noteId });
        patchLocal(noteId, { publishedAt: null, publishToken: null });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't unpublish the note.");
      }
    },
    [runtime, canEdit, workspaceId, patchLocal],
  );

  return {
    notes,
    loading,
    degraded,
    truncated,
    loadError,
    syncStatus,
    engine,
    canEdit,
    welcomeNoteId,
    refresh: load,
    createNote,
    renameNote,
    moveNote,
    setIcon,
    togglePin,
    duplicateNote,
    archiveNote,
    trashNote,
    restoreNote,
    purgeNote,
    publishNote,
    unpublishNote,
    repairNoteNow,
  };
}

function descendantIdsIncludingTrashed(notes: Note[], noteId: string): string[] {
  const kids = new Map<string, string[]>();
  for (const n of notes) {
    if (!n.parentId) continue;
    if (!kids.has(n.parentId)) kids.set(n.parentId, []);
    kids.get(n.parentId)!.push(n.id);
  }
  const out: string[] = [];
  const walk = (id: string, depth: number) => {
    if (depth >= 100) return;
    for (const child of kids.get(id) ?? []) {
      out.push(child);
      walk(child, depth + 1);
    }
  };
  walk(noteId, 0);
  return out;
}

function welcomeOptimisticNote(id: string, workspaceId: string, userId: string | null): Note {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId,
    createdBy: userId,
    parentId: null,
    title: "Welcome to Notes",
    icon: "👋",
    isPinned: false,
    position: endPosition([]),
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}
