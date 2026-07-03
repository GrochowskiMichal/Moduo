/**
 * /notes — the Wave-3 rebuilt three-pane Notes page (NO-3, AC1/AC2/AC12).
 * Sidebar sections + tree · CRDT editor (first line = title) · right panel
 * arrives with NO-7 (hidden until then). Selection is URL-held (?id=).
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CloudOff } from "lucide-react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { onCreateNew } from "../../components/app/create-events";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { useNotesModule } from "../../features/notes/hooks/use-notes-module";
import { buildNoteSections, resolveDrop, type DropZone } from "../../features/notes/tree";
import { displayTitle } from "../../features/notes/title";
import { NoteTreeSidebar } from "../../features/notes/ui/note-tree-sidebar";
import { NoteEditor } from "../../features/notes/ui/note-editor";
import { betweenPositions, endPosition } from "../../features/tasks/helpers";
import type { NotesSearch } from "../../features/notes/search";

export function NotesPage() {
  const { runtime, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as NotesSearch;

  const module = useNotesModule(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.notes,
  });
  const {
    notes,
    loading,
    degraded,
    loadError,
    syncStatus,
    engine,
    canEdit,
    welcomeNoteId,
  } = module;

  const sections = useMemo(() => buildNoteSections(notes), [notes]);
  const selectedId = search.id ?? null;
  const selectedNote = useMemo(
    () => (selectedId ? (notes.find((n) => n.id === selectedId) ?? null) : null),
    [notes, selectedId],
  );

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

  // Capture: palette/global `?action=new` + the app-wide ⌘N create event.
  const create = useCallback(
    (parentId: string | null = null) => {
      const id = module.createNote(parentId);
      if (id) select(id, true);
    },
    [module, select],
  );
  const createRef = useRef(create);
  createRef.current = create;

  useEffect(() => {
    if (search.action === "new" && canEdit && !loading) {
      createRef.current(null);
    }
  }, [search.action, canEdit, loading]);

  useEffect(() => onCreateNew(() => createRef.current(null)), []);

  // Stale deep link: loaded and the id doesn't exist → clear quietly.
  useEffect(() => {
    if (loading || !selectedId) return;
    if (!notes.some((n) => n.id === selectedId)) select(null, true);
  }, [loading, selectedId, notes, select]);

  const onDropRow = useCallback(
    (dragId: string, targetId: string, zone: DropZone) => {
      const drop = resolveDrop(notes, dragId, targetId, zone, {
        endPosition,
        betweenPositions,
      });
      if (!drop) return; // self/cycle/unknown — quiet no-op
      module.moveNote(dragId, drop.parentId, drop.position);
    },
    [notes, module],
  );

  const canRender = Boolean(
    runtime && userId && selectedWorkspaceId && !configError && modulePermissions.notes !== "none",
  );

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="notes"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <h2 className="font-display text-2xl text-foreground">Notes unavailable</h2>
            <p className="text-sm">
              {configError ??
                (modulePermissions.notes === "none"
                  ? "You do not have Notes access in this workspace."
                  : "Authentication or workspace is missing.")}
            </p>
          </div>
        }
      />
    );
  }

  const sidebar = selectedWorkspaceId ? (
    <NoteTreeSidebar
      workspaceId={selectedWorkspaceId}
      sections={sections}
      selectedId={selectedId}
      canEdit={canEdit}
      onSelect={(id) => select(id)}
      onCreateRoot={() => create(null)}
      onCreateChild={(parentId) => create(parentId)}
      onDropRow={onDropRow}
      onTogglePin={module.togglePin}
      onSetIcon={module.setIcon}
      onDuplicate={(id) =>
        void module.duplicateNote(id).then((copyId) => {
          if (copyId) select(copyId);
        })
      }
      onArchive={(id, archived) => module.archiveNote(id, archived)}
      onTrash={(id) => {
        module.trashNote(id);
        if (selectedId === id) select(null, true);
      }}
      onRestore={module.restoreNote}
      onPurge={(id) => {
        void module.purgeNote(id);
        if (selectedId === id) select(null, true);
      }}
    />
  ) : null;

  const center = (
    <div className="relative flex h-full min-h-0 flex-col">
      {degraded ? (
        <div className="border-b border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
          Notes is waiting on a server update — reading is fine, editing comes back shortly.
        </div>
      ) : null}
      {loadError ? (
        <div className="border-b border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
          Couldn't refresh notes — showing what's saved on this device.
        </div>
      ) : null}
      {syncStatus === "offline" ? (
        <div className="absolute right-3 top-3 z-10">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center rounded-full bg-muted p-1.5 text-muted-foreground">
                <CloudOff className="size-3.5" aria-label="Saved locally" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">Saved locally — will sync</TooltipContent>
          </Tooltip>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {selectedNote && !selectedNote.deletedAt && engine && selectedWorkspaceId ? (
          <NoteEditor
            key={selectedNote.id}
            engine={engine}
            workspaceId={selectedWorkspaceId}
            noteId={selectedNote.id}
            editable={canEdit && !degraded}
            titleForLabel={displayTitle(selectedNote.title)}
            onTitleDerived={(title) => module.renameNote(selectedNote.id, title)}
            seedWelcome={welcomeNoteId === selectedNote.id}
          />
        ) : selectedNote?.deletedAt ? (
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <p className="text-sm">This note is in the Trash.</p>
            {canEdit ? (
              <button
                type="button"
                className="justify-self-center rounded-md bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => module.restoreNote(selectedNote.id)}
              >
                Restore
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid h-full place-content-center gap-1 text-center text-muted-foreground">
            {loading ? (
              <p className="text-sm">Loading notes…</p>
            ) : (
              <>
                <p className="font-display text-lg text-foreground">Write something down</p>
                <p className="text-sm">
                  Select a note on the left{canEdit ? ", or press ⌘N for a fresh one" : ""}.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return <FeaturePanelsShell feature="notes" left={sidebar} center={center} hideRight />;
}
