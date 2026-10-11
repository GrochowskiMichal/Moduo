// Task ↔ `public.tasks` row mapping for the web runtime. Pure, so it can be
// tested without loading runtime.web (which opens a Supabase client on import).
//
// Since TV-D1 an edit sends only the columns it changed (`taskPatchToColumns`):
// a whole-row save carried every other field as this device last saw it, so
// one person's edit could put back a field a teammate had just changed.

import {
  areaRowSchema,
  bucketRowSchema,
  projectStatusRowSchema,
  requireRow,
  sectionRowSchema,
  tagLinkRowSchema,
  tagRowSchema,
  taskCompletionRowSchema,
  taskQueueRowSchema,
  taskReminderRowSchema,
  taskRowSchema,
  taskSessionRowSchema,
  taskTimeAnswerSchema,
  taskTimeTotalsRowSchema,
  taskWaitingRowSchema,
  teamMemberRowSchema,
  teamRowSchema,
} from "@contracts/rows";
import {
  legacyTaskStatus,
  normalizeProjectState,
  normalizeTaskReminderKind,
  normalizeTaskStatus,
  normalizeTaskStatusCategory,
  normalizeTaskWaitingKind,
  type TaskStatusCategory,
  taskStatusWord,
} from "@contracts/vocabularies";
import type {
  Area,
  Bucket,
  ProjectStatus,
  Section,
  Tag,
  TagLink,
  Task,
  TaskCompletion,
  TaskQueueEntry,
  TaskReminder,
  TaskSession,
  TaskTimeResult,
  TaskTimeTotals,
  TaskWaitingEntry,
  Team,
  TeamMember,
} from "../features/tasks/model";
import type { CommentMark } from "./sync/types";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The device-local calendar day of an instant, YYYY-MM-DD (null if unreadable). */
export function localDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * A due date (YYYY-MM-DD) as the instant the app's date readers expect: its
 * local midnight on this device. So every viewer sees the same date (TV-D9),
 * whatever their zone.
 */
export function dueOnToLocalInstant(day: string | null | undefined): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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
    | "dueTime"
    | "scheduledAt"
    | "durationMinutes"
    | "recurrence"
    | "energyLevel"
    | "priority"
    | "status"
    | "statusId"
    | "statusCategory"
    | "committedFor"
    | "commitOrder"
    | "rescheduleCount"
    | "position"
    | "deletedAt"
    | "sectionId"
    | "teamId"
    | "estimateMinutes"
  >
>;

/**
 * Raw-write columns (the fallback for a database before TV-D8's ops). A
 * status id or category goes as the legacy status there.
 */
const PATCH_COLUMNS = {
  title: "title",
  description: "description",
  bucketId: "bucket_id",
  parentId: "parent_id",
  dueDate: "due_date",
  dueTime: "due_time",
  scheduledAt: "scheduled_at",
  durationMinutes: "duration_minutes",
  recurrence: "recurrence",
  energyLevel: "energy_level",
  priority: "priority",
  status: "status",
  statusId: "status_id",
  statusCategory: "status",
  committedFor: "committed_for",
  commitOrder: "commit_order",
  rescheduleCount: "reschedule_count",
  position: "position",
  deletedAt: "deleted_at",
  sectionId: "section_id",
  teamId: "team_id",
  estimateMinutes: "estimate_minutes",
} as const satisfies Record<keyof Required<TaskFieldPatch>, string>;

/** The fields only a database since TV-D10 has. */
const TV_D10_FIELDS = new Set<keyof TaskFieldPatch>(["sectionId", "teamId", "estimateMinutes"]);

const PATCH_FIELDS = Object.keys(PATCH_COLUMNS) as Array<keyof TaskFieldPatch>;

/** Keep only the fields an edit can send; everything else in a patch is dropped. */
export function editableTaskFields(patch: Partial<Task>): TaskFieldPatch {
  const out: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS) {
    if (patch[field] !== undefined) out[field] = patch[field];
  }
  return out as TaskFieldPatch;
}

/**
 * The UPDATE payload for an edit: the changed columns plus `updated_at`. Only
 * for a database before TV-D8's ops, which has no status ids or due times: a
 * category goes as its legacy status, a status id and a due time are dropped.
 */
export function taskPatchToColumns(
  patch: TaskFieldPatch,
  updatedAt: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS) {
    const value = patch[field];
    if (value === undefined || field === "statusId" || field === "dueTime") continue;
    if (TV_D10_FIELDS.has(field)) {
      // The estimate was duration_minutes then; sections and teams didn't exist.
      if (field === "estimateMinutes" && patch.durationMinutes === undefined) {
        row.duration_minutes = value;
      }
      continue;
    }
    if (field === "statusCategory") {
      row.status = legacyTaskStatus(normalizeTaskStatusCategory(value));
      continue;
    }
    // description is NOT NULL in the table; an emptied one is "".
    row[PATCH_COLUMNS[field]] = field === "description" ? (value ?? "") : value;
  }
  row.updated_at = updatedAt;
  return row;
}

