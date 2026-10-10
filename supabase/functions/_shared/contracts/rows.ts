/**
 * High-risk Supabase row / RPC DTO schemas (zod-enum-foundation task 5).
 *
 * These validate untrusted PostgREST payloads before they become feature models.
 * Closed vocabularies come from `vocabularies.ts`. Polymorphic entity types,
 * contact statuses, and JSONB blobs stay open (`z.string()` / `z.unknown()`).
 *
 * Timestamps are `z.string()` (Postgres timestamptz text is not always a strict
 * `z.iso.datetime()`). Ids are non-empty strings, not UUID-strict, so fixtures
 * and RPC envelopes that omit hyphens still parse when the rest is valid.
 */

import { z } from "zod";

import { parseOrError, type SafeParseResult } from "./errors.ts";
import {
  activityActorTypeSchema,
  calendarAccountStatusSchema,
  calendarProviderSchema,
  contactFieldTypeSchema,
  emailAccountStatusSchema,
  energyLevelSchema,
  linkOriginSchema,
  mailboxProviderSchema,
  normalizeEmailProvider,
  normalizeRelationKind,
  priorityLevelSchema,
  relationKindSchema,
  taskTimeStatusSchema,
} from "./vocabularies.ts";

const id = z.string().min(1);
const optStr = z.union([z.string(), z.null()]).optional();
const optNum = z.union([z.number(), z.null()]).optional();
const jsonRecord = z.record(z.string(), z.unknown());

