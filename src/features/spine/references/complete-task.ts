// A reference card's Complete outside the Tasks page (call 87, TV-POLISH):
// Done goes through the workspace's shared store, like every other check-off,
// so the task's open subtasks finish too, with one Undo. Reopening is the
// task alone. Without the store, or the task in it, the plain op runs (then
// there's no copy to know its subtasks from).

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { findWorkspaceStore } from "../../../lib/sync/store";
import { finishOutsideTasks } from "../../tasks/check-off";
import { queueEntriesOf } from "../../tasks/queue";

type StoreLike = Pick<
  NonNullable<ReturnType<typeof findWorkspaceStore>>,
  "sendStatus" | "queueOp" | "getSnapshot"
>;

export async function completeReferencedTask({
  runtime,
  workspaceId,
  userId,
  taskId,
  done,
  findStore = findWorkspaceStore,
}: {
  runtime: ModuoRuntime;
  workspaceId: string;
  userId: string | null;
  taskId: string;
  done: boolean;
  /** The workspace's shared store (a test hands in its own). */
  findStore?: (runtime: ModuoRuntime, workspaceId: string) => StoreLike | null;
}): Promise<void> {
  const store = done ? findStore(runtime, workspaceId) : null;
  const snap = store?.getSnapshot() ?? null;
  const task = snap?.bundle.tasks.find((t) => t.id === taskId && !t.deletedAt);
  if (store && snap && task) {
    await finishOutsideTasks({
      store,
      tasks: runtime.tasks,
      workspaceId,
      task,
      copy: snap.bundle.tasks,
      lineupBefore: queueEntriesOf(snap.queue, userId).map((e) => e.taskId),
      sayLone: false,
    });
    return;
  }
  await runtime.tasks.opSetStatus({ workspaceId, taskId, status: done ? "done" : "todo" });
}
