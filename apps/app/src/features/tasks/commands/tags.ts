// Tags on tasks, through the shared workspace tag store (TV-T1).

import { toast } from "sonner";
import {
  createOrAttachByName,
  deleteTag as deleteWorkspaceTag,
  recolorTag,
  toggleTag,
} from "../../tags/store";
import type { Task } from "../model";
import { isTempId, type Shared, STILL_SAVING } from "./shared";

export function createTagOps(shared: Shared) {
  const { tagContext } = shared;

  /** Attach or detach an existing tag on a task. */
  const toggleTaskTag = (taskId: string, tagId: string) => {
    const ctx = tagContext();
    if (!ctx) return;
    if (isTempId(taskId)) {
      toast.error(STILL_SAVING);
      return;
    }
    toggleTag(ctx, { entityType: "task", entityId: taskId }, tagId);
  };

  /**
   * Attach the tag with this name, or create it (auto-coloured) and attach it,
   * in one step. `taskId` can be the promise `createTask` returns, so a task
   * still being created can be tagged (capture); a tag made for a task that
   * then fails to save is removed again.
   */
  const createTagForTask = (name: string, taskId: string | PromiseLike<Task | null>) => {
    const ctx = tagContext();
    if (!ctx) return;
    if (typeof taskId === "string" && isTempId(taskId)) {
      toast.error(STILL_SAVING);
      return;
    }
    createOrAttachByName(ctx, name, {
      entityType: "task",
      entityId:
        typeof taskId === "string" ? taskId : Promise.resolve(taskId).then((t) => t?.id ?? null),
    });
  };

  /** Recolor a workspace tag (label-palette hue name). */
  const setTagColor = (tagId: string, color: string) => {
    const ctx = tagContext();
    if (ctx) recolorTag(ctx, tagId, color);
  };

  /** Delete a workspace tag everywhere, with Undo (committed when the toast closes). */
  const deleteTag = (tagId: string) => {
    const ctx = tagContext();
    if (ctx) deleteWorkspaceTag(ctx, tagId);
  };

  return { toggleTaskTag, createTagForTask, setTagColor, deleteTag };
}
