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
import { useCallback, useMemo, useState } from "react";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { truncationNotice } from "../../../components/app/truncation-notice";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { type CaptureSource, useCaptureSource } from "../../../lib/capture-source";
import type { EntityRef } from "../../../lib/entity-links";
import { dispatchLayoutPanelsSet, useFeaturePanelState } from "../../layout/panel-events";
import { ShareMenu } from "../../sharing/share-menu";
import { useCommentPeople } from "../../spine/hooks/use-comment-people";
import type { NotesEditorBridge } from "../editor/notes-editor-bridge";
import { useNotesExperience } from "../experience";
import { useNoteLinkDrop } from "../hooks/use-note-link-drop";
import { useNoteRealtime } from "../hooks/use-note-realtime";
import { useTrashWithTaskDetach } from "../hooks/use-trash-with-task-detach";
import { shapeNoteSearchResults } from "../search";
import { displayTitle } from "../title";
import { NoteImportDialog } from "../ui/note-import-dialog";
import { NotePublishControl } from "../ui/note-publish-control";
import { buildBreadcrumb, type CrumbSection } from "./breadcrumb";
import { createLinkedNote } from "./create-linked-note";
import { MoveToDialog } from "./move-to-dialog";
import { NoteView } from "./note-view";
import { NotesRightPanel } from "./notes-right-panel";
import { NotesSidebar } from "./notes-sidebar";
import { NotesTopBar } from "./notes-top-bar";
import type { FooterView } from "./sidebar-footer-views";
import { useNotesShell } from "./use-notes-shell";
import { useShellActions } from "./use-shell-actions";
import { useShellTasks } from "./use-shell-tasks";