/**
 * The fields `tasks_op_update` takes for an edit (TV-D8): the changed columns
 * only. No `updated_at` (the server stamps it); a `deletedAt` deletes, null
 * restores. Since TV-D9 a due date goes as `due_on`, the day it stands for on
 * this device, so every viewer reads the same date; a status goes by id
 * (`statusId`) or by category word (`statusCategory`, `status`).
 */
export function taskPatchToOpFields(patch: TaskFieldPatch): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if (field === "dueDate") {
      fields.due_on = localDayOf(value as string | null);
      continue;
    }
    if (field === "statusCategory") {
      // The id wins when both are given (the server reads status_id first).
      // The legacy word, so a database before TV-D9 takes it too.
      if (patch.statusId == null) fields.status = taskStatusWord(value as TaskStatusCategory);
      continue;
    }
    if (field === "status" && (patch.statusId != null || patch.statusCategory != null)) continue;
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
    // TV-D9: the due date is a date (the day it stands for on this device).
    due_on: task.dueOn ?? localDayOf(task.dueDate),
    scheduled_at: task.scheduledAt ?? null,
    duration_minutes: task.durationMinutes ?? null,
    recurrence: task.recurrence ?? null,
    energy_level: task.energyLevel ?? null,
    priority: task.priority ?? null,
    // A project status by id, else its category (Backlog included), else the
    // legacy value.
    status: task.statusCategory ? taskStatusWord(task.statusCategory) : task.status,
    position: task.position ?? "",
  };
  if (task.statusId) input.status_id = task.statusId;
  if (task.dueTime) input.due_time = task.dueTime;
  if (task.assigneeId !== "") input.assignee_id = task.assigneeId;
  // TV-D10: only when set, so a create needs no fallback on an older database.
  if (task.sectionId) input.section_id = task.sectionId;
  if (task.teamId) input.team_id = task.teamId;
  if (task.estimateMinutes != null) input.estimate_minutes = task.estimateMinutes;
  if (task.importedFrom) input.imported_from = task.importedFrom;
  return input;
}

/**
 * A create or edit for a database before TV-D10: its ops refuse
 * `section_id`, `team_id`, `estimate_minutes` and `imported_from`. The
 * estimate goes back to duration_minutes (which held it); the rest is
 * dropped, as that database has nowhere to keep it. Remove in TV-D7.
 */
export function withoutTvD10Fields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fields };
  if ("estimate_minutes" in out && !("duration_minutes" in out)) {
    out.duration_minutes = out.estimate_minutes;
  }
  delete out.estimate_minutes;
  delete out.section_id;
  delete out.team_id;
  delete out.imported_from;
  return out;
}

/**
 * Send a task op, and when the database is older than the fields sent (the
 * op answers 'Tasks have no field "…"'), send it again without TV-D10's
 * fields, then without TV-D9's too. Remove in TV-D7.
 */
export async function withFieldFallback<T extends { error: { message?: string } | null }>(
  fields: Record<string, unknown>,
  send: (fields: Record<string, unknown>) => PromiseLike<T>,
): Promise<T> {
  let res = await send(fields);
  if (isMissingTvD10FieldError(res.error)) {
    res = await send(withoutTvD10Fields(fields));
  }
  if (isMissingTvD9FieldError(res.error)) {
    res = await send(withoutTvD9Fields(withoutTvD10Fields(fields)));
  }
  return res;
}

/** The op's answer when it doesn't know a TV-D10 field (a database before it). */
export function isMissingTvD10FieldError(error: { message?: string } | null | undefined): boolean {
  return /no field "(section_id|team_id|estimate_minutes|imported_from)"/.test(
    error?.message ?? "",
  );
}

/**
 * A create or edit for a database before TV-D9 (the merge-before-apply
 * window): the op there refuses `due_on`, `due_time` and `status_id`, so the
 * date goes back to the old instant and the status to its legacy value.
 * Remove in TV-D7.
 */
export function withoutTvD9Fields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fields };
  if ("due_on" in out) {
    out.due_date = dueOnToLocalInstant(out.due_on as string | null);
    delete out.due_on;
  }
  delete out.due_time;
  delete out.status_id;
  if (typeof out.status === "string") {
    out.status = legacyTaskStatus(normalizeTaskStatusCategory(out.status));
  }
  return out;
}

