/**
 * The right panel, lifted from the classic page (specs/notes-refresh.md NR-2,
 * AC5): Detail · Comments · Outline for the open note, plus the transient Task
 * variant a task line opens. Closed by default in the new shell; the variant
 * you last opened is remembered per user (panel-prefs.ts).
 */

import type * as Y from "yjs";
import {
  RightPanelSwitcher,
  type RightPanelVariant,
} from "../../../components/app/right-panel-switcher";
import type { EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { HubDropZone } from "../../contacts/ui/hub-drop-zone";
import type { useTasksModule } from "../../tasks/hooks/use-tasks-module";
import { TaskDetailPanel } from "../../tasks/ui/task-detail-panel";
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
  tasksApi,
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
  tasksApi: ReturnType<typeof useTasksModule>;
  onOpenEntity: (ref: EntityRef) => void;
}) {
  if (!note) {
    return (
      <div className="grid h-full place-content-center px-4 text-center text-sm text-muted-foreground">
        Open a note to see its links, comments and outline.
      </div>
    );
  }

  const variants: RightPanelVariant[] = [
    {
      id: "detail",
      label: "Detail",
      render: () => (
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
    },
    {
      id: "comments",
      label: "Comments",
      render: () => (
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
    },
    {
      id: "outline",
      label: "Outline",
      render: () => <NoteOutlinePanel doc={doc} onNavigate={scrollEditorToHeading} />,
    },
  ];

  const task = taskDetailId ? taskBridge.getTask(taskDetailId) : null;
  if (task) {
    variants.unshift({
      id: "task",
      label: "Task",
      render: () => (
        <HubDropZone target={{ type: "task", id: task.id }} disabled={!canEdit}>
          <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
            <TaskDetailPanel
              task={task}
              buckets={tasksApi.buckets}
              inbox={tasksApi.inbox}
              canEdit={tasksApi.canEdit}
              onRequestCapture={() => {}}
              onSelectTask={onTaskDetail}
              api={tasksApi}
              runtime={runtime}
              workspaceId={workspaceId}
              onOpenEntity={onOpenEntity}
            />
          </div>
        </HubDropZone>
      ),
    });
  }

  return (
    <RightPanelSwitcher
      variants={variants}
      activeId={task ? "task" : variant}
      onChange={(id) => {
        if (id === "task") return;
        onTaskDetail(null); // leaving the Task tab closes the focused task
        onVariantChange(id as NotesPanelVariantId);
      }}
    />
  );
}
