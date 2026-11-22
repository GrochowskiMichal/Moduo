// A reference card's Complete and Reopen outside the Tasks page (call 87,
// TV-POLISH): both go through the workspace's shared store, like every other
// status write, so they land in the order they were made. A Reopen made while
// the card's own check-off is still on its way waits on the device behind it
// (the store's `sendStatus`: `statusMustWait` → the outbox), never live past
// it (MOD-561, MOD-587, HV-15). Done also finishes the task's open subtasks,
// with one Undo; reopening is the task alone. A task the store doesn't hold
// takes the plain op, still in its turn (`sendStatusInTurn`); only without a
// store at all does it go straight out.

import { legacyTaskStatus, taskStatusWord } from "@contracts/vocabularies";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { findWorkspaceStore } from "../../../lib/sync/store";
import { finishOutsideTasks } from "../../tasks/check-off";
import { statusesForBucketOf } from "../../tasks/derived";
import type { Task } from "../../tasks/model";
import { queueEntriesOf } from "../../tasks/queue";
import { optimisticStatus } from "../../tasks/statuses";

type StoreLike = Pick<
  NonNullable<ReturnType<typeof findWorkspaceStore>>,
  "sendStatus" | "sendStatusInTurn" | "queueOp" | "getSnapshot"
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
  const category = done ? "done" : "todo";
  const plainOp = () =>
    runtime.tasks.opSetStatus({ workspaceId, taskId, status: taskStatusWord(category) });
  const store = findStore(runtime, workspaceId);
  if (!store) {
    await plainOp();
    return;
  }
  const snap = store.getSnapshot();
  const task = snap.bundle.tasks.find((t) => t.id === taskId && !t.deletedAt);
  if (!task) {
    // No copy to show it in: the plain op, after anything older for it.
    await store.sendStatusInTurn(taskId, plainOp);
    return;
  }
  if (done) {
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
  // Reopen: the store's status write, shown at once (the project's first To
  // do status), behind the check-off if that is still on its way.
  const set = statusesForBucketOf(snap.bundle.statuses ?? [], snap.bundle.buckets, task.bucketId);
  await store.sendStatus({
    taskId,
    status: taskStatusWord(category),
    fields: {
      ...optimisticStatus(task, { category }, set),
      status: legacyTaskStatus(category),
    } as Partial<Task>,
  });
}