/** The op's answer when it doesn't know a TV-D9 field (a database before it). */
export function isMissingTvD9FieldError(error: { message?: string } | null | undefined): boolean {
  return /no field "(due_on|due_time|status_id)"/.test(error?.message ?? "");
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
    // TV-D9: the due date is a date; the app's readers get its local midnight
    // here, so everyone sees the same day. Before TV-D9: the stored instant.
    dueDate: r.due_on !== undefined ? dueOnToLocalInstant(r.due_on) : (r.due_date ?? null),
    dueOn: r.due_on ?? localDayOf(r.due_date),
    dueTime: r.due_time ?? null,
    scheduledAt: r.scheduled_at ?? null,
    durationMinutes: r.duration_minutes ?? null,
    // TV-D10: left out (undefined) on a row from before it, so readers fall
    // back to duration_minutes for the estimate.
    ...(r.estimate_minutes !== undefined ? { estimateMinutes: r.estimate_minutes ?? null } : {}),
    ...(r.section_id !== undefined ? { sectionId: r.section_id ?? null } : {}),
    ...(r.team_id !== undefined ? { teamId: r.team_id ?? null } : {}),
    ...(r.imported_from !== undefined ? { importedFrom: importedFromOf(r.imported_from) } : {}),
    timeSpentSeconds: r.time_spent_seconds ?? 0,
    recurrence: (r.recurrence as Task["recurrence"]) ?? null,
    energyLevel: r.energy_level ?? null,
    priority: r.priority ?? null,
    // A status this build doesn't know shows as its nearest one (TV-D8).
    status: normalizeTaskStatus(r.status),
    statusId: r.status_id ?? null,
    statusCategory:
      r.status_category == null ? null : normalizeTaskStatusCategory(r.status_category),
    completedAt: r.completed_at ?? null,
    completedBy: r.completed_by ?? null,
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

/** A project_statuses row (TV-D9) → the model. */
export function projectStatusRowToModel(raw: unknown): ProjectStatus {
  const r = requireRow(projectStatusRowSchema, raw, "project status");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    projectId: r.project_id ?? null,
    category: normalizeTaskStatusCategory(r.category),
    name: r.name,
    position: r.position ?? 1,
    hidden: !!r.hidden,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
    // TV-D10's project fields, only when the row has them.
    ...(r.status !== undefined
      ? {
          status: normalizeProjectState(r.status),
          startsOn: r.starts_on ?? null,
          targetOn: r.target_on ?? null,
          leadId: r.lead_id ?? null,
          clientContactId: r.client_contact_id ?? null,
          areaId: r.area_id ?? null,
        }
      : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

/** `tasks.imported_from` ({source, key}) when it has that shape. */
function importedFromOf(raw: unknown): Task["importedFrom"] {
  if (!raw || typeof raw !== "object") return null;
  const { source, key } = raw as Record<string, unknown>;
  return typeof source === "string" && typeof key === "string" ? { source, key } : null;
}

// ── TV-D10 rows ─────────────────────────────────────────────────────────────

export function areaRowToModel(raw: unknown): Area {
  const r = requireRow(areaRowSchema, raw, "area");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    color: r.color ?? null,
    position: r.position ?? 1,
    shared: r.shared ?? false,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function sectionRowToModel(raw: unknown): Section {
  const r = requireRow(sectionRowSchema, raw, "section");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    name: r.name,
    position: r.position ?? 1,
    startsOn: r.starts_on ?? null,
    endsOn: r.ends_on ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function teamRowToModel(raw: unknown): Team {
  const r = requireRow(teamRowSchema, raw, "team");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    mark: r.mark,
    color: r.color ?? null,
    defaultProjectId: r.default_project_id ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function teamMemberRowToModel(raw: unknown): TeamMember {
  const r = requireRow(teamMemberRowSchema, raw, "team member");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    teamId: r.team_id,
    userId: r.user_id,
    createdAt: r.created_at,
  };
}

export function taskSessionRowToModel(raw: unknown): TaskSession {
  const r = requireRow(taskSessionRowSchema, raw, "work session");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    taskId: r.task_id,
    userId: r.user_id ?? null,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    updatedAt: r.updated_at,
  };
}

/** A reminder of a kind this build doesn't know reads as one at its time. */
export function taskReminderRowToModel(raw: unknown): TaskReminder {
  const r = requireRow(taskReminderRowSchema, raw, "reminder");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    taskId: r.task_id,
    userId: r.user_id,
    kind: normalizeTaskReminderKind(r.kind),
    at: r.at ?? null,
    firedAt: r.fired_at ?? null,
    updatedAt: r.updated_at,
  };
}

/** An entry of a kind this build doesn't know reads as free text. */
export function taskWaitingRowToModel(raw: unknown): TaskWaitingEntry {
  const r = requireRow(taskWaitingRowSchema, raw, "waiting entry");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    taskId: r.task_id,
    kind: normalizeTaskWaitingKind(r.kind),
    ref: r.ref ?? null,
    label: r.label ?? null,
    since: r.since,
    createdBy: r.created_by ?? null,
    updatedAt: r.updated_at,
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

/** A comment row → what the shared store's comment counts need (TV-D11a). */
export function commentMarkRowToModel(raw: unknown): CommentMark {
  const r = raw as {
    id?: unknown;
    entity_id?: unknown;
    updated_at?: unknown;
    deleted_at?: unknown;
  };
  if (typeof r?.id !== "string" || typeof r.entity_id !== "string") {
    throw new Error("Malformed comment payload");
  }
  return {
    id: r.id,
    taskId: r.entity_id,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : "",
    deletedAt: typeof r.deleted_at === "string" ? r.deleted_at : null,
  };
}