export function NotesShell() {
  const shell = useNotesShell();
  const { runtime, userId, workspace, workspaceId, module, selectedId, selectedNote, draft } =
    shell;
  const { notes, favorites, engine, canEdit, degraded, loading } = module;
  const [, setExperience] = useNotesExperience();
  const [importOpen, setImportOpen] = useState(false);
  const [footerView, setFooterView] = useState<FooterView | null>(null);
  const panels = useFeaturePanelState("notes");

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
    userId,
    workspaceId,
    tasksPermission: workspace.modulePermissions.tasks,
    noteId: editorNoteId,
    noteLabel: displayTitle(selectedNote?.title ?? ""),
  });
  const trashWithDetach = useTrashWithTaskDetach({
    runtime,
    workspaceId,
    module,
    deleteTask: tasks.tasksApi.deleteTask,
  });
  const actions = useShellActions(shell, trashWithDetach);
  const search = useCallback(
    (q: string) =>
      runtime && workspaceId
        ? runtime.notesV2
            .search({ workspaceId, query: q })
            .then((rows) => shapeNoteSearchResults(rows, q))
        : Promise.resolve([]),
    [runtime, workspaceId],
  );

  // The editor ↔ module bridge (NO-4): page rows read live titles, a click
  // opens the note, `/page` creates a child of the open note.
  const bridge = useMemo<NotesEditorBridge>(
    () => ({
      getNoteMeta: (id) => notes.find((n) => n.id === id) ?? null,
      openNote: (id) => shell.select(id),
      createChildNote: () => (liveNote ? module.createNote(liveNote.id) : null),
      tasks: tasks.taskBridge,
      listNotes: () => notes,
      createLinkedNote: (title) =>
        engine && canEdit
          ? createLinkedNote({ engine, materializeDraft: module.materializeDraft, title })
          : null,
      openComments: () => shell.showPanelVariant("comments"),
    }),
    [
      notes,
      shell.select,
      shell.showPanelVariant,
      liveNote,
      module,
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
      else
        window.dispatchEvent(
          new CustomEvent("moduo:entity:open", { detail: { type: ref.type, id: ref.id } }),
        );
    },
    [shell.select],
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

  const shareable = liveNote && !degraded && runtime;
  const topBar = (
    <NotesTopBar
      crumbs={selectedId ? buildBreadcrumb(notes, selectedId, draft) : []}
      note={liveNote}
      viewers={viewers}
      unsynced={module.syncStatus === "offline" || module.loadError !== null}
      canEdit={canEdit && !degraded}
      favorite={liveNote ? favoritePositions.has(liveNote.id) : false}
      share={
        shareable ? (
          <ShareMenu
            key={liveNote.id}
            resourceType="note"
            resourceId={liveNote.id}
            inheritsFromParent={liveNote.shareMode === "inherit" && liveNote.parentId != null}
            selfUserId={userId}
            members={workspace.members
              .filter((m) => m.isActive && !m.removedAt)
              .map((m) => ({ userId: m.userId, name: m.displayName?.trim() || "Member" }))}
          />
        ) : null
      }
      publish={
        shareable && (liveNote.publishToken || actions.publishOpen) ? (
          <NotePublishControl
            note={liveNote}
            notes={notes}
            canEdit={canEdit && workspace.can("ws.publish")}
            publishedUrl={(token) => runtime.notesV2.publishedUrl(token)}
            onPublish={() => module.publishNote(liveNote.id)}
            onUnpublish={() => module.unpublishNote(liveNote.id)}
            open={actions.publishOpen}
            onOpenChange={actions.setPublishOpen}
          />
        ) : null
      }
      panelOpen={shell.panelOpen}
      onTogglePanel={() => shell.setPanelOpen(!shell.panelOpen)}
      onOpenNote={(id) => shell.select(id)}
      onOpenSection={openSection}
      onAction={actions.onAction}
      onFullWidthChange={(note, fullWidth) => module.setFullWidth(note.id, fullWidth)}
      onSwitchToClassic={() =>
        void setExperience(
          "classic",
          editorNoteId && engine && !isDraft ? () => engine.flushNote(editorNoteId) : undefined,
        )
      }
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
              onNewCapture={() => shell.openDraft(null)}
              onNewPage={() => shell.openDraft(null, { toPages: true })}
              onCreateChild={(parentId) => shell.openDraft(parentId)}
              onAction={actions.onAction}
              onDropIntent={actions.applyIntent}
              onUnarchive={(id) => module.archiveNote(id, false)}
              onTrash={actions.trash}
              onRestore={module.restoreNote}
              onPurge={(id) => {
                void module.purgeNote(id);
                if (selectedId === id) shell.select(null, true);
              }}
              onSearch={runtime && !degraded ? search : undefined}
              onImport={canEdit && !degraded ? () => setImportOpen(true) : undefined}
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
              editable={canEdit && !degraded}
              degraded={degraded}
              loading={loading}
              canEdit={canEdit && !degraded}
              seedWelcome={module.welcomeNoteId !== null && module.welcomeNoteId === editorNoteId}
              bridge={bridge}
              onTitleDerived={(title) => {
                if (liveNote) module.renameNote(liveNote.id, title);
                else if (editorNoteId) module.renameNote(editorNoteId, title);
              }}
              onRestore={module.restoreNote}
              onOpenEntity={openEntity}
              onOpenDetail={() => shell.showPanelVariant("detail")}
              memberName={(id) =>
                workspace.members.find((m) => m.userId === id)?.displayName?.trim() || null
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
              taskDetailId={tasks.taskDetailId}
              onTaskDetail={tasks.setTaskDetailId}
              tasksApi={tasks.tasksApi}
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
      <AlertDialog
        open={actions.sharingQuestion !== null}
        onOpenChange={(open) => {
          // Esc / click-away = keep current access, and the move still happens.
          if (!open && actions.sharingQuestion) actions.answerSharing(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Moving under a private note</AlertDialogTitle>
            <AlertDialogDescription>
              This note is shared, and its new parent is private. Who should be able to see it?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => actions.answerSharing(false)}>
              Keep current access
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => actions.answerSharing(true)}>
              Match the new parent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
