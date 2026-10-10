// A captured task through the shared store (TV-D11a): ⌘⇧K, Home's quick
// capture and Chat's "make a task". It lands at the end of your Inbox as the
// store holds it (no read of its own), shows at once on every surface, and
// offline it waits on this device under its own id, sent once you're back.

import { endPosition, makeTask, type NewTaskFields } from "../../features/tasks/helpers";
import type { Task } from "../../features/tasks/model";
import type { WorkspaceStore } from "./store";

export type CapturedFields = Pick<
  NewTaskFields,
  "title" | "scheduledAt" | "dueDate" | "recurrence"
>;

export async function captureTaskToStore(
  store: WorkspaceStore,
  fields: CapturedFields,
): Promise<{ saved: Task | null; queued: boolean }> {
  await store.whenLoaded();
  if (store.isDisposed()) throw new Error("Signed out.");
  const { bundle } = store.getSnapshot();
  const systems = bundle.buckets.filter((b) => b.isSystem && !b.deletedAt);
  let inbox = systems.find((b) => b.ownerId === store.userId) ?? systems[0] ?? null;
  // A workspace whose Inbox doesn't exist yet: make it (needs the network).
  inbox ??= await store.runtime.tasks.seedInbox(store.workspaceId);
  const inInbox = bundle.tasks.filter((t) => t.bucketId === inbox.id && !t.deletedAt);
  const task = makeTask({
    ...fields,
    workspaceId: store.workspaceId,
    bucketId: inbox.id,
    position: endPosition(inInbox),
  });
  task.id = crypto.randomUUID();
  task.creatorId = store.userId;
  // An assignee left unchosen is the creator (as before TV-D1).
  if (task.assigneeId === "") task.assigneeId = store.userId;
  return store.sendCreate(task);
}
