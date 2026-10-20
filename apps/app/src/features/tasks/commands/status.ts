// A task's status (TV-D9) and the statuses themselves: set one, check off,
// finish the open subtasks with it (call 87), archive; and the workspace's
// and projects' status sets.

import {
  isClosedTask,
  legacyTaskStatus,
  type TaskStatusCategory,
  taskCategoryOf,
} from "@contracts/vocabularies";
import { toast } from "sonner";
import { undoToast } from "../../../lib/undo-toast";
import { subtasksToFinish } from "../home";
import type { ProjectStatus, Task } from "../model";
import { CATEGORY_LABELS, type StatusTarget } from "../statuses";
import type { Finished, TaskCommandsContext, TaskPeers } from "./context";
import { type Shared, statusBack } from "./shared";

export function createStatusOps(ctx: TaskCommandsContext, shared: Shared, peers: TaskPeers) {
  const { store, runtime, workspaceId, data, env } = ctx;
  const { editBlocked, failed, statusesForBucket } = shared;

  /**
   * Call 87: finishing a task finishes its open subtasks too. Sends each
   * subtask's check-off and answers how many it finished, with the Undo that
   * puts them back (each only while it's still done: a later change wins).
   * A subtask has none of its own; a repeating parent keeps its subtasks
   * open (TV-D12 resets them per cycle). Null when there's nothing to finish.
   */
  const finishOpenSubtasks = (before: Task): Finished | null => {
    const open = subtasksToFinish(before, data().allTasks);
    if (open.length === 0) return null;
    for (const subtask of open) peers.patchTask(subtask.id, { status: "done" });
    return {
      count: open.length,
      undo: () => {
        const tasks = data().allTasks;
        for (const subtask of open) {
          const now = tasks.find((t) => t.id === subtask.id);
          if (now && taskCategoryOf(now) === "done") {
            peers.patchTask(subtask.id, statusBack(subtask));
          }
        }
      },
    };
  };

  /** "Done · also 2 subtasks" with one Undo for the parent and its subtasks. */
  const sayFinishedWith = (before: Task, finished: Finished) => {
    undoToast(`Done · also ${finished.count === 1 ? "1 subtask" : `${finished.count} subtasks`}`, {
      onUndo: () => {
        finished.undo();
        const now = data().allTasks.find((t) => t.id === before.id);
        if (now && taskCategoryOf(now) === "done") peers.patchTask(before.id, statusBack(before));
      },
    });
  };

  /**
   * Set a task's status (TV-D9): one of its project's statuses by id, or a
   * category (the project's first status of it, unless the task is already in
   * that category). The repeat pointer and the queue follow as for any status
   * change.
   */
  const setTaskStatus = (id: string, target: StatusTarget) => {
    const existing = data().allTasks.find((t) => t.id === id);
    if (!existing) return;
    const canEdit = env().canEdit;
    const toCategory =
      "statusId" in target
        ? statusesForBucket(existing.bucketId).find((x) => x.id === target.statusId)?.category
        : target.category;
    if ("statusId" in target) {
      const s = statusesForBucket(existing.bucketId).find((x) => x.id === target.statusId);
      if (!s || s.id === existing.statusId) return;
      peers.patchTask(id, {
        statusId: s.id,
        statusCategory: s.category,
        status: legacyTaskStatus(s.category),
      });
    } else {
      if (taskCategoryOf(existing) === target.category) return;
      peers.patchTask(id, {
        statusCategory: target.category,
        status: legacyTaskStatus(target.category),
      });
    }
    // Call 87: into Done from an open status finishes the open subtasks.
    if (toCategory === "done" && canEdit && !isClosedTask(existing)) {
      const finished = finishOpenSubtasks(existing);
      if (finished) sayFinishedWith(existing, finished);
    }
  };

  const toggleDone = (task: Task) => {
    const finishing = task.status !== "done";
    const canEdit = env().canEdit;
    peers.patchTask(task.id, { status: finishing ? "done" : "todo" });
    if (!finishing || !canEdit) return;
    const finished = finishOpenSubtasks(task);
    if (finished) sayFinishedWith(task, finished);
  };

  const markDone = (id: string) => {
    const before = data().allTasks.find((t) => t.id === id);
    const canEdit = env().canEdit;
    peers.patchTask(id, { status: "done" });
    if (!before || !canEdit || taskCategoryOf(before) === "done") return;
    const finished = finishOpenSubtasks(before);
    if (finished) sayFinishedWith(before, finished);
  };

  /** Archive a task — terminal, removes it from open lists (used by drift triage). */
  const archiveTask = (id: string) => peers.patchTask(id, { status: "archived" });

  // ── editing statuses (TV-D9) ─────────────────────────────────────────────────
  /** Run a status op and take the set it answers (project, or the default when
   *  `projectId` is null). Errors show and nothing changes. */
  const runStatusOp = async (
    projectId: string | null,
    op: () => Promise<ProjectStatus[]>,
  ): Promise<boolean> => {
    if (editBlocked() || !store) return false;
    try {
      const set = await op();
      // The answer is the whole set: what's not in it is gone.
      const kept = new Set(set.map((s) => s.id));
      const gone = (store.getSnapshot().bundle.statuses ?? [])
        .filter((s) => s.projectId === projectId && !kept.has(s.id))
        .map((s) => s.id);
      store.answer({ statuses: set });
      store.forget("statuses", gone);
      return true;
    } catch (e) {
      failed(e, "Something went wrong.");
      return false;
    }
  };

  const createStatus = (projectId: string | null, category: TaskStatusCategory, name: string) =>
    runStatusOp(projectId, () =>
      runtime!.tasks.createStatus({ workspaceId: workspaceId!, projectId, category, name }),
    );

  const updateStatus = (
    status: ProjectStatus,
    patch: { name?: string; hidden?: boolean; after?: string | null },
  ) =>
    runStatusOp(status.projectId, () =>
      runtime!.tasks.updateStatus({ workspaceId: workspaceId!, statusId: status.id, patch }),
    );

  /** Delete a status: its tasks move to the first other status of its
   *  category, and a toast says how many. */
  const deleteStatus = async (status: ProjectStatus): Promise<boolean> => {
    if (editBlocked() || !runtime || !workspaceId || !store) return false;
    try {
      const answer = await runtime.tasks.deleteStatus({ workspaceId, statusId: status.id });
      store.forget("statuses", [status.id]);
      // The server moved its tasks; their rows follow live. Show it now.
      if (answer.movedTo) {
        for (const t of data().allTasks) {
          if (t.statusId === status.id) {
            store.patchCopy("tasks", t.id, { statusId: answer.movedTo });
          }
        }
      }
      const to = answer.movedToName ?? CATEGORY_LABELS[status.category];
      toast(
        answer.moved > 0
          ? `Deleted “${status.name}” · ${answer.moved === 1 ? "1 task" : `${answer.moved} tasks`} moved to ${to}`
          : `Deleted “${status.name}”`,
      );
      return true;
    } catch (e) {
      failed(e, "Something went wrong.");
      return false;
    }
  };

  return {
    finishOpenSubtasks,
    sayFinishedWith,
    setTaskStatus,
    toggleDone,
    markDone,
    archiveTask,
    createStatus,
    updateStatus,
    deleteStatus,
  };
}
