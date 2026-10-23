/**
 * New Notes — the refreshed shell (specs/notes-refresh.md NR-2), behind the
 * per-user switch. Composition only: state lives in use-notes-shell.ts, the
 * gestures in use-shell-actions.ts.
 *
 * Sidebar (Favorites · Inbox · Pages) · one centred reading column under a
 * top bar · the right panel, closed by default. One DndContext spans all
 * three so a sidebar note can be reordered, dropped into the editor (a chip)
 * or onto the Detail hub (a link).
 */

import { DndContext, PointerSensor, pointerWithin, useSensor, useSensors } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { onSearchRequest } from "../../../components/app/search-events";
import { truncationNotice } from "../../../components/app/truncation-notice";
import { type CaptureSource, useCaptureSource } from "../../../lib/capture-source";
import type { EntityRef } from "../../../lib/entity-links";
import { undoToast } from "../../../lib/undo-toast";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { dispatchLayoutPanelsSet, useFeaturePanelState } from "../../layout/panel-events";
import { ShareMenu } from "../../sharing/share-menu";
import { useCommentPeople } from "../../spine/hooks/use-comment-people";
import { TasksProvider } from "../../tasks/tasks-context";
import type { NotesEditorBridge } from "../editor/notes-editor-bridge";
import { useNoteLinkDrop } from "../hooks/use-note-link-drop";
import { useNoteRealtime } from "../hooks/use-note-realtime";
import { useTrashWithTaskDetach } from "../hooks/use-trash-with-task-detach";
import type { Note } from "../model";
import { noteEditorName } from "../note-meta";
import { isPublished } from "../publish";
import { displayTitle } from "../title";
import { NoteImportDialog } from "../ui/note-import-dialog";
import { NotePublishControl } from "../ui/note-publish-control";
import { buildBreadcrumb, type CrumbSection } from "./breadcrumb";
import { createLinkedNote } from "./create-linked-note";
import { IconPickerDialog } from "./icon-picker-dialog";
import { MoveToDialog } from "./move-to-dialog";
import { NoteView } from "./note-view";
import { NotesRightPanel } from "./notes-right-panel";
import { NotesSidebar } from "./notes-sidebar";
import { NotesTopBar } from "./notes-top-bar";
import { SharingQuestionDialog } from "./sharing-question-dialog";
import type { FooterView } from "./sidebar-footer-views";
import { useNotesShell } from "./use-notes-shell";
import { useShellActions } from "./use-shell-actions";
import { useShellTasks } from "./use-shell-tasks";

export function NotesShell() {
  // Task lines read the Tasks context (A4): the provider wraps the whole shell.
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  return (
    <TasksProvider
      runtime={runtime}
      userId={userId}
      workspaceId={selectedWorkspaceId}
      modulePermission={modulePermissions.tasks}
    >
      <NotesShellBody />
    </TasksProvider>
  );
}