export const taskRowSchema = z.object({
  id,
  workspace_id: id,
  /** The creator since TV-D1 (it held the assignee before). */
  owner_id: optStr,
  /** NULL = Unassigned. Absent on a row read before the TV-D1 migration. */
  assignee_id: optStr,
  /** Absent before the TV-D1 migration. */
  creator_unknown: z.boolean().optional(),
  bucket_id: id,
  parent_id: optStr,
  title: z.string().optional(),
  description: z.string().optional(),
  due_date: optStr,
  scheduled_at: optStr,
  duration_minutes: optNum,
  time_spent_seconds: optNum,
  recurrence: z.unknown().optional(),
  energy_level: z.union([energyLevelSchema, z.null()]).optional(),
  priority: z.union([priorityLevelSchema, z.null()]).optional(),
  /** Lax (TV-D8): a status this build doesn't know is read through
   *  normalizeTaskStatus, so the row still shows instead of being dropped. */
  status: z.string().optional(),
  /** The handle number (TV-D8); absent on a database before that migration. */
  number: optNum,
  /** TV-D9: the project status, its category (lax, like status), when and by
   *  whom it was finished, and the due date as a date plus an optional time.
   *  All absent on a database before that migration. */
  status_id: optStr,
  status_category: z.string().nullable().optional(),
  completed_at: optStr,
  completed_by: optStr,
  due_on: optStr,
  due_time: optStr,
  /** TV-D10: the section, the team, the estimate (duration_minutes mirrors
   *  the next work session from then on) and where it was imported from.
   *  All absent on a database before that migration. */
  section_id: optStr,
  team_id: optStr,
  estimate_minutes: optNum,
  imported_from: z.unknown().optional(),
  committed_for: optStr,
  commit_order: optNum,
  reschedule_count: optNum,
  position: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type TaskRow = z.infer<typeof taskRowSchema>;

/** A task_completions row (TV-D8). */
export const taskCompletionRowSchema = z.object({
  id,
  workspace_id: id,
  task_id: id,
  user_id: optStr,
  completed_at: z.string(),
  cycle_key: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type TaskCompletionRow = z.infer<typeof taskCompletionRowSchema>;

/** A project_statuses row (TV-D9): one status of a project, or of the
 *  workspace default set (project_id null). The category is lax on read. */
export const projectStatusRowSchema = z.object({
  id,
  workspace_id: id,
  project_id: optStr,
  category: z.string(),
  name: z.string(),
  position: optNum,
  hidden: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type ProjectStatusRow = z.infer<typeof projectStatusRowSchema>;

// ── TV-D10: areas, sections, teams, sessions, reminders, Waiting on… ───────
// Kinds and states are lax on read (open strings), like status_category: a
// value this build doesn't know never drops the row.

/** An areas row: an optional group of projects in the sidebar. */
export const areaRowSchema = z.object({
  id,
  workspace_id: id,
  name: z.string(),
  color: optStr,
  position: optNum,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type AreaRow = z.infer<typeof areaRowSchema>;

/** A sections row: an ordered part of a project, with a range or an end date. */
export const sectionRowSchema = z.object({
  id,
  workspace_id: id,
  project_id: id,
  name: z.string(),
  position: optNum,
  starts_on: optStr,
  ends_on: optStr,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type SectionRow = z.infer<typeof sectionRowSchema>;

/** A teams row: a named group that tasks are routed to. */
export const teamRowSchema = z.object({
  id,
  workspace_id: id,
  name: z.string(),
  mark: z.string(),
  color: optStr,
  default_project_id: optStr,
  created_by: optStr,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type TeamRow = z.infer<typeof teamRowSchema>;

/** A team_members row. */
export const teamMemberRowSchema = z.object({
  id,
  workspace_id: id,
  team_id: id,
  user_id: id,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type TeamMemberRow = z.infer<typeof teamMemberRowSchema>;

/** A task_sessions row: one scheduled block of work on a task. */
export const taskSessionRowSchema = z.object({
  id,
  workspace_id: id,
  task_id: id,
  user_id: optStr,
  starts_at: z.string(),
  ends_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type TaskSessionRow = z.infer<typeof taskSessionRowSchema>;

/** A task_reminders row: one of the reader's own reminders. */
export const taskReminderRowSchema = z.object({
  id,
  workspace_id: id,
  task_id: id,
  user_id: id,
  kind: z.string(),
  at: optStr,
  fired_at: optStr,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type TaskReminderRow = z.infer<typeof taskReminderRowSchema>;

/** A task_waiting row: one Waiting on… entry. */
export const taskWaitingRowSchema = z.object({
  id,
  workspace_id: id,
  task_id: id,
  kind: z.string(),
  ref: optStr,
  label: optStr,
  since: z.string(),
  created_by: optStr,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type TaskWaitingRow = z.infer<typeof taskWaitingRowSchema>;

/** Notes meta row — v2 columns optional so pre-migration (legacy) reads still parse. */
export const noteRowSchema = z.object({
  id,
  workspace_id: id,
  created_by: optStr,
  parent_id: optStr,
  title: z.string().optional(),
  icon: optStr,
  is_pinned: z.union([z.boolean(), z.number()]).optional(),
  position: z.string().optional(),
  is_archived: z.union([z.boolean(), z.number()]).optional(),
  published_at: optStr,
  publish_token: optStr,
  doc_version: optNum,
  // PERM-3: a sub-note follows its parent ("inherit") or has its own sharing.
  share_mode: z.enum(["inherit", "custom"]).optional(),
  workspace_shared: z.boolean().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type NoteRow = z.infer<typeof noteRowSchema>;

export const noteUpdateRowSchema = z.object({
  id: z.union([z.number(), z.string()]),
  client_id: z.string().optional(),
  client_seq: z.union([z.number(), z.string()]).optional(),
  update_b64: z.string().optional(),
});
export type NoteUpdateRowDto = z.infer<typeof noteUpdateRowSchema>;

export const bucketRowSchema = z.object({
  id,
  workspace_id: id,
  owner_id: optStr,
  name: z.string(),
  is_system: z.boolean().optional(),
  group_label: optStr,
  position: z.string().optional(),
  /** TV-D10: the project's fields (status lax on read). Absent on a database
   *  before that migration. */
  status: z.string().optional(),
  starts_on: optStr,
  target_on: optStr,
  lead_id: optStr,
  client_contact_id: optStr,
  area_id: optStr,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});
export type BucketRow = z.infer<typeof bucketRowSchema>;

export const tagRowSchema = z.object({
  id,
  workspace_id: id,
  owner_id: optStr,
  name: z.string(),
  color: optStr,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});

export const tagLinkRowSchema = z.object({
  id,
  workspace_id: id,
  tag_id: id,
  entity_type: z.string().min(1),
  entity_id: id,
  created_at: z.string(),
});

export const taskRelationRowSchema = z.object({
  id,
  workspace_id: id,
  blocker_task_id: id,
  blocked_task_id: id,
  created_at: z.string(),
});

/** A person's queue row (TV-D2, `public.task_queue`). */
export const taskQueueRowSchema = z.object({
  id,
  workspace_id: id,
  user_id: id,
  task_id: id,
  position: z.string().min(1),
  queued_at: z.string(),
  updated_at: z.string(),
});

/** What `tasks_op_track_time` answers (TV-D3). A `gone` answer carries only the
 *  status and the task id. */
export const taskTimeAnswerSchema = z.object({
  status: taskTimeStatusSchema,
  task_id: id,
  entry_id: optStr,
  total_seconds: optNum,
  my_seconds: optNum,
  my_waiting_seconds: optNum,
});

/** One row of `tasks_time_totals` (TV-D3). */
export const taskTimeTotalsRowSchema = z.object({
  task_id: id,
  total_seconds: z.number(),
  my_seconds: z.number(),
  my_waiting_seconds: z.number(),
  my_seconds_since: optNum,
});

export const activityRowSchema = z.object({
  id,
  workspace_id: id,
  module: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: id,
  op: z.string().min(1),
  actor_type: activityActorTypeSchema.optional(),
  actor_id: optStr,
  actor_label: optStr,
  payload: z.unknown().optional(),
  created_at: z.string(),
});

export const entityLinkRowSchema = z.object({
  id,
  workspace_id: id,
  source_type: z.string().min(1),
  source_id: id,
  target_type: z.string().min(1),
  target_id: id,
  relation_kind: relationKindSchema,
  origin: linkOriginSchema,
  created_by: optStr,
  created_at: z.string(),
  deleted_at: optStr,
});

export const entityRecordRowSchema = z.object({
  workspace_id: id,
  entity_type: z.string().min(1),
  entity_id: id,
  label: z.string().optional(),
  icon: optStr,
  deleted_at: optStr,
});

export const linkSuggestionRowSchema = z.object({
  other_type: z.string().min(1),
  other_id: id,
  other_label: z.string().optional(),
  other_icon: optStr,
  signal: z.string().min(1),
  suggested_kind: z.string().optional(),
  strength: z.union([z.number(), z.string()]).optional(),
});

export const commentRowSchema = z.object({
  id,
  workspace_id: id,
  entity_type: z.string().min(1),
  entity_id: id,
  body: z.string().optional(),
  created_by: optStr,
  // Absent before 20261008123000; normalizeContentAuthorKind reads that as "user".
  author_kind: optStr,
  author_label: optStr,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});

export const notificationRowSchema = z.object({
  id,
  workspace_id: optStr,
  entity_type: optStr,
  entity_id: optStr,
  op: z.string().min(1),
  payload: z.unknown().optional(),
  actor_type: activityActorTypeSchema.optional(),
  actor_id: optStr,
  actor_label: optStr,
  created_at: z.string(),
  read_at: optStr,
  dismissed_at: optStr,
});

export const emailAccountRowSchema = z.object({
  id,
  workspace_id: id,
  owner_id: id,
  provider: z.string().min(1),
  address: z.string(),
  status: emailAccountStatusSchema,
  signature_html: z.string().optional(),
  unread_count: optNum,
  color: optStr,
  last_sync_at: optStr,
  last_error: optStr,
  created_at: z.string(),
  updated_at: z.string(),
});

export const emailRefRowSchema = z.object({
  id,
  workspace_id: id,
  owner_id: id,
  account_id: optStr,
  thread_key: z.string().min(1),
  message_key: optStr,
  from_addr: optStr,
  from_name: optStr,
  subject: z.string().optional(),
  snippet: z.string().optional(),
  sent_at: optStr,
  is_snoozed: z.boolean().optional(),
  snooze_until: optStr,
  follow_up_at: optStr,
  follow_up_cleared_at: optStr,
  created_at: z.string(),
  updated_at: z.string(),
});

export const habitRowSchema = z.object({
  id,
  workspace_id: z.string().optional(),
  name: z.string().optional(),
  emoji: z.string().optional(),
  position: z.string().optional(),
  checks: z.unknown().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

/** public.attachments (AT-1). size_bytes is a bigint: PostgREST sends it as a
 *  JSON number while it fits, a string past 2^53. */
export const attachmentRowSchema = z.object({
  id,
  entity_type: z.string(),
  entity_id: z.string(),
  uploader_id: z.string().nullable().optional(),
  file_name: z.string(),
  mime: z.string(),
  size_bytes: z.union([z.number(), z.string()]),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  status: z.unknown(),
  deleted_at: z.string().nullable().optional(),
  created_at: z.string(),
});

export const contactChannelSchema = z.object({
  label: z.unknown().optional(),
  value: z.unknown().optional(),
  primary: z.unknown().optional(),
});

export const contactRowSchema = z.object({
  id,
  workspace_id: id,
  owner_id: optStr,
  name: z.string().optional(),
  email: optStr,
  emails: z.unknown().optional(),
  phone: optStr,
  phones: z.unknown().optional(),
  addresses: z.unknown().optional(),
  urls: z.unknown().optional(),
  dates: z.unknown().optional(),
  title: optStr,
  company_id: optStr,
  status: z.string().optional(),
  custom: z.unknown().optional(),
  is_favorite: z.boolean().optional(),
  notes_inline: z.string().optional(),
  avatar_url: optStr,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});

export const companyRowSchema = z.object({
  id,
  workspace_id: id,
  owner_id: optStr,
  name: z.string().optional(),
  domains: z.unknown().optional(),
  website: optStr,
  custom: z.unknown().optional(),
  notes_inline: z.string().optional(),
  avatar_url: optStr,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});

export const contactFieldDefRowSchema = z.object({
  id,
  workspace_id: id,
  key: z.string().min(1),
  label: z.string().optional(),
  type: contactFieldTypeSchema.optional(),
  options: z.unknown().optional(),
  position: z.union([z.number(), z.string()]).optional(),
});

export const calendarEventRowSchema = z.object({
  id,
  workspace_id: optStr,
  owner_id: optStr,
  source_account_id: optStr,
  external_event_id: optStr,
  calendar_id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  start_time: z.string(),
  end_time: z.string(),
  all_day: z.boolean().optional(),
  recurrence_rule: optStr,
  status: z.string().optional(),
  location: optStr,
  color: optStr,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: optStr,
});

export const calendarAccountRowSchema = z.object({
  id,
  workspace_id: id,
  owner_id: optStr,
  provider: z.string().min(1),
  external_id: z.string().optional(),
  display_label: z.string().optional(),
  is_default_target: z.boolean().optional(),
  color: optStr,
  last_sync_at: optStr,
  status: calendarAccountStatusSchema.optional(),
  sync_token: optStr,
  deleted_at: optStr,
});

export const prefsRowSchema = z.object({
  appearance: z.unknown().optional(),
  appearance_updated_at: optStr,
  focus: z.unknown().optional(),
  focus_updated_at: optStr,
  calendar: z.unknown().optional(),
  calendar_updated_at: optStr,
  email: z.unknown().optional(),
  email_updated_at: optStr,
  preferences: z.unknown().optional(),
  preferences_updated_at: optStr,
});

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  params: z.unknown().optional(),
});

export const publicNoteSchema = z.object({
  id,
  parentId: z.union([z.string(), z.null()]).optional().transform((v) => v ?? null),
  title: z.string(),
  icon: z.union([z.string(), z.null()]).optional().default(null),
  bodyMd: z.string(),
  position: z.union([z.string(), z.null()]).optional(),
  createdAt: z.union([z.string(), z.null()]).optional(),
});

export const publicNotePayloadSchema = z.object({
  rootId: id,
  notes: z.array(publicNoteSchema).min(1),
});

export const calendarSyncDescriptorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("caldav"),
    serverUrl: z.string(),
    username: z.string(),
    calendarUrl: z.string().optional(),
    calendarName: z.string().optional(),
  }),
  z.object({ kind: z.literal("ics") }),
]);

export const caldavCalendarSchema = z.object({
  url: z.string().min(1),
  name: z.string(),
  color: z.union([z.string(), z.null()]).optional(),
});

export const openMeteoGeocodeSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        country: z.string().optional(),
        latitude: z.number(),
        longitude: z.number(),
      }),
    )
    .optional(),
});

export const openMeteoForecastSchema = z.object({
  current_weather: z
    .object({
      temperature: z.number(),
      weathercode: z.number().optional(),
      is_day: z.number().optional(),
    })
    .optional(),
});

export function parseRow<T>(schema: z.ZodType<T>, input: unknown): SafeParseResult<T> {
  return parseOrError(schema, input);
}

/** List reads: skip malformed rows so one bad envelope cannot wall a module. */
export function mapKnownRows<T>(
  rows: unknown,
  mapOne: (row: unknown) => T,
): T[] {
  if (!Array.isArray(rows)) return [];
  const out: T[] = [];
  for (const row of rows) {
    try {
      out.push(mapOne(row));
    } catch {
      /* drop */
    }
  }
  return out;
}

/** Mutations / single-row reads: structured failure, never a silent default. */
export function requireRow<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const parsed = parseOrError(schema, input);
  if (!parsed.success) {
    throw new Error(`Malformed ${label} payload`);
  }
  return parsed.data;
}

export function requireMapped<TIn, TOut>(
  schema: z.ZodType<TIn>,
  input: unknown,
  map: (row: TIn) => TOut,
  label: string,
): TOut {
  return map(requireRow(schema, input, label));
}

/** Email provider on a stored row: canonicalize imap → custom, then enforce. */
export function parsedMailboxProvider(raw: unknown) {
  return mailboxProviderSchema.parse(normalizeEmailProvider(raw));
}

export function parsedCalendarProvider(raw: unknown) {
  const parsed = parseOrError(calendarProviderSchema, raw);
  if (!parsed.success) {
    throw new Error("Malformed calendar provider");
  }
  return parsed.data;
}

export function parsedRelationKind(raw: unknown) {
  const parsed = parseOrError(relationKindSchema, raw);
  return parsed.success ? parsed.data : normalizeRelationKind(raw);
}

export { jsonRecord };
