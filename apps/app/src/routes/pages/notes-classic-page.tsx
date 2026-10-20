/**
 * /notes, classic — the Wave-3 rebuilt three-pane Notes page (NO-3, AC1/AC2/AC12).
 * Frozen while the refresh ships behind the New Notes switch (NR-2): bug
 * fixes only; NR-12 deletes it.
 * Sidebar sections + tree · CRDT editor (first line = title) · right panel
 * arrives with NO-7 (hidden until then). Selection is URL-held (?id=).
 */

import { DndContext, PointerSensor, pointerWithin, useSensor, useSensors } from "@dnd-kit/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CheckSquare, CloudOff, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onCreateNew } from "../../components/app/create-events";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { type PanelItem, RightPanel } from "../../components/app/right-panel";
import { truncationNotice } from "../../components/app/truncation-notice";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { HubDropZone } from "../../features/contacts/ui/hub-drop-zone";
import { tryDeriveNoteBody } from "../../features/notes/editor/doc-markdown";
import {
  INSERT_PAGE_ROW_EVENT,
  type NotesEditorBridge,
} from "../../features/notes/editor/notes-editor-bridge";
import { useNotesExperience } from "../../features/notes/experience";
import {
  buildZipEntries,
  downloadTextFile,
  downloadZip,
  noteFileName,
  safeFileStem,
} from "../../features/notes/export";
import { useNoteLinkDrop } from "../../features/notes/hooks/use-note-link-drop";
import { useNoteRealtime } from "../../features/notes/hooks/use-note-realtime";
import { useNotesModule } from "../../features/notes/hooks/use-notes-module";
import { useNotesTaskBridge } from "../../features/notes/hooks/use-notes-task-bridge";
import { useTrashWithTaskDetach } from "../../features/notes/hooks/use-trash-with-task-detach";
import {
  type NotesPanelVariantId,
  readNotesPanelVariant,
  writeNotesPanelVariant,
} from "../../features/notes/panel-prefs";
import { type NotesSearch, shapeNoteSearchResults } from "../../features/notes/search";
import {
  getEditorSelectionQuote,
  scrollEditorToHeading,
  scrollEditorToQuote,
} from "../../features/notes/shell/editor-dom";
import { SharingQuestionDialog } from "../../features/notes/shell/sharing-question-dialog";
import { displayTitle } from "../../features/notes/title";
import {
  buildNoteSections,
  type DropZone,
  descendantIds,
  resolveDrop,
} from "../../features/notes/tree";
import { NoteCommentsPanel } from "../../features/notes/ui/note-comments-panel";
import { NoteDetailPanel } from "../../features/notes/ui/note-detail-panel";
import { NoteEditor } from "../../features/notes/ui/note-editor";
import { NoteImportDialog } from "../../features/notes/ui/note-import-dialog";
import { NoteOutlinePanel } from "../../features/notes/ui/note-outline-panel";
import { NotePresenceAvatars } from "../../features/notes/ui/note-presence-avatars";
import { NotePublishControl } from "../../features/notes/ui/note-publish-control";
import { NoteTreeSidebar } from "../../features/notes/ui/note-tree-sidebar";
import { NotesEditorDropZone } from "../../features/notes/ui/notes-editor-drop-zone";
import { noteIsPrivate } from "../../features/sharing/rules";
import { ShareMenu } from "../../features/sharing/share-menu";
import { useCommentPeople } from "../../features/spine/hooks/use-comment-people";
import { betweenPositions, endPosition } from "../../features/tasks/helpers";
import { useTasksModule } from "../../features/tasks/hooks/use-tasks-module";
import { TaskDetailPanel } from "../../features/tasks/ui/task-detail-panel";
import { type CaptureSource, useCaptureSource } from "../../lib/capture-source";
import type { EntityRef } from "../../lib/entity-links";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

