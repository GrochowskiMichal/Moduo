// Task ↔ `public.tasks` row mapping for the web runtime. Pure, so it can be
// tested without loading runtime.web (which opens a Supabase client on import).
//
// Since TV-D1 an edit sends only the columns it changed (`taskPatchToColumns`):
// a whole-row save carried every other field as this device last saw it, so
// one person's edit could put back a field a teammate had just changed.

import {
  bucketRowSchema,
  requireRow,
  tagLinkRowSchema,
  tagRowSchema,
  taskCompletionRowSchema,
  taskQueueRowSchema,
  taskRowSchema,
  taskTimeAnswerSchema,
  taskTimeTotalsRowSchema,
} from "@contracts/rows";
import { normalizeTaskStatus } from "@contracts/vocabularies";
import type {
  Bucket,
  Tag,
  TagLink,
  Task,
  TaskCompletion,
  TaskQueueEntry,
  TaskTimeResult,
  TaskTimeTotals,
} from "../features/tasks/model";

/**
 * The fields an edit can change. The id, workspace, creator and timestamps
 * belong to the server; the assignee changes through `tasks_op_assign`, and
 * tracked time through `tasks_op_track_time` (TV-D3): an edit never carries the
 * time total, so it can't put back time someone else tracked.
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
 * The fields `tasks_op_update` takes for an edit (TV-D8): the changed columns
 * only. No `updated_at` (the server stamps it); a `deletedAt` deletes, null
 * restores.
 */
export function taskPatchToOpFields(patch: TaskFieldPatch): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    fields[PATCH_COLUMNS[field]] = field === "description" ? (value ?? "") : value;
  }
  return fields;
}

/**
 * What `tasks_op_create` takes for a new task (TV-D8). The id is the client's,
 * so a resent create answers with the task it made instead of making two. An
 * assignee of "" (not chosen) is left out: the server makes it the creator;
 * null is Unassigned. An empty position puts it at the end of its project. The
 * server sets the number, the creator, the timestamps and the time total.
 */
export function taskCreateOpInput(task: Task): Record<string, unknown> {
  const input: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    description: task.description ?? "",
    bucket_id: task.bucketId,
    parent_id: task.parentId ?? null,
    due_date: task.dueDate ?? null,
    scheduled_at: task.scheduledAt ?? null,
    duration_minutes: task.durationMinutes ?? null,
    recurrence: task.recurrence ?? null,
    energy_level: task.energyLevel ?? null,
    priority: task.priority ?? null,
    status: task.status,
    position: task.position ?? "",
  };
  if (task.assigneeId !== "") input.assignee_id = task.assigneeId;
  return input;
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

/** Map `tasks_op_track_time`'s answer (TV-D3). */
export function taskTimeAnswerToModel(raw: unknown): TaskTimeResult {
  const r = requireRow(taskTimeAnswerSchema, raw, "time answer");
  return {
    status: r.status,
    taskId: r.task_id,
    entryId: r.entry_id ?? null,
    totalSeconds: r.total_seconds ?? null,
    mySeconds: r.my_seconds ?? null,
    myWaitingSeconds: r.my_waiting_seconds ?? null,
  };
}

/** Map one row of `tasks_time_totals` (TV-D3). */
export function taskTimeTotalsRowToModel(raw: unknown): TaskTimeTotals {
  const r = requireRow(taskTimeTotalsRowSchema, raw, "time totals");
  return {
    taskId: r.task_id,
    totalSeconds: r.total_seconds,
    mySeconds: r.my_seconds,
    myWaitingSeconds: r.my_waiting_seconds,
    mySecondsSince: r.my_seconds_since ?? null,
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
    number: r.number ?? null,
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
    // A status this build doesn't know shows as its nearest one (TV-D8).
    status: normalizeTaskStatus(r.status),
    committedFor: r.committed_for ?? null,
    commitOrder: r.commit_order ?? null,
    rescheduleCount: r.reschedule_count ?? 0,
    position: r.position ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

/** A task_completions row (TV-D8) → the model. */
export function taskCompletionRowToModel(raw: unknown): TaskCompletion {
  const r = requireRow(taskCompletionRowSchema, raw, "task completion");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    taskId: r.task_id,
    userId: r.user_id ?? null,
    completedAt: r.completed_at,
    cycleKey: r.cycle_key,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

// The other Tasks rows. Here rather than in runtime.web so the live layer
// (TV-D5) can map a Realtime payload exactly like a read does.

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
  };
}

export function tagRowToModel(raw: unknown): Tag {
  const r = requireRow(tagRowSchema, raw, "tag");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id ?? "",
    name: r.name,
    color: r.color ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

export function tagLinkRowToModel(raw: unknown): TagLink {
  const r = requireRow(tagLinkRowSchema, raw, "tag link");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    tagId: r.tag_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    createdAt: r.created_at,
  };
}
