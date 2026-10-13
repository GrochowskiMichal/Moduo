// A check-off from outside the Tasks page (TV-H1): Home's Tasks widget has no
// module mounted, so it finishes a task through the workspace's shared store
// with call 87's rule (`subtasksToFinish`, the one the module uses): the open
// subtasks finish too, and one Undo puts each back to the status it had, only
// while it's still done (a later change wins). Every write is the store's
// status write, so it shows at once everywhere and waits on the device
// offline, like any check-off.

import { legacyTaskStatus, taskCategoryOf, taskStatusWord } from "@contracts/vocabularies";

import type { ModuoRuntime } from "../../lib/runtime.types";
import type { WorkspaceStore } from "../../lib/sync/store";
import { subtasksToFinish } from "./home";
import type { Task } from "./model";

type StatusSender = Pick<WorkspaceStore, "sendStatus">;

/** What finishing writes: the Done category (the server picks the project's status). */
function doneWrite(task: Task) {
  return {
    taskId: task.id,
    status: taskStatusWord("done"),
    fields: { status: legacyTaskStatus("done"), statusCategory: "done" } as Partial<Task>,
  };
}

/** What an Undo writes: the task's own status back (by id when it had one). */
export function statusBackWrite(before: Task) {
  const category = taskCategoryOf(before);
  return {
    taskId: before.id,
    status: before.statusId ?? taskStatusWord(category),
    fields: (before.statusId
      ? { statusId: before.statusId, statusCategory: category, status: legacyTaskStatus(category) }
      : { statusCategory: category, status: legacyTaskStatus(category) }) as Partial<Task>,
  };
}

export type CheckOff = {
  /** The subtasks finished along with it (as they were before). */
  subtasks: Task[];
  /** How many of those the server refused (one you can't edit, say). */
  refused: number;
};

/**
 * Finish a task and its open subtasks. Throws when the task itself is
 * refused (its own fields go back); a refused subtask is only counted.
 */
export async function checkOffWithSubtasks(
  store: StatusSender,
  task: Task,
  tasks: readonly Task[],
): Promise<CheckOff> {
  const subtasks = subtasksToFinish(task, tasks);
  await store.sendStatus(doneWrite(task));
  const results = await Promise.allSettled(subtasks.map((s) => store.sendStatus(doneWrite(s))));
  const refused = results.filter((r) => r.status === "rejected").length;
  return {
    subtasks: subtasks.filter((_, i) => results[i]?.status === "fulfilled"),
    refused,
  };
}

/**
 * Undo a check-off: each task that is still done goes back to the status it
 * had. `current` reads a task as the copy has it now. Resolves to the ids put
 * back and how many couldn't be.
 */
export async function undoCheckOff(
  store: StatusSender,
  before: readonly Task[],
  current: (id: string) => Task | undefined,
): Promise<{ restored: string[]; failed: number }> {
  const back = before.filter((b) => {
    const now = current(b.id);
    return !!now && !now.deletedAt && taskCategoryOf(now) === "done";
  });
  const results = await Promise.allSettled(back.map((b) => store.sendStatus(statusBackWrite(b))));
  return {
    restored: back.filter((_, i) => results[i]?.status === "fulfilled").map((b) => b.id),
    failed: results.filter((r) => r.status === "rejected").length,
  };
}

/**
 * Where a task goes back into my Focus line-up after an Undo (finishing took
 * it out on the server): right after the nearest task before it in the
 * line-up as it was that is still lined up now; null = the top.
 */
export function focusAnchor(
  taskId: string,
  lineupBefore: readonly string[],
  lineupNow: ReadonlySet<string>,
): string | null {
  const at = lineupBefore.indexOf(taskId);
  for (let i = at - 1; i >= 0; i -= 1) {
    const id = lineupBefore[i];
    if (id && lineupNow.has(id)) return id;
  }
  return null;
}

type QueueRuntime = {
  opQueueAdd: ModuoRuntime["tasks"]["opQueueAdd"];
  opQueueReorder: ModuoRuntime["tasks"]["opQueueReorder"];
};

/**
 * Put a task back in my Focus line-up where it was (the module's drop Undo
 * does the same, `restoreQueuePlace`), through the store's line-up so every
 * surface shows it. The place is worked out from the server's answer to the
 * add (my line-up as it is now), never from the copy, which may still show
 * the row the check-off took out.
 */
export function restoreFocusPlace(
  store: Pick<WorkspaceStore, "queueOp">,
  tasks: QueueRuntime,
  workspaceId: string,
  taskId: string,
  lineupBefore: readonly string[],
): Promise<unknown> {
  return store.queueOp(null, async () => {
    const mine = await tasks.opQueueAdd({ workspaceId, taskId, at: "end" });
    const others = new Set(mine.map((e) => e.taskId).filter((id) => id !== taskId));
    const afterTaskId = focusAnchor(taskId, lineupBefore, others);
    return tasks.opQueueReorder({ workspaceId, taskId, afterTaskId });
  });
}
