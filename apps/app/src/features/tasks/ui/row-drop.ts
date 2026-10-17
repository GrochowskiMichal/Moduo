// Files dropped on a List row or a Board card attach to that task (AT-3,
// AT3-1; web and desktop, where `dragDropEnabled: false` makes a Finder drop
// the same HTML5 drop). One set of listeners on the view's container finds
// the row under the pointer by its `data-task-id`; the view lights that one
// row with the shared drop look (DS-4's DROP_TARGET), so only the row the
// pointer enters and the one it leaves redraw.
//
// A file drag is never a dnd-kit drag (those run on pointer events), so the
// two never meet.

import type React from "react";
import { useCallback, useRef, useState } from "react";
import { attachFilesToTask } from "../../attachments/attach-to-task";
import { dragHasFiles, filesFromDataTransfer } from "../../attachments/files";
import type { Task } from "../model";

/** The task a file drag is over: the nearest row or card under the pointer. */
export function fileDropTaskId(target: EventTarget | null): string | null {
  if (!target || typeof (target as Element).closest !== "function") return null;
  const el = (target as Element).closest("[data-task-id]");
  const id = el?.getAttribute("data-task-id");
  return id ? id : null;
}

export type RowFileDrop = {
  /** The task whose row lights up as the drop target (null: none). */
  targetId: string | null;
  /** Spread on the container that holds the rows or cards. */
  handlers: Pick<React.HTMLAttributes<HTMLElement>, "onDragOver" | "onDragLeave" | "onDrop">;
};

/**
 * Take file drops on rows. `accepts` says whether a task takes files here
 * (the view's edit access; the server has the last word per task), `onDrop`
 * gets the task and its files.
 */
export function useRowFileDrop({
  accepts,
  onDrop,
}: {
  accepts: (taskId: string) => boolean;
  onDrop: (taskId: string, files: File[]) => void;
}): RowFileDrop {
  const [targetId, setTargetId] = useState<string | null>(null);
  const latest = useRef({ accepts, onDrop });
  latest.current = { accepts, onDrop };

  const onDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    const id = fileDropTaskId(e.target);
    if (id && latest.current.accepts(id)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setTargetId((prev) => (prev === id ? prev : id));
    } else {
      // Between rows, or a task that takes no files: the window guard says "no".
      setTargetId((prev) => (prev === null ? prev : null));
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    // Only leaving the container clears it; moving between rows goes through dragover.
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setTargetId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLElement>) => {
    setTargetId(null);
    if (!dragHasFiles(e.dataTransfer)) return;
    const id = fileDropTaskId(e.target);
    if (!id || !latest.current.accepts(id)) return;
    const files = filesFromDataTransfer(e.dataTransfer);
    if (files.length === 0) return;
    e.preventDefault();
    latest.current.onDrop(id, files);
  }, []);

  return { targetId, handlers: { onDragOver, onDragLeave, onDrop: handleDrop } };
}

/**
 * The List's and the Board's file drops: a task the view can edit takes the
 * files into the device's upload queue (`attachFilesToTask` says how it
 * went); "Open" shows the task, whose strip carries the uploads.
 */
export function useTaskFileDrop({
  canEdit,
  taskOf,
  userId,
  pendingTaskIds,
  onOpen,
}: {
  canEdit: boolean;
  taskOf: (id: string) => Pick<Task, "id" | "workspaceId" | "title"> | undefined;
  userId: string | null | undefined;
  /** Tasks waiting on this device to sync (offline captures): their files wait too. */
  pendingTaskIds?: ReadonlySet<string>;
  onOpen: (taskId: string) => void;
}): RowFileDrop {
  return useRowFileDrop({
    accepts: (id) => canEdit && !!userId && !!taskOf(id),
    onDrop: (id, files) => {
      const task = taskOf(id);
      if (!task || !userId) return;
      void attachFilesToTask({
        workspaceId: task.workspaceId,
        taskId: task.id,
        title: task.title,
        files,
        userId,
        awaitTask: pendingTaskIds?.has(task.id) ?? false,
        onOpen: () => onOpen(task.id),
      });
    },
  });
}
