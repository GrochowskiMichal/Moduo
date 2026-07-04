/**
 * /notes — the Wave-3 rebuilt three-pane Notes page (NO-3, AC1/AC2/AC12).
 * Sidebar sections + tree · CRDT editor (first line = title) · right panel
 * arrives with NO-7 (hidden until then). Selection is URL-held (?id=).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CloudOff } from "lucide-react";
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
import { deriveBody, extractTaskLineIds } from "../../features/notes/sync/doc-text";
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
import { shapeNoteSearchResults, type NotesSearch } from "../../features/notes/search";
import { NoteImportDialog } from "../../features/notes/ui/note-import-dialog";
import {
  buildZipEntries,
  downloadTextFile,
  downloadZip,
  noteFileName,
  safeFileStem,
} from "../../features/notes/export";
import { useNoteRealtime } from "../../features/notes/hooks/use-note-realtime";
import { NotePresenceAvatars } from "../../features/notes/ui/note-presence-avatars";
import { NotePublishControl } from "../../features/notes/ui/note-publish-control";
import { nameFromEmail } from "../../features/notes/sync/notes-realtime";
import { toast } from "sonner";
import { RightPanelSwitcher, type RightPanelVariant } from "../../components/app/right-panel-switcher";
import { NoteDetailPanel } from "../../features/notes/ui/note-detail-panel";
import { NoteCommentsPanel } from "../../features/notes/ui/note-comments-panel";
import { NoteOutlinePanel } from "../../features/notes/ui/note-outline-panel";
import { findQuoteOffset } from "../../features/notes/comments/quote";
import {
  readNotesPanelVariant,
  writeNotesPanelVariant,
  type NotesPanelVariantId,
} from "../../features/notes/panel-prefs";
import type { OutlineHeading } from "../../features/notes/outline";
import type { EntityRef } from "../../lib/entity-links";

export function NotesPage() {
  const { runtime, userId, userEmail, configError } = useAuth();
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

  // Live multiplayer (NO-6, AC7): a broadcast + presence channel for the open
  // note — near-live edits + a viewer facepile. No-ops without a note/identity.
  const selfName = useMemo(() => nameFromEmail(userEmail), [userEmail]);
  const { viewers } = useNoteRealtime({
    engine: engine ?? null,
    noteId: selectedNote && !selectedNote.deletedAt ? selectedNote.id : null,
    enabled: canRender && Boolean(selectedWorkspaceId),
    selfUserId: userId,
    selfName,
  });

  // Right-panel variant (NO-7): remembered per user+workspace.
  const [panelVariant, setPanelVariant] = useState<NotesPanelVariantId>("detail");
  useEffect(() => {
    if (userId && selectedWorkspaceId) setPanelVariant(readNotesPanelVariant(userId, selectedWorkspaceId));
  }, [userId, selectedWorkspaceId]);
  const changePanelVariant = useCallback(
    (v: NotesPanelVariantId) => {
      setPanelVariant(v);
      if (userId && selectedWorkspaceId) writeNotesPanelVariant(userId, selectedWorkspaceId, v);
    },
    [userId, selectedWorkspaceId],
  );

  // Detail hub "open" — notes select in place; other entities deep-link out.
  const handleOpenEntity = useCallback(
    (ref: EntityRef) => {
      if (ref.type === "note") {
        select(ref.id);
        return;
      }
      window.dispatchEvent(
        new CustomEvent("moduo:entity:open", { detail: { type: ref.type, id: ref.id } }),
      );
    },
    [select],
  );

  // Quote-comments (AC9): grab the editor's current selection; scroll the editor
  // to a quoted snippet (best-effort — edited-away text degrades quietly).
  const getSelectionQuote = useCallback((): string | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const editorEl = document.querySelector(".notes-editor-v2");
    const anchor = sel.anchorNode;
    if (!editorEl || !anchor || !editorEl.contains(anchor)) return null;
    return sel.toString().trim() || null;
  }, []);
  const scrollToQuote = useCallback((quote: string) => {
    const editorEl = document.querySelector(".notes-editor-v2");
    if (!editorEl) return;
    if (findQuoteOffset(editorEl.textContent ?? "", quote) === null) {
      toast.info("That text isn’t in the note anymore.");
      return;
    }
    const firstWord = quote.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    for (const b of editorEl.querySelectorAll("p, h1, h2, h3, h4, li, blockquote")) {
      if ((b.textContent ?? "").toLowerCase().includes(firstWord)) {
        b.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
  }, []);
  const outlineNavigate = useCallback((h: OutlineHeading) => {
    const editorEl = document.querySelector(".notes-editor-v2");
    if (!editorEl) return;
    const headings = editorEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
    headings[h.index - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Markdown interchange (NO-8): import wizard + per-note / subtree export.
  const [importOpen, setImportOpen] = useState(false);
  const exportNote = useCallback(
    async (id: string, title: string) => {
      const name = displayTitle(title);
      let md = "";
      if (engine && id === selectedId) {
        // The open note derives freshest from its live doc; others read body_md.
        md = deriveBody(engine.getOrCreateSession(id).doc).md;
      }
      // Fall back to the server body_md when the note isn't open OR its live doc
      // is still empty (e.g. a just-imported note not yet materialized) — M2/m3.
      if (!md && runtime && selectedWorkspaceId) {
        const docs = await runtime.notesV2.fetchExportDocs({
          workspaceId: selectedWorkspaceId,
          ids: [id],
        });
        md = docs[0]?.bodyMd ?? "";
      }
      downloadTextFile(noteFileName(name), md || `# ${name}\n`);
    },
    [engine, selectedId, runtime, selectedWorkspaceId],
  );
  const exportTree = useCallback(
    async (id: string) => {
      if (!runtime || !selectedWorkspaceId) return;
      const ids = [id, ...descendantIds(notes, id)];
      const byId = new Map(notes.map((n) => [n.id, n]));
      const docs = await runtime.notesV2.fetchExportDocs({ workspaceId: selectedWorkspaceId, ids });
      const mdById = new Map(docs.map((d) => [d.id, d.bodyMd]));
      // Folder path = the note's ancestor titles from the export root down.
      const pathOf = (nid: string): string[] => {
        if (nid === id) return [];
        const chain: string[] = [];
        let cur = byId.get(nid)?.parentId ?? null;
        while (cur && chain.length < 12) {
          const p = byId.get(cur);
          if (!p) break;
          chain.unshift(displayTitle(p.title));
          if (cur === id) break;
          cur = p.parentId ?? null;
        }
        return chain;
      };
      const zipNotes = ids
        .filter((nid) => byId.has(nid))
        .map((nid) => ({
          id: nid,
          title: displayTitle(byId.get(nid)!.title),
          md: mdById.get(nid) ?? "",
          pathSegments: pathOf(nid),
        }));
      downloadZip(
        `${safeFileStem(displayTitle(byId.get(id)?.title ?? "notes"))}.zip`,
        buildZipEntries(zipNotes),
      );
    },
    [runtime, selectedWorkspaceId, notes],
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
      onSearch={
        runtime && selectedWorkspaceId && !degraded
          ? (q) =>
              runtime.notesV2
                .search({ workspaceId: selectedWorkspaceId, query: q })
                .then((rows) => shapeNoteSearchResults(rows, q))
          : undefined
      }
      onImport={canEdit ? () => setImportOpen(true) : undefined}
      onExportNote={exportNote}
      onExportTree={exportTree}
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
      {selectedNote && !selectedNote.deletedAt && !degraded && runtime ? (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <NotePresenceAvatars viewers={viewers} />
          {syncStatus === "offline" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center rounded-full bg-muted p-1.5 text-muted-foreground">
                  <CloudOff className="size-3.5" aria-label="Saved locally" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">Saved locally — will sync</TooltipContent>
            </Tooltip>
          ) : null}
          <NotePublishControl
            note={selectedNote}
            notes={notes}
            canEdit={canEdit}
            publishedUrl={(token) => runtime.notesV2.publishedUrl(token)}
            onPublish={() => module.publishNote(selectedNote.id)}
            onUnpublish={() => module.unpublishNote(selectedNote.id)}
          />
        </div>
      ) : viewers.length > 0 || syncStatus === "offline" ? (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <NotePresenceAvatars viewers={viewers} />
          {syncStatus === "offline" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center rounded-full bg-muted p-1.5 text-muted-foreground">
                  <CloudOff className="size-3.5" aria-label="Saved locally" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">Saved locally — will sync</TooltipContent>
            </Tooltip>
          ) : null}
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

  // The right panel is now the switchable surface (NO-7): Detail · Comments ·
  // Outline for the open note, plus a transient Task-detail variant that a
  // focused task line (NO-5) prepends and activates.
  // Bridge lookup (bundle + just-minted overlay) so it works the instant a mint
  // lands, before the bundle reload catches up.
  const detailTask = taskDetailId ? taskBridge.getTask(taskDetailId) : null;
  const noteForPanel = selectedNote && !selectedNote.deletedAt ? selectedNote : null;
  const panelSession = noteForPanel && engine ? engine.getOrCreateSession(noteForPanel.id) : null;

  const noteVariants: RightPanelVariant[] =
    noteForPanel && selectedWorkspaceId
      ? [
          {
            id: "detail",
            label: "Detail",
            render: () => (
              <NoteDetailPanel
                runtime={runtime}
                workspaceId={selectedWorkspaceId}
                noteId={noteForPanel.id}
                canEdit={canEdit && !degraded}
                currentUserId={userId}
                onOpenEntity={handleOpenEntity}
              />
            ),
          },
          {
            id: "comments",
            label: "Comments",
            render: () => (
              <NoteCommentsPanel
                runtime={runtime}
                workspaceId={selectedWorkspaceId}
                noteId={noteForPanel.id}
                noteLabel={displayTitle(noteForPanel.title)}
                canComment={modulePermissions.notes !== "none"}
                currentUserId={userId}
                getSelectionQuote={getSelectionQuote}
                onScrollToQuote={scrollToQuote}
              />
            ),
          },
          {
            id: "outline",
            label: "Outline",
            render: () => <NoteOutlinePanel doc={panelSession?.doc ?? null} onNavigate={outlineNavigate} />,
          },
        ]
      : [];

  const taskVariant: RightPanelVariant | null = detailTask
    ? {
        id: "task",
        label: "Task",
        render: () => (
          <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
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
        ),
      }
    : null;

  const panelVariants = taskVariant ? [taskVariant, ...noteVariants] : noteVariants;
  const activePanel = taskVariant ? "task" : panelVariant;
  const onPanelChange = (id: string) => {
    if (id === "task") return;
    setTaskDetailId(null); // leaving the Task tab closes the focused task
    changePanelVariant(id as NotesPanelVariantId);
  };

  const right =
    noteForPanel && panelVariants.length > 0 ? (
      <RightPanelSwitcher variants={panelVariants} activeId={activePanel} onChange={onPanelChange} />
    ) : undefined;

  return (
    <>
      <FeaturePanelsShell
        feature="notes"
        left={sidebar}
        center={center}
        right={right}
        hideRight={!right}
      />
      <NoteImportDialog
        runtime={runtime}
        workspaceId={selectedWorkspaceId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={module.refresh}
      />
    </>
  );
}
