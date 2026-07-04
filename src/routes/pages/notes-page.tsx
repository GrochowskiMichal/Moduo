/**
 * /notes — the Wave-3 rebuilt three-pane Notes page (NO-3, AC1/AC2/AC12).
 * Sidebar sections + tree · CRDT editor (first line = title) · right panel
 * arrives with NO-7 (hidden until then). Selection is URL-held (?id=).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CloudOff, X } from "lucide-react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { onCreateNew } from "../../components/app/create-events";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { useNotesModule } from "../../features/notes/hooks/use-notes-module";
import { useNotesTaskBridge } from "../../features/notes/hooks/use-notes-task-bridge";
import {
  buildNoteSections,
  descendantIds,
  resolveDrop,
  type DropZone,
} from "../../features/notes/tree";
import { displayTitle } from "../../features/notes/title";
import { extractTaskLineIds } from "../../features/notes/sync/doc-text";
import { taskLinksForNote } from "../../features/notes/tasks/detach";
import type { EntityLink } from "../../lib/entity-links";
import { NoteTreeSidebar } from "../../features/notes/ui/note-tree-sidebar";
import { NoteEditor } from "../../features/notes/ui/note-editor";
import {
  INSERT_PAGE_ROW_EVENT,
  type NotesEditorBridge,
} from "../../features/notes/editor/notes-editor-bridge";
import { useTasksModule } from "../../features/tasks/hooks/use-tasks-module";
import { TaskDetailPanel } from "../../features/tasks/ui/task-detail-panel";
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

  // Task lines (NO-5): the Tasks module rides along so lines render live
  // rows, the `/task` picker searches real tasks, and the Task-detail rail
  // edits without leaving /notes.
  const tasksApi = useTasksModule(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.tasks,
  });

  // Task-detail rail variant — meta click opens it; note switch closes it.
  const [taskDetailId, setTaskDetailId] = useState<string | null>(null);
  useEffect(() => {
    setTaskDetailId(null);
  }, [selectedId]);

  // "Reflects on refresh/refocus" (AC3): re-pull the tasks bundle when the
  // window regains focus, min 5s apart.
  const lastFocusReload = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusReload.current < 5000) return;
      lastFocusReload.current = now;
      void tasksApi.reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [tasksApi.reload]);

  const taskBridge = useNotesTaskBridge({
    runtime,
    workspaceId: selectedWorkspaceId,
    noteId: selectedId,
    noteLabel: displayTitle(selectedNote?.title ?? ""),
    tasksApi,
    onOpenTaskDetail: setTaskDetailId,
  });

  // The editor ↔ module bridge (NO-4): page-rows read live titles, click-
  // through selects, and /page creates a child of the open note.
  const bridge = useMemo<NotesEditorBridge>(
    () => ({
      getNoteMeta: (id) => notes.find((n) => n.id === id) ?? null,
      openNote: (id) => select(id),
      createChildNote: () => (selectedId ? module.createNote(selectedId) : null),
      tasks: taskBridge,
    }),
    [notes, select, selectedId, module, taskBridge],
  );

  // Sidebar "+ child" while the parent is open ALSO mirrors a page-row into
  // the parent's body (DESIGN_BRIEF §3c) — via the editor's canonical path.
  const createChildFromSidebar = useCallback(
    (parentId: string) => {
      const id = module.createNote(parentId);
      if (!id) return;
      if (parentId === selectedId) {
        window.dispatchEvent(
          new CustomEvent(INSERT_PAGE_ROW_EVENT, {
            detail: { parentId, childId: id },
          }),
        );
      }
      select(id, true);
    },
    [module, selectedId, select],
  );

  // Trashing a note with task lines: tasks soft-detach and survive, folded
  // into the ONE trash toast (AC4) — the note↔task links are dropped (real
  // detach, not just copy) and the toast's Undo restores note AND links.
  // The docs are read via the sync engine so unopened notes work too —
  // gesture note + descendants (capped) — best-effort: a slow boot falls
  // back to the plain trash toast, never blocks the gesture.
  const trashWithTaskDetach = useCallback(
    async (id: string) => {
      const noteIds = [id, ...descendantIds(notes, id)].slice(0, 20);
      const taskIdsByNote = new Map<string, string[]>();
      if (engine) {
        for (const noteId of noteIds) {
          try {
            const session = engine.getOrCreateSession(noteId);
            await Promise.race([
              session.booted,
              new Promise((resolve) => setTimeout(resolve, 800)),
            ]);
            const ids = extractTaskLineIds(session.doc);
            if (ids.length > 0) taskIdsByNote.set(noteId, ids);
          } catch {
            // skip this doc — honest undercount beats blocking the gesture
          }
        }
      }
      const allTaskIds = [...new Set([...taskIdsByNote.values()].flat())];

      // Drop the note↔task links (the actual detach); remember them so the
      // toast's Undo can put them back (links_op_create is idempotent).
      const dropped: {
        source: { type: string; id: string };
        target: { type: string; id: string };
        relationKind: EntityLink["relationKind"];
        origin: EntityLink["origin"];
      }[] = [];
      if (runtime && selectedWorkspaceId && taskIdsByNote.size > 0) {
        try {
          for (const [noteId, ids] of taskIdsByNote) {
            const links = await runtime.spine.listLinks({
              workspaceId: selectedWorkspaceId,
              entityType: "note",
              entityId: noteId,
            });
            const toDrop = taskLinksForNote(links, noteId, new Set(ids));
            for (const l of toDrop) {
              await runtime.spine.deleteLink({
                workspaceId: selectedWorkspaceId,
                linkId: l.id,
              });
              dropped.push({
                source: { type: l.sourceType, id: l.sourceId },
                target: { type: l.targetType, id: l.targetId },
                relationKind: l.relationKind,
                origin: l.origin,
              });
            }
          }
        } catch {
          // link drop is best-effort; trash itself must never fail on it
        }
      }

      module.trashNote(
        id,
        allTaskIds.length > 0
          ? {
              detachedTaskIds: allTaskIds,
              onDeleteTasks: (ids) => ids.forEach((taskId) => tasksApi.deleteTask(taskId)),
              onUndo: () => {
                if (!runtime || !selectedWorkspaceId) return;
                for (const l of dropped) {
                  void runtime.spine.createLink({ workspaceId: selectedWorkspaceId, ...l });
                }
              },
            }
          : undefined,
      );
    },
    [engine, module, tasksApi, notes, runtime, selectedWorkspaceId],
  );

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
      onCreateChild={createChildFromSidebar}
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
        void trashWithTaskDetach(id);
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
            bridge={bridge}
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

  // Task-detail rail variant (NO-5): the Tasks module's own detail panel for
  // the focused task line — full editing without visiting /tasks. NO-7 folds
  // this into the lifted right-panel switcher; until then it's the only
  // right-panel occupant and the panel stays hidden otherwise.
  // Bridge lookup (bundle + just-minted overlay) so "Details" works the
  // instant a mint lands, before the bundle reload catches up.
  const detailTask = taskDetailId ? taskBridge.getTask(taskDetailId) : null;

  const right = detailTask ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Task detail
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close task detail"
              onClick={() => setTaskDetailId(null)}
            >
              <X className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Close</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <TaskDetailPanel
          task={detailTask}
          buckets={tasksApi.buckets}
          inbox={tasksApi.inbox}
          canEdit={tasksApi.canEdit}
          onRequestCapture={() => {}}
          onSelectTask={setTaskDetailId}
          api={tasksApi}
        />
      </div>
    </div>
  ) : undefined;

  return (
    <FeaturePanelsShell
      feature="notes"
      left={sidebar}
      center={center}
      right={right}
      hideRight={!detailTask}
    />
  );
}
