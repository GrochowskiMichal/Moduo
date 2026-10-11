// Project (bucket) helpers for the web runtime's Tasks reads (TV-U6). Pure, so
// they can be tested without loading runtime.web (which opens a Supabase
// client on import). The row mapper itself is `bucketRowToModel` in
// task-rows.ts, shared with the live layer.

import { bucketRowSchema, mapKnownRows, requireRow, taskRowSchema } from "@contracts/rows";
import type { Bucket, Task, TasksModuleBundle, TasksTrash } from "../features/tasks/model";
import { bucketRowToModel, taskRowToModel } from "./task-rows";

/**
 * Keep archived projects and their tasks apart from the live ones (TV-U6), so
 * every other reader of a Tasks bundle (Home, the Calendar, contact hubs,
 * capture) hides them without knowing about archiving. The shared store
 * (`sync/store.ts`) splits its bundle with it; the Tasks module joins them
 * back. An Inbox is never archived. No archived project: the same arrays.
 */
export function splitArchived(
  buckets: Bucket[],
  tasks: Task[],
): Pick<TasksModuleBundle, "buckets" | "tasks" | "archivedBuckets" | "archivedTasks"> {
  const archivedIds = new Set(buckets.filter((b) => b.archivedAt && !b.isSystem).map((b) => b.id));
  if (archivedIds.size === 0) {
    return { buckets, tasks, archivedBuckets: [], archivedTasks: [] };
  }
  return {
    buckets: buckets.filter((b) => !archivedIds.has(b.id)),
    tasks: tasks.filter((t) => !archivedIds.has(t.bucketId)),
    archivedBuckets: buckets.filter((b) => archivedIds.has(b.id)),
    archivedTasks: tasks.filter((t) => archivedIds.has(t.bucketId)),
  };
}

/** Recently deleted from the trash rows a workspace read returned (TV-U6).
 *  A malformed row is skipped, like every list read; an Inbox never shows. */
export function trashFromRows(bucketRows: unknown, taskRows: unknown): TasksTrash {
  return {
    buckets: mapKnownRows(bucketRows, (raw) => {
      const r = requireRow(bucketRowSchema, raw, "deleted project");
      return {
        bucket: bucketRowToModel(raw),
        batchId: r.deleted_batch_id ?? null,
        movedTaskIds: r.trash_moved_task_ids ?? [],
      };
    }).filter((b) => !b.bucket.isSystem),
    tasks: mapKnownRows(taskRows, (raw) => {
      const r = requireRow(taskRowSchema, raw, "deleted task");
      return { task: taskRowToModel(raw), batchId: r.deleted_batch_id ?? null };
    }),
  };
}