function NotesShellBody() {
  const shell = useNotesShell();
  const { runtime, userId, workspace, workspaceId, module, selectedId, selectedNote, draft } =
    shell;
  const { notes, favorites, engine, canEdit, degraded, loading } = module;
  const [importOpen, setImportOpen] = useState(false);
  const [footerView, setFooterView] = useState<FooterView | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const panels = useFeaturePanelState("notes");
  const panelsRef = useRef(panels);
  useEffect(() => {
    panelsRef.current = panels;
  });

  // The bottom bar's Search finds notes while Notes is open (its sidebar
  // search, opened with the sidebar if it was collapsed); ⌘K stays global.
  const openSearch = useCallback(() => {
    const { left, right } = panelsRef.current;
    if (!left) dispatchLayoutPanelsSet({ feature: "notes", left: true, right });
    setFooterView(null);
    setSearchOpen(true);
    // Already open: put the caret back in the box.
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>('[data-slot="notes-search"] input')?.focus(),
    );
  }, []);
  useEffect(
    () =>
      onSearchRequest(() => {
        openSearch();
        return true;
      }),
    [openSearch],
  );
  const searchText = useCallback(
    (query: string) =>
      runtime && workspaceId
        ? runtime.notesV2.search({ workspaceId, query, limit: 30 })
        : Promise.resolve([]),
    [runtime, workspaceId],
  );

  const isDraft = draft !== null && selectedId === draft.id;
  const liveNote = selectedNote && !selectedNote.deletedAt ? selectedNote : null;
  const editorNoteId = isDraft ? draft.id : (liveNote?.id ?? null);
  // An open note rides along on a capture as "From: …" (tasks-v3 call 93); a
  // draft isn't on the server yet, so it has nothing to link.
  const liveNoteId = isDraft ? null : (liveNote?.id ?? null);
  const liveNoteTitle = liveNote ? displayTitle(liveNote.title) : null;
  const captureSource = useMemo<CaptureSource | null>(
    () =>
      liveNoteId && liveNoteTitle !== null
        ? { kind: "note", label: liveNoteTitle, ref: { type: "note", id: liveNoteId } }
        : null,
    [liveNoteId, liveNoteTitle],
  );
  useCaptureSource(captureSource);

  const tasks = useShellTasks({
    runtime,
    workspaceId,
    noteId: editorNoteId,
    noteLabel: displayTitle(selectedNote?.title ?? ""),
    onShowPanel: () => shell.setPanelOpen(true),
  });
  const trashWithDetach = useTrashWithTaskDetach({
    runtime,
    workspaceId,
    module,
    deleteTask: tasks.deleteTask,
  });
  const actions = useShellActions(shell, trashWithDetach);

  // The editor ↔ module bridge (NO-4): page rows read live titles, a click
  // opens the note, `/page` creates a child of the open note.
  // Warm the notes you're likely to open (favorites, then the latest edited)
  // while the browser is idle, so they open with their content at once.
  const warmedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!engine || !module.listFresh || !workspaceId || warmedFor.current === workspaceId) return;
    warmedFor.current = workspaceId;
    const ids = [
      ...favorites.map((f) => f.noteId),
      ...[...notes]
        .filter((n) => !n.deletedAt && !n.isArchived)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 4)
        .map((n) => n.id),
    ];
    const queue = [...new Set(ids)].slice(0, 8);
    const idle = (cb: () => void) => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb);
      else setTimeout(cb, 200);
    };
    const next = () => {
      const id = queue.shift();
      if (!id) return;
      void engine.getOrCreateSession(id);
      idle(next);
    };
    idle(next);
  }, [engine, module.listFresh, workspaceId, favorites, notes]);

  // Stable across note-list changes (a rename, a refresh): the list and the
  // module ride refs, so the open editor and its plugins aren't re-rendered
  // and re-subscribed every time any note changes.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const notesListeners = useRef(new Set<() => void>());
  useEffect(() => {
    for (const listener of notesListeners.current) listener();
  }, [notes]);
  const moduleRef = useRef(module);
  moduleRef.current = module;
  const bridge = useMemo<NotesEditorBridge>(
    () => ({
      getNoteMeta: (id) => notesRef.current.find((n) => n.id === id) ?? null,
      openNote: (id) => shell.select(id),
      // A draft like the sidebar's "+": it reaches the server only once typed
      // in, so a `/page` you leave empty leaves nothing behind.
      createChildNote: () => (liveNoteId ? shell.openDraft(liveNoteId) : null),
      tasks: tasks.taskBridge,
      listNotes: () => notesRef.current,
      createLinkedNote: (title) =>
        engine && canEdit
          ? createLinkedNote({
              engine,
              materializeDraft: moduleRef.current.materializeDraft,
              title,
            })
          : null,
      createSubpage: (title) =>
        engine && canEdit && liveNoteId
          ? createLinkedNote({
              engine,
              materializeDraft: moduleRef.current.materializeDraft,
              title,
              parentId: liveNoteId,
            })
          : null,
      openComments: () => shell.showPanelVariant("comments"),
      subpagesListedFor: liveNoteId ?? undefined,
      subscribeNotes: (listener) => {
        notesListeners.current.add(listener);
        return () => notesListeners.current.delete(listener);
      },
    }),
    [
      shell.select,
      shell.openDraft,
      shell.showPanelVariant,
      liveNoteId,
      tasks.taskBridge,
      engine,
      canEdit,
    ],
  );

  const canRender = Boolean(
    runtime &&
    userId &&
    workspaceId &&
    !shell.configError &&
    workspace.modulePermissions.notes !== "none",
  );
  const people = useCommentPeople();
  const { viewers } = useNoteRealtime({
    notes: runtime?.notesV2 ?? null,
    engine: engine ?? null,
    // A draft isn't on the server yet: nobody can view it, and you aren't
    // viewing the note you had open before it.
    noteId: liveNoteId,
    enabled: canRender,
    selfUserId: userId,
    personOf: people.personOf,
  });

  const onDragEnd = useNoteLinkDrop({ runtime, workspaceId, canEdit });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const favoritePositions = useMemo(
    () => new Map(favorites.map((f) => [f.noteId, f.position])),
    [favorites],
  );

  const openEntity = useCallback(
    (ref: EntityRef) => {
      if (ref.type === "note") shell.select(ref.id);
      // A task opens in the panel beside the note, never by leaving Notes.
      else if (ref.type === "task") tasks.taskBridge.openTaskDetail(ref.id);
      else
        window.dispatchEvent(
          new CustomEvent("moduo:entity:open", { detail: { type: ref.type, id: ref.id } }),
        );
    },
    [shell.select, tasks.taskBridge],
  );

  const openSection = useCallback(
    (section: CrumbSection) => {
      if (!panels.left)
        dispatchLayoutPanelsSet({ feature: "notes", left: true, right: panels.right });
      if (section === "archive" || section === "trash") {
        setFooterView(section);
        return;
      }
      setFooterView(null);
      // Reveal and focus that section's first row once the tree is drawn.
      requestAnimationFrame(() => {
        const header = document.querySelector<HTMLElement>(`[data-drop-header="${section}"]`);
        header?.scrollIntoView({ block: "nearest" });
        header?.parentElement
          ?.querySelector<HTMLElement>('[role="treeitem"]')
          ?.focus({ preventScroll: true });
      });
    },
    [panels.left, panels.right],
  );

  if (!canRender || !workspaceId) {
    return (
      <FeaturePanelsShell
        feature="notes"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <h2 className="font-display text-2xl text-foreground">Notes unavailable</h2>
            <p className="text-sm">
              {shell.configError ??
                (workspace.modulePermissions.notes === "none"
                  ? "You do not have Notes access in this workspace."
                  : "Authentication or workspace is missing.")}
            </p>
          </div>
        }
      />
    );
  }

  // Share… and Publish… from a row's menu open on that row (rowPopover).
  const members = workspace.members
    .filter((m) => m.isActive && !m.removedAt)
    .map((m) => ({ userId: m.userId, name: m.displayName?.trim() || "Member" }));
  const closeRowPopover = (open: boolean) => {
    if (!open) actions.setRowPopover(null);
  };
  const rowPopover = (note: Note, rowKey: string) => {
    const pop = actions.rowPopover;
    if (!pop || pop.noteId !== note.id || pop.rowKey !== rowKey || !runtime) return null;
    if (note.isArchived || degraded) return null;
    if (pop.kind === "share") {
      return (
        <ShareMenu
          key={`share:${note.id}`}
          anchor="parent"
          defaultOpen
          onOpenChange={closeRowPopover}
          resourceType="note"
          resourceId={note.id}
          inheritsFromParent={note.shareMode === "inherit" && note.parentId != null}
          selfUserId={userId}
          members={members}
        />
      );
    }
    return (
      <NotePublishControl
        anchor="parent"
        open
        onOpenChange={closeRowPopover}
        note={note}
        notes={notes}
        canEdit={canEdit && workspace.can("ws.publish")}
        publishedUrl={(token) => runtime.notesV2.publishedUrl(token)}
        onPublish={() => module.publishNote(note.id)}
        onUnpublish={() => module.unpublishNote(note.id)}
      />
    );
  };

  const topBar = (
    <NotesTopBar
      crumbs={selectedId ? buildBreadcrumb(notes, selectedId, draft) : []}
      viewers={viewers}
      signal={
        module.syncStatus === "offline" ? "unsynced" : module.loadError !== null ? "stale" : null
      }
      onOpenNote={(id) => shell.select(id)}
      onOpenSection={openSection}
    />
  );

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        autoScroll={false}
        onDragEnd={onDragEnd}
      >
        <FeaturePanelsShell
          feature="notes"
          notice={truncationNotice(module.truncated)}
          left={
            <NotesSidebar
              workspaceId={workspaceId}
              notes={shell.sidebarNotes}
              sections={shell.sections}
              favoritePositions={favoritePositions}
              selectedId={selectedId}
              draftId={draft?.id ?? null}
              canEdit={canEdit && !degraded}
              loading={loading}
              footerView={footerView}
              onFooterViewChange={setFooterView}
              onOpen={(id) => shell.select(id)}
              onAction={actions.onAction}
              rowPopover={rowPopover}
              canShare={members.length > 1}
              onWarm={(id) => void engine?.getOrCreateSession(id)}
              onNewCapture={() => shell.openDraft(null)}
              onNewPage={() => shell.openDraft(null, { toPages: true })}
              onCreateChild={(parentId) => shell.openDraft(parentId)}
              onDropIntent={actions.applyIntent}
              onUnarchive={(id) => module.archiveNote(id, false)}
              onTrash={actions.trash}
              onUnfavorite={(id, opts) => {
                module.setFavorite(id, false);
                if (opts?.undoable) {
                  undoToast("Removed from favorites", {
                    onUndo: () => module.setFavorite(id, true),
                  });
                }
              }}
              onRestore={module.restoreNote}
              onPurge={(id) => {
                void module.purgeNote(id);
                if (selectedId === id) shell.select(null, true);
              }}
              onImport={canEdit && !degraded ? () => setImportOpen(true) : undefined}
              search={{
                open: searchOpen,
                query: searchQuery,
                onQueryChange: setSearchQuery,
                onOpenChange: (open) => (open ? openSearch() : setSearchOpen(false)),
                notes,
                searchText,
              }}
            />
          }
          center={
            <NoteView
              topBar={topBar}
              runtime={runtime}
              engine={engine}
              workspaceId={workspaceId}
              editorNoteId={editorNoteId}
              note={selectedNote}
              isDraft={isDraft}
              // An archived note reads, it doesn't take edits (unarchive first).
              editable={canEdit && !degraded && !(liveNote?.isArchived ?? false)}
              degraded={degraded}
              loading={loading}
              canEdit={canEdit && !degraded}
              bridge={bridge}
              onTitleDerived={(title) => {
                if (liveNote) module.renameNote(liveNote.id, title);
                else if (editorNoteId) module.renameNote(editorNoteId, title);
              }}
              onRestore={module.restoreNote}
              onUnarchive={(id) => module.archiveNote(id, false)}
              onOpenEntity={openEntity}
              onOpenDetail={() => shell.showPanelVariant("detail")}
              memberName={(id) => noteEditorName(id, userId, workspace.members)}
              onOpenComments={() => shell.showPanelVariant("comments")}
              publicChip={
                liveNote && isPublished(liveNote) && runtime ? (
                  <NotePublishControl
                    anchor="chip"
                    note={liveNote}
                    notes={notes}
                    canEdit={canEdit && workspace.can("ws.publish")}
                    publishedUrl={(token) => runtime.notesV2.publishedUrl(token)}
                    onPublish={() => module.publishNote(liveNote.id)}
                    onUnpublish={() => module.unpublishNote(liveNote.id)}
                  />
                ) : null
              }
            />
          }
          right={
            <NotesRightPanel
              runtime={runtime}
              workspaceId={workspaceId}
              userId={userId}
              note={liveNote}
              doc={liveNote && engine ? engine.getOrCreateSession(liveNote.id).doc : null}
              canEdit={canEdit && !degraded}
              canComment={workspace.modulePermissions.notes !== "none"}
              variant={shell.panelVariant}
              onVariantChange={shell.showPanelVariant}
              taskBridge={tasks.taskBridge}
              location={
                liveNote
                  ? buildBreadcrumb(notes, liveNote.id, draft)
                      .slice(0, -1)
                      .map((c) => c.label)
                      .join(" › ")
                  : ""
              }
              editedBy={
                liveNote?.editedBy
                  ? noteEditorName(liveNote.editedBy, userId, workspace.members)
                  : null
              }
              taskDetailId={tasks.taskDetailId}
              onTaskDetail={tasks.setTaskDetailId}
              onOpenEntity={openEntity}
            />
          }
        />
      </DndContext>
      <NoteImportDialog
        runtime={runtime}
        workspaceId={workspaceId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={module.refresh}
        existingRootPositions={notes
          .filter((n) => !n.parentId && !n.deletedAt)
          .map((n) => n.position)}
      />
      <MoveToDialog
        note={actions.moveTarget}
        sections={shell.sections}
        onOpenChange={(open) => !open && actions.setMoveTarget(null)}
        onPick={actions.pickMoveTarget}
      />
      <IconPickerDialog
        note={actions.iconTarget}
        onOpenChange={(open) => !open && actions.setIconTarget(null)}
        onPick={(note, icon) => module.setIcon(note.id, icon)}
      />
      <SharingQuestionDialog
        open={actions.sharingQuestion !== null}
        onAnswer={actions.answerSharing}
      />
    </>
  );
}