export function NotesClassicPage() {
  const { runtime, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions, can, members } = useWorkspace();
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
    truncated,
    loadError,
    syncStatus,
    engine,
    canEdit,
    welcomeNoteId,
  } = module;

  const sections = useMemo(() => buildNoteSections(notes), [notes]);
  const selectedId = search.id ?? null;
  const [, setExperience] = useNotesExperience();
  const selectedNote = useMemo(
    () => (selectedId ? (notes.find((n) => n.id === selectedId) ?? null) : null),
    [notes, selectedId],
  );
  // An open note rides along on a capture as "From: …" (tasks-v3 call 93).
  const selectedNoteTitle = selectedNote ? displayTitle(selectedNote.title) : null;
  const captureSource = useMemo<CaptureSource | null>(
    () =>
      selectedId && selectedNoteTitle !== null
        ? { kind: "note", label: selectedNoteTitle, ref: { type: "note", id: selectedId } }
        : null,
    [selectedId, selectedNoteTitle],
  );
  useCaptureSource(captureSource);

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
  useEffect(() => {
    createRef.current = create;
  });

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

  // Opening a note jumps it to the front of the blank-note repair queue
  // (NOTE-FIX-1) — the background sweep is sequential, and a note you open
  // and type into before it is reached would lose its imported body.
  useEffect(() => {
    if (loading || !selectedId) return;
    void module.repairNoteNow(selectedId);
  }, [loading, selectedId, module.repairNoteNow]);

  // Task lines (NO-5): the Tasks module rides along so lines render live
  // rows, the `/task` picker searches real tasks, and the Task-detail rail
  // edits without leaving /notes.
  const tasksApi = useTasksModule(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.tasks,
  });

  // A task opened from the note shows in the right panel as an item ("← title")
  // on top of the current view — meta click opens it; note switch closes it.
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

  const trashWithTaskDetach = useTrashWithTaskDetach({
    runtime,
    workspaceId: selectedWorkspaceId,
    module,
    deleteTask: tasksApi.deleteTask,
  });

  // A shared note dropped under a private one: ask first (the shared dialog),
  // then move. "Match the new parent" rides the same server op as the move.
  type SharingQuestion = { noteId: string; parentId: string; position: string };
  const [sharingQuestion, setSharingQuestionState] = useState<SharingQuestion | null>(null);
  // The dialog can answer twice (the button, then its own close); the ref
  // makes the second answer a no-op.
  const questionRef = useRef<SharingQuestion | null>(null);
  const setSharingQuestion = useCallback((q: SharingQuestion | null) => {
    questionRef.current = q;
    setSharingQuestionState(q);
  }, []);
  const onDropRow = useCallback(
    (dragId: string, targetId: string, zone: DropZone) => {
      const drop = resolveDrop(notes, dragId, targetId, zone, {
        endPosition,
        betweenPositions,
      });
      if (!drop) return; // self/cycle/unknown — quiet no-op
      // A sub-note moved to the top level keeps everyone's access: the server
      // freezes what its parent gave it (NR-1, notes__keep_access_on_reroot).
      if (drop.parentId && noteIsPrivate(drop.parentId, notes) && !noteIsPrivate(dragId, notes)) {
        setSharingQuestion({ noteId: dragId, parentId: drop.parentId, position: drop.position });
        return;
      }
      void module.moveNote(dragId, drop.parentId, drop.position);
    },
    [notes, module, setSharingQuestion],
  );
  const answerSharing = useCallback(
    (match: boolean) => {
      const q = questionRef.current;
      setSharingQuestion(null);
      if (q) void module.moveNote(q.noteId, q.parentId, q.position, { followParent: match });
    },
    [module, setSharingQuestion],
  );

  const canRender = Boolean(
    runtime && userId && selectedWorkspaceId && !configError && modulePermissions.notes !== "none",
  );

  // Live multiplayer (NO-6, AC7): a broadcast + presence channel for the open
  // note — near-live edits + a viewer facepile. No-ops without a note/identity.
  const people = useCommentPeople();
  const { viewers } = useNoteRealtime({
    notes: runtime?.notesV2 ?? null,
    engine: engine ?? null,
    noteId: selectedNote && !selectedNote.deletedAt ? selectedNote.id : null,
    enabled: canRender && Boolean(selectedWorkspaceId),
    selfUserId: userId,
    personOf: people.personOf,
  });

  // Right-panel variant (NO-7): remembered per user+workspace.
  const [panelVariant, setPanelVariant] = useState<NotesPanelVariantId>("detail");
  useEffect(() => {
    if (userId && selectedWorkspaceId)
      setPanelVariant(readNotesPanelVariant(userId, selectedWorkspaceId));
  }, [userId, selectedWorkspaceId]);
  const changePanelVariant = useCallback(
    (v: NotesPanelVariantId) => {
      setPanelVariant(v);
      if (userId && selectedWorkspaceId) writeNotesPanelVariant(userId, selectedWorkspaceId, v);
    },
    [userId, selectedWorkspaceId],
  );

  // Page-level DnD (NO-7b): one context so a sidebar note can be dropped INTO the
  // editor (→ reference chip, no link write) or ONTO the Detail hub (→ a link).
  // Reorder rides the same context via the sidebar's monitor; the three drops are
  // spatially disjoint (editor / hub / a note row) so only one ever fires.
  const notesSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const onNotesDragEnd = useNoteLinkDrop({ runtime, workspaceId: selectedWorkspaceId, canEdit });

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

  // Markdown interchange (NO-8): import wizard + per-note / subtree export.
  const [importOpen, setImportOpen] = useState(false);
  const exportNote = useCallback(
    async (id: string, title: string) => {
      const name = displayTitle(title);
      let md = "";
      if (engine && id === selectedId) {
        // The open note derives freshest from its live doc; others read body_md.
        md = tryDeriveNoteBody(engine.getOrCreateSession(id).doc)?.md ?? "";
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
      dndMode="external"
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
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() =>
            void setExperience(
              "next",
              selectedId && engine ? () => engine.flushNote(selectedId) : undefined,
            )
          }
        >
          <Sparkles aria-hidden />
          Try the new Notes
        </Button>
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
        {selectedNote && !selectedNote.deletedAt && !degraded && runtime ? (
          <ShareMenu
            key={selectedNote.id}
            resourceType="note"
            resourceId={selectedNote.id}
            inheritsFromParent={
              selectedNote.shareMode === "inherit" && selectedNote.parentId != null
            }
            selfUserId={userId}
            members={members
              .filter((m) => m.isActive && !m.removedAt)
              .map((m) => ({ userId: m.userId, name: m.displayName?.trim() || "Member" }))}
          />
        ) : null}
        {selectedNote && !selectedNote.deletedAt && !degraded && runtime ? (
          <NotePublishControl
            note={selectedNote}
            notes={notes}
            canEdit={canEdit && can("ws.publish")}
            publishedUrl={(token) => runtime.notesV2.publishedUrl(token)}
            onPublish={() => module.publishNote(selectedNote.id)}
            onUnpublish={() => module.unpublishNote(selectedNote.id)}
          />
        ) : null}
      </div>
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

  // The right panel (NO-7, SH-1): Detail · Comments · Outline for the open
  // note are its views; a task opened from a focused task line (NO-5) shows on
  // top of them as an item ("← title").
  // Bridge lookup (bundle + just-minted overlay) so it works the instant a mint
  // lands, before the bundle reload catches up.
  const detailTask = taskDetailId ? taskBridge.getTask(taskDetailId) : null;
  const noteForPanel = selectedNote && !selectedNote.deletedAt ? selectedNote : null;
  const panelSession = noteForPanel && engine ? engine.getOrCreateSession(noteForPanel.id) : null;

  // The registered views (features/notes/panel-views.ts).
  const noteViews =
    noteForPanel && selectedWorkspaceId
      ? {
          detail: () => (
            // The hub is a drop target (NO-7b): dropping a note here links it
            // to the open note (drag-onto-hub = link only).
            <HubDropZone
              target={{ type: "note", id: noteForPanel.id }}
              disabled={!canEdit || degraded}
            >
              <NoteDetailPanel
                runtime={runtime}
                workspaceId={selectedWorkspaceId}
                noteId={noteForPanel.id}
                canEdit={canEdit && !degraded}
                currentUserId={userId}
                onOpenEntity={handleOpenEntity}
              />
            </HubDropZone>
          ),
          comments: () => (
            <NoteCommentsPanel
              runtime={runtime}
              workspaceId={selectedWorkspaceId}
              noteId={noteForPanel.id}
              noteLabel={displayTitle(noteForPanel.title)}
              canComment={modulePermissions.notes !== "none"}
              currentUserId={userId}
              getSelectionQuote={getEditorSelectionQuote}
              onScrollToQuote={scrollEditorToQuote}
            />
          ),
          outline: () => (
            <NoteOutlinePanel doc={panelSession?.doc ?? null} onNavigate={scrollEditorToHeading} />
          ),
        }
      : null;

  const taskItem: PanelItem | null = detailTask
    ? {
        key: `task:${detailTask.id}`,
        title: detailTask.title,
        icon: CheckSquare,
        render: () => (
          // The embedded task hub is a drop target too (DF-8): dragging a note
          // onto it links the note to the task, using the page's DndContext.
          <HubDropZone target={{ type: "task", id: detailTask.id }} disabled={!canEdit || degraded}>
            <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
              <TaskDetailPanel
                task={detailTask}
                buckets={tasksApi.buckets}
                inbox={tasksApi.inbox}
                canEdit={tasksApi.canEdit}
                onRequestCapture={() => {}}
                onSelectTask={setTaskDetailId}
                api={tasksApi}
                runtime={runtime}
                workspaceId={selectedWorkspaceId}
                onOpenEntity={handleOpenEntity}
              />
            </div>
          </HubDropZone>
        ),
      }
    : null;

  // Always give the shell a right slot (DF-13): with no note open the panel
  // shows a quiet empty state instead of vanishing — the surface stays real.
  const right = noteViews ? (
    <RightPanel
      module="notes"
      views={noteViews}
      activeId={panelVariant}
      onChange={(id) => changePanelVariant(id as NotesPanelVariantId)}
      items={taskItem ? [taskItem] : []}
      onBack={() => setTaskDetailId(null)}
    />
  ) : (
    <div className="grid h-full place-content-center px-4 text-center text-sm text-muted-foreground">
      Select a note to see its links, comments, and outline.
    </div>
  );

  const editorNoteId = noteForPanel?.id ?? null;

  return (
    <>
      <DndContext
        sensors={notesSensors}
        collisionDetection={pointerWithin}
        autoScroll={false}
        onDragEnd={onNotesDragEnd}
      >
        <FeaturePanelsShell
          feature="notes"
          notice={truncationNotice(truncated)}
          left={sidebar}
          center={
            <NotesEditorDropZone noteId={editorNoteId} editable={canEdit && !degraded}>
              {center}
            </NotesEditorDropZone>
          }
          right={right}
        />
      </DndContext>
      <NoteImportDialog
        runtime={runtime}
        workspaceId={selectedWorkspaceId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={module.refresh}
        // So the import APPENDS to the tree instead of interleaving with it.
        existingRootPositions={notes
          .filter((n) => !n.parentId && !n.deletedAt)
          .map((n) => n.position)}
      />
      <SharingQuestionDialog open={sharingQuestion !== null} onAnswer={answerSharing} />
    </>
  );
}
