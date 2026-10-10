// Bucket ↔ `public.buckets` row mapping for the web runtime (TV-U6). Pure, so
// it can be tested without loading runtime.web (which opens a Supabase client
// on import).
//
// An edit sends only the columns it changed, like a task's (TV-D1): the old
// whole-row bucket save also carried `deleted_at`, so renaming a bucket from a
// stale list could bring back one a teammate had just deleted.

import { bucketRowSchema, mapKnownRows, requireRow, taskRowSchema } from "@contracts/rows";
import type { Bucket, Task, TasksModuleBundle, TasksTrash } from "../features/tasks/model";
import { taskRowToModel } from "./task-rows";

/** The fields a bucket edit can change. */
export type BucketFieldPatch = Partial<
  Pick<Bucket, "name" | "group" | "position" | "color" | "archivedAt">
>;

const PATCH_COLUMNS = {
  name: "name",
  group: "group_label",
  position: "position",
  color: "color",
  archivedAt: "archived_at",
} as const satisfies Record<keyof Required<BucketFieldPatch>, string>;

const PATCH_FIELDS = Object.keys(PATCH_COLUMNS) as Array<keyof BucketFieldPatch>;

/** The UPDATE payload for a bucket edit: the changed columns plus `updated_at`. */
export function bucketPatchToColumns(
  patch: BucketFieldPatch,
  updatedAt: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    row[PATCH_COLUMNS[field]] = value;
  }
  row.updated_at = updatedAt;
  return row;
}

export function bucketRowToModel(raw: unknown): Bucket {
  const r = requireRow(bucketRowSchema, raw, "bucket");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id ?? "",
    name: r.name,
    isSystem: !!r.is_system,
    group: r.group_label ?? null,
    position: r.position ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
    color: r.color ?? null,
    archivedAt: r.archived_at ?? null,
  };
}

/**
 * Keep archived buckets and their tasks apart from the live ones (TV-U6), so
 * every reader of a Tasks bundle (Home, the bell, contact hubs, capture) hides
 * them without knowing about archiving. A system bucket is never archived.
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
 *  A malformed row is skipped, like every list read. */
export function trashFromRows(bucketRows: unknown, taskRows: unknown): TasksTrash {
  return {
    buckets: mapKnownRows(bucketRows, (raw) => {
      const r = requireRow(bucketRowSchema, raw, "deleted bucket");
      return {
        bucket: bucketRowToModel(raw),
        batchId: r.deleted_batch_id ?? null,
        movedTaskIds: r.trash_moved_task_ids ?? [],
      };
    }),
    tasks: mapKnownRows(taskRows, (raw) => {
      const r = requireRow(taskRowSchema, raw, "deleted task");
      return { task: taskRowToModel(raw), batchId: r.deleted_batch_id ?? null };
    }),
  };
}
