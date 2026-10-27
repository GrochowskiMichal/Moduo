// Task ↔ `public.tasks` row mapping for the web runtime. Pure, so it can be
// tested without loading runtime.web (which opens a Supabase client on import).
//
// Since TV-D1 an edit sends only the columns it changed (`taskPatchToColumns`):
// a whole-row save carried every other field as this device last saw it, so
// one person's edit could put back a field a teammate had just changed.

import {
  agentSessionRowSchema,
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
  taskTimeEntryRowSchema,
  taskTimeTotalsRowSchema,
  taskWaitingRowSchema,
  teamMemberRowSchema,
  teamRowSchema,
  timeReportRowSchema,
} from "@contracts/rows";
import {
  legacyTaskStatus,
  normalizeAgentSessionState,
  normalizeProjectState,
  normalizeTaskReminderKind,
  normalizeTaskStatus,
  normalizeTaskStatusCategory,
  normalizeTaskWaitingKind,
  type TaskStatusCategory,
  taskStatusWord,
} from "@contracts/vocabularies";

import type {
  AgentSession,
  AgentSessionLine,
  AgentSessionLink,
} from "../features/spine/agent-session";
import type {
  Area,
  Bucket,
  ProjectStatus,
  Section,
  Tag,
  TagLink,
  Task,
  TaskCompletion,
  TaskCycle,
  TaskQueueEntry,
  TaskReminder,
  TaskSession,
  TaskTimeEntry,
  TaskTimeResult,
  TaskTimeTotals,
  TaskWaitingEntry,
  Team,
  TeamMember,
  TimeReportRow,
  TrackTimeInput,
} from "../features/tasks/model";
import type { AttachmentMark, CommentMark } from "./sync/types";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The device-local calendar day of an instant, YYYY-MM-DD (null if unreadable). */
export function localDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * A patch that sets the due date also sets `dueOn`, the day it stands for on
 * this device (TV-D9), so the copy never shows a new date with an old day.
 * One that sets `dueOn` itself (a repeat's occurrence) keeps it.
 */
export function withDueOn<T extends { dueDate?: string | null; dueOn?: string | null }>(
  patch: T,
): T {
  if (patch.dueDate === undefined || patch.dueOn !== undefined) return patch;
  return { ...patch, dueOn: localDayOf(patch.dueDate) };
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
 * TV-D14's arguments to `tasks_op_track_time`, only those a save uses, so a
 * database before TV-D14 still takes every older save (PostgREST matches a
 * function by the names sent).
 */
export function trackTimeExtras(input: TrackTimeInput): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (input.on !== undefined && input.on !== null) out.p_on = input.on;
  if (input.note !== undefined && input.note !== null) out.p_note = input.note;
  if (input.runId) out.p_run_id = input.runId;
  if (input.reason) out.p_reason = input.reason;
  return out;
}

/** A date column's day (YYYY-MM-DD), or null. */
function dayOf(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** Map one of your own `task_time_entries` rows (TV-D3; TV-D14's columns). */
export function taskTimeEntryRowToModel(raw: unknown): TaskTimeEntry {
  const r = requireRow(taskTimeEntryRowSchema, raw, "time entry");
  return {
    id: r.id,
    taskId: r.task_id,
    kind: r.kind,
    seconds: r.seconds,
    startedAt: r.started_at ?? null,
    endedAt: r.ended_at ?? null,
    entryOn: dayOf(r.entry_on),
    note: r.note ?? null,
    reason: r.reason ?? null,
    runId: r.run_id ?? null,
    createdAt: r.created_at,
  };
}

/** Map one row of `tasks_time_report` (TV-D14). */
export function timeReportRowToModel(raw: unknown): TimeReportRow {
  const r = requireRow(timeReportRowSchema, raw, "time report row");
  return {
    entryId: r.entry_id,
    taskId: r.task_id,
    taskTitle: r.task_title,
    projectId: r.project_id ?? null,
    projectName: r.project_name ?? null,
    projectIsInbox: r.project_is_inbox === true,
    userId: r.user_id,
    isMine: r.is_mine,
    day: dayOf(r.entry_day) ?? r.entry_day,
    seconds: r.seconds,
    kind: r.kind,
    reason: r.reason ?? null,
    note: r.note ?? null,
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
    // Never take the day from `due_date` when `due_on` is there: the server writes
    // it as noon UTC of `due_on`, which is the next day at UTC+12 to +14.
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
    // TV-U6: the sidebar colour and archiving (absent before its migration).
    color: r.color ?? null,
    archivedAt: r.archived_at ?? null,
    // TV-U16 (absent before its migration).
    ...(r.description !== undefined ? { description: r.description ?? "" } : {}),
    // MOD-155: a company client (absent before its migration).
    ...(r.client_company_id !== undefined ? { clientCompanyId: r.client_company_id ?? null } : {}),
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

/**
 * `tasks_op_history`'s answer as cycles, newest first. Entries that don't read
 * are dropped (a history is a view, never a reason to fail).
 */
export function taskCyclesFromJson(raw: unknown): TaskCycle[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskCycle[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if ((e.kind !== "done" && e.kind !== "skipped") || typeof e.at !== "string") continue;
    out.push({
      kind: e.kind,
      at: e.at,
      cycle: typeof e.cycle === "string" ? e.cycle : null,
      by: typeof e.by === "string" ? e.by : null,
      mySeconds: typeof e.my_seconds === "number" && e.my_seconds > 0 ? e.my_seconds : 0,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
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
    suspendedAt: r.suspended_at ?? null,
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

/** An agent session (TV-D16): its links and earlier lines read leniently. */
export function agentSessionRowToModel(raw: unknown): AgentSession {
  const r = requireRow(agentSessionRowSchema, raw, "agent session");
  const links: AgentSessionLink[] = Array.isArray(r.links)
    ? (r.links as unknown[]).flatMap((l) => {
        const v = l as { url?: unknown; label?: unknown } | null;
        if (!v || typeof v.url !== "string" || !/^https?:\/\//i.test(v.url)) return [];
        return [
          typeof v.label === "string" && v.label ? { url: v.url, label: v.label } : { url: v.url },
        ];
      })
    : [];
  const earlier: AgentSessionLine[] = Array.isArray(r.earlier)
    ? (r.earlier as unknown[]).flatMap((e) => {
        const v = e as Record<string, unknown> | null;
        if (!v || typeof v.at !== "string") return [];
        return [
          {
            at: v.at,
            state: normalizeAgentSessionState(v.state),
            note: typeof v.note === "string" ? v.note : null,
            step: typeof v.step === "number" ? v.step : null,
            steps: typeof v.steps === "number" ? v.steps : null,
          },
        ];
      })
    : [];
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    taskId: r.task_id,
    userId: r.user_id,
    agent: r.agent,
    state: normalizeAgentSessionState(r.state),
    note: r.note ?? null,
    step: r.step ?? null,
    steps: r.steps ?? null,
    links,
    earlier,
    summaryAt: r.summary_at ?? null,
    summaryPostedAt: r.summary_posted_at ?? null,
    startedAt: r.started_at,
    updatedAt: r.updated_at,
    stoppedAt: r.stopped_at ?? null,
    ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
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

/** An attachment row → what the shared store's 📎 counts need (AT-3). */
export function attachmentMarkRowToModel(raw: unknown): AttachmentMark {
  const r = raw as {
    id?: unknown;
    entity_id?: unknown;
    status?: unknown;
    updated_at?: unknown;
    deleted_at?: unknown;
  };
  if (typeof r?.id !== "string" || typeof r.entity_id !== "string") {
    throw new Error("Malformed attachment payload");
  }
  return {
    id: r.id,
    taskId: r.entity_id,
    status: typeof r.status === "string" ? r.status : "",
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : "",
    deletedAt: typeof r.deleted_at === "string" ? r.deleted_at : null,
  };
}
