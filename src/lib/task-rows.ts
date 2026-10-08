// Task ↔ `public.tasks` row mapping for the web runtime. Pure, so it can be
// tested without loading runtime.web (which opens a Supabase client on import).
//
// Since TV-D1 an edit sends only the columns it changed (`taskPatchToColumns`):
// a whole-row save carried every other field as this device last saw it, so
// one person's edit could put back a field a teammate had just changed.

import { requireRow, taskQueueRowSchema, taskRowSchema } from "@contracts/rows";
import type { Task, TaskQueueEntry } from "../features/tasks/model";

/**
 * The fields an edit can change. The id, workspace, creator and timestamps
 * belong to the server; the assignee changes through `tasks_op_assign`.
 */
export type TaskFieldPatch = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "bucketId"
    | "parentId"
    | "dueDate"
    | "scheduledAt"
    | "durationMinutes"
    | "timeSpentSeconds"
    | "recurrence"
    | "energyLevel"
    | "priority"
    | "status"
    | "committedFor"
    | "commitOrder"
    | "rescheduleCount"
    | "position"
    | "deletedAt"
  >
>;

const PATCH_COLUMNS = {
  title: "title",
  description: "description",
  bucketId: "bucket_id",
  parentId: "parent_id",
  dueDate: "due_date",
  scheduledAt: "scheduled_at",
  durationMinutes: "duration_minutes",
  timeSpentSeconds: "time_spent_seconds",
  recurrence: "recurrence",
  energyLevel: "energy_level",
  priority: "priority",
  status: "status",
  committedFor: "committed_for",
  commitOrder: "commit_order",
  rescheduleCount: "reschedule_count",
  position: "position",
  deletedAt: "deleted_at",
} as const satisfies Record<keyof Required<TaskFieldPatch>, string>;

const PATCH_FIELDS = Object.keys(PATCH_COLUMNS) as Array<keyof TaskFieldPatch>;

/** Keep only the fields an edit can send; everything else in a patch is dropped. */
export function editableTaskFields(patch: Partial<Task>): TaskFieldPatch {
  const out: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS) {
    if (patch[field] !== undefined) out[field] = patch[field];
  }
  return out as TaskFieldPatch;
}

/** The UPDATE payload for an edit: the changed columns plus `updated_at`. */
export function taskPatchToColumns(
  patch: TaskFieldPatch,
  updatedAt: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    // description is NOT NULL in the table; an emptied one is "".
    row[PATCH_COLUMNS[field]] = field === "description" ? (value ?? "") : value;
  }
  row.updated_at = updatedAt;
  return row;
}

/**
 * The INSERT payload for a new task. No `owner_id`: the server records whoever
 * creates the task as its creator. The assignee is always sent, so an explicit
 * Unassigned (null) is told apart from a build that doesn't know the column;
 * "" (not chosen) means the creator.
 */
export function taskCreateRow(task: Task, actorId: string | null): Record<string, unknown> {
  return {
    id: task.id,
    workspace_id: task.workspaceId,
    assignee_id: task.assigneeId === "" ? actorId : task.assigneeId,
    bucket_id: task.bucketId,
    parent_id: task.parentId ?? null,
    title: task.title,
    description: task.description ?? "",
    due_date: task.dueDate ?? null,
    scheduled_at: task.scheduledAt ?? null,
    duration_minutes: task.durationMinutes ?? null,
    time_spent_seconds: task.timeSpentSeconds ?? 0,
    recurrence: task.recurrence ?? null,
    energy_level: task.energyLevel ?? null,
    priority: task.priority ?? null,
    status: task.status,
    committed_for: task.committedFor ?? null,
    commit_order: task.commitOrder ?? null,
    reschedule_count: task.rescheduleCount ?? 0,
    position: task.position ?? "",
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    deleted_at: task.deletedAt ?? null,
  };
}

/**
 * The same INSERT for a database the TV-D1 migration hasn't reached yet, where
 * owner_id still held the assignee (the merge-before-apply window). Remove in
 * TV-D7 together with the database's legacy shim.
 */
export function taskCreateRowLegacy(task: Task, actorId: string | null): Record<string, unknown> {
  const { assignee_id: assignee, ...rest } = taskCreateRow(task, actorId);
  return { ...rest, owner_id: assignee };
}

/** PostgREST's answer when a column the payload names doesn't exist (yet). */
export function isMissingColumnError(
  error: { code?: string; message?: string } | null | undefined,
  column: string,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    (error.code === "PGRST204" || error.code === "42703") &&
    new RegExp(`\\b${column}\\b`).test(message)
  );
}

/** PostgREST's answer when an RPC doesn't exist (yet). */
export function isMissingFunctionError(
  error: { code?: string; message?: string } | null | undefined,
  fn: string,
): boolean {
  if (!error) return false;
  return (
    (error.code === "PGRST202" || error.code === "42883") && (error.message ?? "").includes(fn)
  );
}

/** PostgREST's answer when a table doesn't exist (yet). */
export function isMissingTableError(
  error: { code?: string; message?: string } | null | undefined,
  table: string,
): boolean {
  if (!error) return false;
  return (
    (error.code === "PGRST205" || error.code === "42P01") && (error.message ?? "").includes(table)
  );
}

/** A `task_queue` row (TV-D2) → the model. */
export function taskQueueRowToModel(raw: unknown): TaskQueueEntry {
  const r = requireRow(taskQueueRowSchema, raw, "task queue entry");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    taskId: r.task_id,
    position: r.position,
    queuedAt: r.queued_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Queue rows in line-up order: by person, then by position compared bytewise
 * (the database column is `COLLATE "C"`), then by id.
 */
export function sortQueueEntries(entries: TaskQueueEntry[]): TaskQueueEntry[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return entries
    .slice()
    .sort((a, b) => cmp(a.userId, b.userId) || cmp(a.position, b.position) || cmp(a.id, b.id));
}

export function taskRowToModel(raw: unknown): Task {
  const r = requireRow(taskRowSchema, raw, "task");
  // Before the TV-D1 migration the row has no assignee_id, and owner_id was
  // the assignee: show it as that, and don't claim a creator.
  const migrated = r.assignee_id !== undefined;
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    creatorId: r.owner_id ?? "",
    creatorUnknown: migrated ? (r.creator_unknown ?? false) : true,
    assigneeId: migrated ? (r.assignee_id ?? null) : (r.owner_id ?? null),
    bucketId: r.bucket_id,
    parentId: r.parent_id ?? null,
    title: r.title ?? "",
    description: r.description ?? "",
    dueDate: r.due_date ?? null,
    scheduledAt: r.scheduled_at ?? null,
    durationMinutes: r.duration_minutes ?? null,
    timeSpentSeconds: r.time_spent_seconds ?? 0,
    recurrence: (r.recurrence as Task["recurrence"]) ?? null,
    energyLevel: r.energy_level ?? null,
    priority: r.priority ?? null,
    status: r.status ?? "todo",
    committedFor: r.committed_for ?? null,
    commitOrder: r.commit_order ?? null,
    rescheduleCount: r.reschedule_count ?? 0,
    position: r.position ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}
