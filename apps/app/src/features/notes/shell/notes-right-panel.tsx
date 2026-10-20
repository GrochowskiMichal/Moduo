/**
 * The right panel, lifted from the classic page (specs/notes-refresh.md NR-2,
 * AC5): Detail · Comments · Outline for the open note are its views (the
 * title-row switcher, SH-1); a task a task line opens shows on top as an item
 * ("← title"). Closed by default in the new shell; the view you last opened is
 * remembered per user (panel-prefs.ts).
 */

import { CheckSquare } from "lucide-react";
import type * as Y from "yjs";
import { type PanelItem, RightPanel } from "../../../components/app/right-panel";
import type { EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { HubDropZone } from "../../contacts/ui/hub-drop-zone";
import { ContextTaskDetailPanel } from "../../tasks/ui/context-task-detail-panel";
import type { NotesTaskBridge } from "../editor/notes-editor-bridge";
import type { Note } from "../model";
import type { NotesPanelVariantId } from "../panel-prefs";
import { displayTitle } from "../title";
import { NoteCommentsPanel } from "../ui/note-comments-panel";
import { NoteDetailPanel } from "../ui/note-detail-panel";
import { NoteOutlinePanel } from "../ui/note-outline-panel";
import { getEditorSelectionQuote, scrollEditorToHeading, scrollEditorToQuote } from "./editor-dom";

export function NotesRightPanel({
  runtime,
  workspaceId,
  userId,
  note,
  doc,
  canEdit,
  canComment,
  variant,
  onVariantChange,
  taskBridge,
  taskDetailId,
  onTaskDetail,
  onOpenEntity,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  userId: string | null;
  /** The open, live note (null for a draft or nothing open). */
  note: Note | null;
  doc: Y.Doc | null;
  canEdit: boolean;
  canComment: boolean;
  variant: NotesPanelVariantId;
  onVariantChange: (variant: NotesPanelVariantId) => void;
  taskBridge: NotesTaskBridge;
  taskDetailId: string | null;
  onTaskDetail: (id: string | null) => void;
  onOpenEntity: (ref: EntityRef) => void;
}) {
  if (!note) {
    return (
      <div className="grid h-full place-content-center px-4 text-center text-sm text-muted-foreground">
        Open a note to see its links, comments and outline.
      </div>
    );
  }

  // The registered views (../panel-views.ts).
  const views = {
    detail: () => (
      // Dropping a note on the hub links it to the open note (NO-7b).
      <HubDropZone target={{ type: "note", id: note.id }} disabled={!canEdit}>
        <NoteDetailPanel
          runtime={runtime}
          workspaceId={workspaceId}
          noteId={note.id}
          canEdit={canEdit}
          currentUserId={userId}
          onOpenEntity={onOpenEntity}
        />
      </HubDropZone>
    ),
    comments: () => (
      <NoteCommentsPanel
        runtime={runtime}
        workspaceId={workspaceId}
        noteId={note.id}
        noteLabel={displayTitle(note.title)}
        canComment={canComment}
        currentUserId={userId}
        getSelectionQuote={getEditorSelectionQuote}
        onScrollToQuote={scrollEditorToQuote}
      />
    ),
    outline: () => <NoteOutlinePanel doc={doc} onNavigate={scrollEditorToHeading} />,
  };

  const task = taskDetailId ? taskBridge.getTask(taskDetailId) : null;
  const taskItem: PanelItem | null = task
    ? {
        key: `task:${task.id}`,
        title: task.title,
        icon: CheckSquare,
        render: () => (
          <HubDropZone target={{ type: "task", id: task.id }} disabled={!canEdit}>
            <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
              <ContextTaskDetailPanel
                task={task}
                onRequestCapture={() => {}}
                onSelectTask={onTaskDetail}
                runtime={runtime}
                workspaceId={workspaceId}
                onOpenEntity={onOpenEntity}
              />
            </div>
          </HubDropZone>
        ),
      }
    : null;

  return (
    <RightPanel
      module="notes"
      views={views}
      activeId={variant}
      onChange={(id) => onVariantChange(id as NotesPanelVariantId)}
      items={taskItem ? [taskItem] : []}
      onBack={() => onTaskDetail(null)}
    />
  );
}
