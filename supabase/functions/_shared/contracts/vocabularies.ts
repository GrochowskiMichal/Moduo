/**
 * Canonical domain vocabularies + compatibility bridges (zod-enum-foundation, task 2).
 *
 * ONE source of truth per stable vocabulary: a const array, a Zod schema, an
 * inferred type, and — where historical spellings exist — an explicit named
 * bridge. App modules re-export these types so consumers keep their existing
 * import paths while the values live here exactly once.
 *
 * Boundary policy:
 *   - `parse*` (strict)  → write paths / untrusted input. Unknown = rejection.
 *   - `normalize*` (lax) → read/display paths. Legacy spellings map to the
 *     canonical value; unknown falls back to least-privilege / a documented
 *     default. Never throws.
 *   - `is*` guards       → membership tests with proper narrowing (no casts).
 *
 * Database-facing labels are grounded in the LIVE catalog (pg_enum probe
 * 2026-08-14, see .omo/evidence/zod-enum-foundation/task-2-vocabularies.txt),
 * not migration comments or generated types alone.
 *
 * Guardrails honored: polymorphic entity types, user-renamable contact
 * statuses, IMAP folder names, Stripe event names, and opaque client prefs
 * stay OPEN strings and deliberately have NO schema here.
 */

import { z } from "zod";

import { parseOrError, type SafeParseResult } from "./errors.ts";

// ---------------------------------------------------------------------------
// plan_tier — the only native Postgres enum today.
// Live pg_enum (2026-10-06): free | pro | team | founder | duo  (SINGULAR).
// The app historically used "founders" (plural); Stripe/sync Edge Functions
// wrote "founders" until task 6. "founders" is a compatibility INPUT only.
// ---------------------------------------------------------------------------

export const PLAN_TIERS = ["free", "pro", "team", "founder", "duo"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];
export const planTierSchema = z.enum(PLAN_TIERS);

/** Legacy spellings accepted on read, normalized to the canonical label. */
const PLAN_TIER_LEGACY: Record<string, PlanTier> = {
  founders: "founder",
};

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === "string" && (PLAN_TIERS as readonly string[]).includes(value);
}

/**
 * Read/display bridge: canonical labels pass through, "founders" normalizes
 * to "founder", anything unknown degrades to "free" (least privilege — a
 * garbled tier must never grant entitlements).
 */
export function normalizePlanTier(input: unknown): PlanTier {
  if (typeof input !== "string") return "free";
  const key = input.trim().toLowerCase();
  if (isPlanTier(key)) return key;
  return PLAN_TIER_LEGACY[key] ?? "free";
}

/** Strict parse for write paths — "founders" is REJECTED here (use normalize first). */
export function parsePlanTier(input: unknown): SafeParseResult<PlanTier> {
  return parseOrError(planTierSchema, input);
}

// ---------------------------------------------------------------------------
// Tasks module — mirrors CHECK constraints in 20260606120000_create_tasks_module
// and 20260606130000_tasks_add_priority. ("urgent" priority is a documented
// future, non-breaking add — see tasks/model.ts.)
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ["todo", "in_progress", "done", "archived"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema = z.enum(TASK_STATUSES);
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * Lax read of a task's status (TV-D8, REPLAN §6.3): a value this build doesn't
 * know still shows, as its category, and the row is never dropped. Tasks v3
 * stores five categories (TV-D9): "backlog" reads as To do here and
 * "wont_do" as Won't do (`archived` until TV-D7); anything else unknown
 * reads as To do, so it stays in view.
 */
export function normalizeTaskStatus(input: unknown): TaskStatus {
  if (isTaskStatus(input)) return input;
  const v = typeof input === "string" ? input.trim().toLowerCase().replace(/[\s'’-]+/g, "_") : "";
  if (isTaskStatus(v)) return v;
  if (v === "wont_do" || v === "won_t_do" || v === "cancelled" || v === "canceled") return "archived";
  if (v === "completed" || v === "complete" || v === "closed") return "done";
  if (v === "started" || v === "in_review") return "in_progress";
  return "todo";
}

/** Statuses that still need doing (the one "is open" rule; MCP and the app share it). */
export const TASK_OPEN_STATUSES = ["todo", "in_progress"] as const satisfies readonly TaskStatus[];

/**
 * Is this legacy status value still open? Unknown values read through
 * {@link normalizeTaskStatus}. A task's own openness reads its category:
 * use {@link isOpenTask} (a backlog task stores "todo" here).
 */
export function isOpenTaskStatus(status: unknown): boolean {
  return (TASK_OPEN_STATUSES as readonly string[]).includes(normalizeTaskStatus(status));
}

// ---------------------------------------------------------------------------
// Task status categories (TV-D9, REPLAN 53/53a) — mirrors the CHECKs on
// project_statuses.category and tasks.status_category in
// 20261010170000_project_statuses. Each project names its own statuses inside
// these five; the app's behaviour hangs on the category. Replaces
// TASK_STATUSES at TV-D7 (archived → wont_do, plus backlog).
// ---------------------------------------------------------------------------

export const TASK_STATUS_CATEGORIES = ["backlog", "todo", "in_progress", "done", "wont_do"] as const;
export type TaskStatusCategory = (typeof TASK_STATUS_CATEGORIES)[number];
export const taskStatusCategorySchema = z.enum(TASK_STATUS_CATEGORIES);

export function isTaskStatusCategory(value: unknown): value is TaskStatusCategory {
  return (
    typeof value === "string" && (TASK_STATUS_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Strict parse for write paths: only the five stored tokens. */
export function parseTaskStatusCategory(input: unknown): SafeParseResult<TaskStatusCategory> {
  return parseOrError(taskStatusCategorySchema, input);
}

/**
 * Lax read: the five tokens, the legacy column's values (archived → Won't do)
 * and the words people write ("To do", "Won't do"). Unknown reads as To do,
 * so a row is never dropped (REPLAN §6.3). Same reading as the server's
 * `tasks__status_category_of`.
 */
export function normalizeTaskStatusCategory(input: unknown): TaskStatusCategory {
  if (isTaskStatusCategory(input)) return input;
  const v = typeof input === "string" ? input.trim().toLowerCase().replace(/[\s'’_-]+/g, "") : "";
  if (v === "backlog") return "backlog";
  if (v === "inprogress") return "in_progress";
  if (v === "done") return "done";
  if (v === "wontdo" || v === "archived") return "wont_do";
  // Everything else as the legacy reading does (started → In progress, …).
  const legacy = normalizeTaskStatus(input);
  return legacy === "archived" ? "wont_do" : legacy;
}

/** The legacy column's value for a category (what builds before TV-D9 read). */
export function legacyTaskStatus(category: TaskStatusCategory): TaskStatus {
  if (category === "backlog") return "todo";
  if (category === "wont_do") return "archived";
  return category;
}

/**
 * The word a status op is sent for a category: the legacy value (every
 * database reads "archived" as Won't do, so a write works before TV-D9's
 * migration too), and "backlog", which only TV-D9 knows.
 */
export function taskStatusWord(category: TaskStatusCategory): string {
  return category === "backlog" ? "backlog" : legacyTaskStatus(category);
}

/** Categories still to be worked on: the one "is open" rule. Backlog is
 *  parked, so it sits out of counts, My tasks, Upcoming, Focus, drift and late. */
export const TASK_OPEN_CATEGORIES = ["todo", "in_progress"] as const satisfies readonly TaskStatusCategory[];
/** Categories that are finished, one way or the other. */
export const TASK_CLOSED_CATEGORIES = ["done", "wont_do"] as const satisfies readonly TaskStatusCategory[];

/** A task's category: the stored one, else read from its legacy status (a row
 *  from before TV-D9). */
export function taskCategoryOf(task: {
  status: unknown;
  statusCategory?: TaskStatusCategory | null;
}): TaskStatusCategory {
  return task.statusCategory ?? normalizeTaskStatusCategory(task.status);
}

/** Is this task open (To do or In progress)? Backlog is not. */
export function isOpenTask(task: { status: unknown; statusCategory?: TaskStatusCategory | null }) {
  return (TASK_OPEN_CATEGORIES as readonly string[]).includes(taskCategoryOf(task));
}

/** Is this task finished (Done or Won't do)? Backlog is not. */
export function isClosedTask(task: { status: unknown; statusCategory?: TaskStatusCategory | null }) {
  return (TASK_CLOSED_CATEGORIES as readonly string[]).includes(taskCategoryOf(task));
}

/** Is this task parked in Backlog? */
export function isBacklogTask(task: {
  status: unknown;
  statusCategory?: TaskStatusCategory | null;
}) {
  return taskCategoryOf(task) === "backlog";
}

// ---------------------------------------------------------------------------
// Task time entries (TV-D3) — mirrors task_time_entries' kind CHECK and
// tasks_op_track_time's actions and answers; TV-D14's re-cut
// (*_time_entries_add) added `manual`, `add`/`edit`/`remove` and the
// adjustment reason.
// ---------------------------------------------------------------------------

/** focus/waiting: a tracked stretch; adjustment: a signed correction; legacy:
 *  the total a task had before entries existed; manual: time logged by hand
 *  on a day ("Add time…", TV-D14). */
export const TASK_TIME_ENTRY_KINDS = ["focus", "waiting", "adjustment", "legacy", "manual"] as const;
export type TaskTimeEntryKind = (typeof TASK_TIME_ENTRY_KINDS)[number];
export const taskTimeEntryKindSchema = z.enum(TASK_TIME_ENTRY_KINDS);
export function isTaskTimeEntryKind(value: unknown): value is TaskTimeEntryKind {
  return typeof value === "string" && (TASK_TIME_ENTRY_KINDS as readonly string[]).includes(value);
}

/** What `tasks_op_track_time` can do. */
export const TASK_TIME_ACTIONS = [
  "focus",
  "waiting",
  "adjust",
  "set_total",
  "undo",
  "add",
  "edit",
  "remove",
] as const;
export type TaskTimeAction = (typeof TASK_TIME_ACTIONS)[number];
export const taskTimeActionSchema = z.enum(TASK_TIME_ACTIONS);

/** How `tasks_op_track_time` answered: recorded; a resend of a save it already
 *  has; nothing to change; or no such task you can see. */
export const TASK_TIME_STATUSES = ["saved", "duplicate", "noop", "gone"] as const;
export type TaskTimeStatus = (typeof TASK_TIME_STATUSES)[number];
export const taskTimeStatusSchema = z.enum(TASK_TIME_STATUSES);

/** Why an adjustment exists (TV-D14): `give_back` = time counted on two
 *  devices, given back after a Focus takeover (TV-F6, F6-16). */
export const TASK_TIME_ADJUSTMENT_REASONS = ["give_back"] as const;
export type TaskTimeAdjustmentReason = (typeof TASK_TIME_ADJUSTMENT_REASONS)[number];
export const taskTimeAdjustmentReasonSchema = z.enum(TASK_TIME_ADJUSTMENT_REASONS);

// ---------------------------------------------------------------------------
// Time & region (TV-D14) — mirrors user_preferences' hour_cycle and
// date_order CHECKs in *_user_preferences_time_region. NULL = the device's.
// ---------------------------------------------------------------------------

/** The clock: 12-hour ("3:00 PM") or 24-hour ("15:00"). */
export const HOUR_CYCLES = ["h12", "h23"] as const;
export type HourCycle = (typeof HOUR_CYCLES)[number];
export const hourCycleSchema = z.enum(HOUR_CYCLES);
export function isHourCycle(value: unknown): value is HourCycle {
  return typeof value === "string" && (HOUR_CYCLES as readonly string[]).includes(value);
}

/** Which comes first in a date: "Oct 16" or "16 Oct". */
export const DATE_ORDERS = ["month_day", "day_month"] as const;
export type DateOrder = (typeof DATE_ORDERS)[number];
export const dateOrderSchema = z.enum(DATE_ORDERS);
export function isDateOrder(value: unknown): value is DateOrder {
  return typeof value === "string" && (DATE_ORDERS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Focus runs (TV-F6, salvaged from #323) — mirrors focus_runs' CHECKs: status
// and phase in 20261008235243_focus_runs, the timer (`mode`) in the TV-F6
// re-cut (*_focus_runs_v3), which also checks focus_op_run_start's p_mode.
// ---------------------------------------------------------------------------

/** A run is going, paused, or over (one open run per person). */
export const FOCUS_RUN_STATUSES = ["running", "paused", "ended"] as const;
export type FocusRunStatus = (typeof FOCUS_RUN_STATUSES)[number];
export const focusRunStatusSchema = z.enum(FOCUS_RUN_STATUSES);
export function isFocusRunStatus(value: unknown): value is FocusRunStatus {
  return typeof value === "string" && (FOCUS_RUN_STATUSES as readonly string[]).includes(value);
}
/** Lax read: an unknown status reads as ended (a run nobody can act on). */
export function normalizeFocusRunStatus(input: unknown): FocusRunStatus {
  return isFocusRunStatus(input) ? input : "ended";
}
export function parseFocusRunStatus(input: unknown): SafeParseResult<FocusRunStatus> {
  return parseOrError(focusRunStatusSchema, input);
}

/** Focus's Timer (REPLAN 62a): the pill on the task (Per task, the default),
 *  one rhythm for the session (Pomodoro; time still goes to each task), or no
 *  clock and nothing recorded (Off). Changeable mid-run. */
export const FOCUS_TIMER_MODES = ["per_task", "pomodoro", "off"] as const;
export type FocusTimerMode = (typeof FOCUS_TIMER_MODES)[number];
export const focusTimerModeSchema = z.enum(FOCUS_TIMER_MODES);
export function isFocusTimerMode(value: unknown): value is FocusTimerMode {
  return typeof value === "string" && (FOCUS_TIMER_MODES as readonly string[]).includes(value);
}
/** Lax read: an unknown timer reads as the default, Per task. */
export function normalizeFocusTimerMode(input: unknown): FocusTimerMode {
  return isFocusTimerMode(input) ? input : "per_task";
}
export function parseFocusTimerMode(input: unknown): SafeParseResult<FocusTimerMode> {
  return parseOrError(focusTimerModeSchema, input);
}

/** The pomodoro phase a run is in (Per task and Off are always `work`). */
export const FOCUS_RUN_PHASES = ["work", "break", "long_break"] as const;
export type FocusRunPhase = (typeof FOCUS_RUN_PHASES)[number];
export const focusRunPhaseSchema = z.enum(FOCUS_RUN_PHASES);
export function isFocusRunPhase(value: unknown): value is FocusRunPhase {
  return typeof value === "string" && (FOCUS_RUN_PHASES as readonly string[]).includes(value);
}
/** Lax read: an unknown phase reads as work. */
export function normalizeFocusRunPhase(input: unknown): FocusRunPhase {
  return isFocusRunPhase(input) ? input : "work";
}
export function parseFocusRunPhase(input: unknown): SafeParseResult<FocusRunPhase> {
  return parseOrError(focusRunPhaseSchema, input);
}

// ---------------------------------------------------------------------------
// Tasks v3 structure (TV-D10) — mirrors buckets.status in
// 20261010180000_areas_projects_sections, and task_reminders.kind and
// task_waiting.kind in 20261010181000_task_sessions_reminders_waiting.
// ---------------------------------------------------------------------------

/** A project's state (REPLAN 16): Active · On hold · Done. Only the overview,
 *  a dimmed sidebar row and MCP read it; it never hides tasks. (Not the
 *  per-project task statuses, which live in `project_statuses`.) */
export const PROJECT_STATES = ["active", "on_hold", "done"] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];
export const projectStateSchema = z.enum(PROJECT_STATES);
export function isProjectState(value: unknown): value is ProjectState {
  return typeof value === "string" && (PROJECT_STATES as readonly string[]).includes(value);
}
export function parseProjectState(input: unknown): SafeParseResult<ProjectState> {
  return parseOrError(projectStateSchema, input);
}
/** Lax read: unknown reads as Active, so a project never disappears. */
export function normalizeProjectState(input: unknown): ProjectState {
  return isProjectState(input) ? input : "active";
}

/** When a reminder fires (REPLAN 24): at a time, or a day / an hour before due. */
export const TASK_REMINDER_KINDS = ["at", "day_before", "hour_before"] as const;
export type TaskReminderKind = (typeof TASK_REMINDER_KINDS)[number];
export const taskReminderKindSchema = z.enum(TASK_REMINDER_KINDS);
export function isTaskReminderKind(value: unknown): value is TaskReminderKind {
  return typeof value === "string" && (TASK_REMINDER_KINDS as readonly string[]).includes(value);
}
export function parseTaskReminderKind(input: unknown): SafeParseResult<TaskReminderKind> {
  return parseOrError(taskReminderKindSchema, input);
}
/** Lax read: a kind this build doesn't know reads as a reminder at its time. */
export function normalizeTaskReminderKind(input: unknown): TaskReminderKind {
  return isTaskReminderKind(input) ? input : "at";
}

/** How a repeat counts its next occurrence (REPLAN 27 b): by its rule, or
 *  from the day it was done ("after_completion"; no value = by the rule).
 *  Postgres: tasks__recurrence_problem accepts only these. */
export const RECURRENCE_MODES = ["after_completion"] as const;
export type RecurrenceMode = (typeof RECURRENCE_MODES)[number];
export const recurrenceModeSchema = z.enum(RECURRENCE_MODES);
export function isRecurrenceMode(value: unknown): value is RecurrenceMode {
  return typeof value === "string" && (RECURRENCE_MODES as readonly string[]).includes(value);
}
export function parseRecurrenceMode(input: unknown): SafeParseResult<RecurrenceMode> {
  return parseOrError(recurrenceModeSchema, input);
}
/** Lax read: an unknown mode reads as "by the rule" (undefined). */
export function normalizeRecurrenceMode(input: unknown): RecurrenceMode | undefined {
  return isRecurrenceMode(input) ? input : undefined;
}

/** What a notice to a person's devices is about (TV-D12, `notice_deliveries.kind`):
 *  a reminder, or an agent's needs you · ready for review · failed (TV-D16). */
export const NOTICE_DELIVERY_KINDS = ["reminder", "agent"] as const;
export type NoticeDeliveryKind = (typeof NOTICE_DELIVERY_KINDS)[number];
export const noticeDeliveryKindSchema = z.enum(NOTICE_DELIVERY_KINDS);
export function isNoticeDeliveryKind(value: unknown): value is NoticeDeliveryKind {
  return typeof value === "string" && (NOTICE_DELIVERY_KINDS as readonly string[]).includes(value);
}
export function parseNoticeDeliveryKind(input: unknown): SafeParseResult<NoticeDeliveryKind> {
  return parseOrError(noticeDeliveryKindSchema, input);
}
/** Lax read: an unknown kind reads as a reminder (a plain notice about a task). */
export function normalizeNoticeDeliveryKind(input: unknown): NoticeDeliveryKind {
  return isNoticeDeliveryKind(input) ? input : "reminder";
}

/** An agent session's state (TV-D16, spec §12, §Assumptions #15): working,
 *  waiting on its person, ready for review, or failed. Postgres:
 *  `agent_sessions.state` CHECK and `tasks_op_agent_report`. */
export const AGENT_SESSION_STATES = ["working", "needs_you", "ready", "failed"] as const;
export type AgentSessionState = (typeof AGENT_SESSION_STATES)[number];
export const agentSessionStateSchema = z.enum(AGENT_SESSION_STATES);
export function isAgentSessionState(value: unknown): value is AgentSessionState {
  return typeof value === "string" && (AGENT_SESSION_STATES as readonly string[]).includes(value);
}
export function parseAgentSessionState(input: unknown): SafeParseResult<AgentSessionState> {
  return parseOrError(agentSessionStateSchema, input);
}
/** Lax read: a state this build doesn't know reads as working. */
export function normalizeAgentSessionState(input: unknown): AgentSessionState {
  return isAgentSessionState(input) ? input : "working";
}
/** The states that notify the person who started the agent (spec §13). */
export const AGENT_LOUD_STATES = ["needs_you", "ready", "failed"] as const satisfies readonly AgentSessionState[];

/** What an import run records for "Undo this import" (TV-D16, `import_rows`). */
export const IMPORT_ENTITY_TYPES = ["task", "bucket", "section"] as const;
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];
export const importEntityTypeSchema = z.enum(IMPORT_ENTITY_TYPES);
export function isImportEntityType(value: unknown): value is ImportEntityType {
  return typeof value === "string" && (IMPORT_ENTITY_TYPES as readonly string[]).includes(value);
}
export function parseImportEntityType(input: unknown): SafeParseResult<ImportEntityType> {
  return parseOrError(importEntityTypeSchema, input);
}
/** Lax read: a type this build doesn't know reads as null (the row is skipped). */
export function normalizeImportEntityType(input: unknown): ImportEntityType | null {
  return isImportEntityType(input) ? input : null;
}
/** What a run did to a row: made it, or updated it by its "imported from" key. */
export const IMPORT_ROW_ACTIONS = ["created", "updated"] as const;
export type ImportRowAction = (typeof IMPORT_ROW_ACTIONS)[number];
export const importRowActionSchema = z.enum(IMPORT_ROW_ACTIONS);
export function isImportRowAction(value: unknown): value is ImportRowAction {
  return typeof value === "string" && (IMPORT_ROW_ACTIONS as readonly string[]).includes(value);
}
export function parseImportRowAction(input: unknown): SafeParseResult<ImportRowAction> {
  return parseOrError(importRowActionSchema, input);
}
/** Lax read: an action this build doesn't know reads as "updated" (never undone). */
export function normalizeImportRowAction(input: unknown): ImportRowAction {
  return isImportRowAction(input) ? input : "updated";
}

/** What a Waiting on… entry waits on (default q): a person, an email thread,
 *  an agent (an API key) or free text. */
export const TASK_WAITING_KINDS = ["person", "email", "agent", "text"] as const;
export type TaskWaitingKind = (typeof TASK_WAITING_KINDS)[number];
export const taskWaitingKindSchema = z.enum(TASK_WAITING_KINDS);
export function isTaskWaitingKind(value: unknown): value is TaskWaitingKind {
  return typeof value === "string" && (TASK_WAITING_KINDS as readonly string[]).includes(value);
}
export function parseTaskWaitingKind(input: unknown): SafeParseResult<TaskWaitingKind> {
  return parseOrError(taskWaitingKindSchema, input);
}
/** Lax read: a kind this build doesn't know reads as free text. */
export function normalizeTaskWaitingKind(input: unknown): TaskWaitingKind {
  return isTaskWaitingKind(input) ? input : "text";
}

/**
 * What a grant feed row names (`access_changes.resource_type`, TV-D11b): a
 * project (`bucket`) or a task shared or unshared, a task moved project, or a
 * member's role in the `workspace` changed.
 */
export const ACCESS_CHANGE_RESOURCES = ["bucket", "task", "workspace"] as const;
export type AccessChangeResource = (typeof ACCESS_CHANGE_RESOURCES)[number];
export const accessChangeResourceSchema = z.enum(ACCESS_CHANGE_RESOURCES);
export function isAccessChangeResource(value: unknown): value is AccessChangeResource {
  return (
    typeof value === "string" && (ACCESS_CHANGE_RESOURCES as readonly string[]).includes(value)
  );
}
export function parseAccessChangeResource(input: unknown): SafeParseResult<AccessChangeResource> {
  return parseOrError(accessChangeResourceSchema, input);
}
/** Lax read: a resource this build doesn't know reads as the whole workspace (check everything). */
export function normalizeAccessChangeResource(input: unknown): AccessChangeResource {
  return isAccessChangeResource(input) ? input : "workspace";
}

/**
 * The hard-delete tables whose deletes leave a `sync_tombstones` row
 * (TV-D11b), so the shared store reads their changes instead of all of them.
 */
export const SYNC_TOMBSTONE_TABLES = ["task_queue", "tag_links", "task_relations"] as const;
export type SyncTombstoneTable = (typeof SYNC_TOMBSTONE_TABLES)[number];
export const syncTombstoneTableSchema = z.enum(SYNC_TOMBSTONE_TABLES);
export function isSyncTombstoneTable(value: unknown): value is SyncTombstoneTable {
  return typeof value === "string" && (SYNC_TOMBSTONE_TABLES as readonly string[]).includes(value);
}
export function parseSyncTombstoneTable(input: unknown): SafeParseResult<SyncTombstoneTable> {
  return parseOrError(syncTombstoneTableSchema, input);
}
/** Lax read: a table this build doesn't know isn't one it keeps (null). */
export function normalizeSyncTombstoneTable(input: unknown): SyncTombstoneTable | null {
  return isSyncTombstoneTable(input) ? input : null;
}

export const ENERGY_LEVELS = ["low", "medium", "high"] as const;
export type EnergyLevel = (typeof ENERGY_LEVELS)[number];
export const energyLevelSchema = z.enum(ENERGY_LEVELS);

export const PRIORITY_LEVELS = ["low", "medium", "high"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];
export const priorityLevelSchema = z.enum(PRIORITY_LEVELS);

// ---------------------------------------------------------------------------
// Activity actor — mirrors CHECK in 20260612150000_module_activity_intent_ops.
// ---------------------------------------------------------------------------

export const ACTIVITY_ACTOR_TYPES = ["user", "agent", "api_key"] as const;
export type ActivityActorType = (typeof ACTIVITY_ACTOR_TYPES)[number];
export const activityActorTypeSchema = z.enum(ACTIVITY_ACTOR_TYPES);

// ---------------------------------------------------------------------------
// Spine links — mirrors CHECK constraints in 20260625120000_spine_entity_links.
// The kind drives hub grouping and roll-up phrasing; hyphenated tokens are the
// wire format. Adding a kind is a schema change (a migration), never runtime.
// NOTE: polymorphic entity_type stays an OPEN string by design (no schema here).
// ---------------------------------------------------------------------------

export const RELATION_KINDS = [
  "references", // default — a gesture that implies no stronger kind
  "spawned-from", // this was created out of that (email → task, task → note)
  "blocks", // dependency edge (blocker → blocked); Tasks' blocked-by rides this
  "attachment", // a file/email/payment attached to an entity
  "mentions", // an @mention of an entity inside prose
  "works-at", // person → company
  "follow-up", // a follow-up owed on an entity
  "paid-by", // an invoice/payment → the contact who paid it
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];
export const relationKindSchema = z.enum(RELATION_KINDS);
export function isRelationKind(value: unknown): value is RelationKind {
  return typeof value === "string" && (RELATION_KINDS as readonly string[]).includes(value);
}
/** Read-side normalization: unknown kinds degrade to the default "references". */
export function normalizeRelationKind(input: unknown): RelationKind {
  return isRelationKind(input) ? input : "references";
}

export const LINK_ORIGINS = ["manual", "drag", "mention", "ref", "suggest"] as const;
export type LinkOrigin = (typeof LINK_ORIGINS)[number];
export const linkOriginSchema = z.enum(LINK_ORIGINS);
export function isLinkOrigin(value: unknown): value is LinkOrigin {
  return typeof value === "string" && (LINK_ORIGINS as readonly string[]).includes(value);
}
/** Read-side normalization: unknown origins degrade to the default "manual". */
export function normalizeLinkOrigin(input: unknown): LinkOrigin {
  return isLinkOrigin(input) ? input : "manual";
}

// ---------------------------------------------------------------------------
// Contacts — mirrors CHECK in 20260628140000_contacts_v2 (contact_field_defs).
// NOTE: ContactStatus is user-renamable and stays an OPEN string (no schema).
// ---------------------------------------------------------------------------

export const CONTACT_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "multi_select",
  "url",
  "checkbox",
] as const;
export type ContactFieldType = (typeof CONTACT_FIELD_TYPES)[number];
export const contactFieldTypeSchema = z.enum(CONTACT_FIELD_TYPES);

// ---------------------------------------------------------------------------
// Workspace roles & module permissions — TWO vocabularies with ONE bridge.
//
// App:    role ∈ {owner, admin, editor, viewer} · perm ∈ {none, view, edit, admin}
// DB:     role ∈ {owner, admin, member, viewer} · perm ∈ {read, write, none}
//         (workspace_members CHECK constraints, verified live DF-24)
//
// The bridge FUNCTIONS live ONLY in src/features/workspaces/workspace-mappers.ts
// (normalizeMemberRole / toMemberRole / memberPermToModulePermission /
// toMemberPerm) — do not invent a second translation layer. These arrays are
// the shared value source those functions (and these schemas) are built on.
// ---------------------------------------------------------------------------

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export const MEMBER_DB_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberDbRole = (typeof MEMBER_DB_ROLES)[number];
export const memberDbRoleSchema = z.enum(MEMBER_DB_ROLES);
export function isMemberDbRole(value: unknown): value is MemberDbRole {
  return typeof value === "string" && (MEMBER_DB_ROLES as readonly string[]).includes(value);
}

export const MODULE_PERMISSIONS = ["none", "view", "edit", "admin"] as const;
export type ModulePermission = (typeof MODULE_PERMISSIONS)[number];
export const modulePermissionSchema = z.enum(MODULE_PERMISSIONS);

export const MEMBER_DB_PERMISSIONS = ["read", "write", "none"] as const;
export type MemberDbPermission = (typeof MEMBER_DB_PERMISSIONS)[number];
export const memberDbPermissionSchema = z.enum(MEMBER_DB_PERMISSIONS);

/**
 * Workspace permission keys (PERM-1, specs/permissions.md). A role is a set of
 * these; a member's personal exceptions allow/block single keys on top of it.
 * Mirrors public.perm_all_keys() — same members, same order (the order drives
 * the settings matrix). `<module>.<action>` for modules, `ws.<power>` for the
 * workspace powers.
 */
export const PERMISSION_MODULES = ["notes", "tasks", "calendar", "contacts", "chat"] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];
export const PERMISSION_ACTIONS = ["view", "create", "edit", "delete"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];
export const WORKSPACE_POWERS = [
  "invite",
  "manage_members",
  "manage_roles",
  "publish",
  "api_keys",
] as const;
export type WorkspacePower = (typeof WORKSPACE_POWERS)[number];
export type PermissionKey = `${PermissionModule}.${PermissionAction}` | `ws.${WorkspacePower}`;
export const PERMISSION_KEYS: readonly PermissionKey[] = [
  ...PERMISSION_MODULES.flatMap((m) => PERMISSION_ACTIONS.map((a) => `${m}.${a}` as const)),
  ...WORKSPACE_POWERS.map((p) => `ws.${p}` as const),
];
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
}
/** System role keys seeded for every workspace (`workspace_roles.system_key`). */
export const SYSTEM_ROLE_KEYS = ["admin", "member", "viewer"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];
export function isSystemRoleKey(value: unknown): value is SystemRoleKey {
  return typeof value === "string" && (SYSTEM_ROLE_KEYS as readonly string[]).includes(value);
}

/**
 * Per-thing sharing (PERM-3…8). Mirrors resource_grants CHECKs in
 * 20261006210000_perm_sharing.sql. `freebusy` is calendars only.
 */
export const GRANT_LEVELS = ["freebusy", "view", "edit", "full"] as const;
export type GrantLevel = (typeof GRANT_LEVELS)[number];
export const grantLevelSchema = z.enum(GRANT_LEVELS);
export function isGrantLevel(value: unknown): value is GrantLevel {
  return typeof value === "string" && (GRANT_LEVELS as readonly string[]).includes(value);
}

export const SHARE_RESOURCE_TYPES = [
  "note",
  "bucket",
  "task",
  "calendar",
  "contact",
  "contact_group",
  "channel",
] as const;
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];
export function isShareResourceType(value: unknown): value is ShareResourceType {
  return typeof value === "string" && (SHARE_RESOURCE_TYPES as readonly string[]).includes(value);
}

export const GRANT_SUBJECT_TYPES = ["member", "workspace", "public_link"] as const;
export type GrantSubjectType = (typeof GRANT_SUBJECT_TYPES)[number];

/**
 * Where a grant came from (`resource_grants.origin`, CHECK in
 * 20261010141712_tighten_write_checks.sql). `assign` grants come and go with a
 * task's assignee; `manual` ones are shares set by hand and are never revoked
 * by reassigning.
 */
export const GRANT_ORIGINS = ["assign", "manual"] as const;
export type GrantOrigin = (typeof GRANT_ORIGINS)[number];
export const grantOriginSchema = z.enum(GRANT_ORIGINS);
export function isGrantOrigin(value: unknown): value is GrantOrigin {
  return typeof value === "string" && (GRANT_ORIGINS as readonly string[]).includes(value);
}

/** Workspace default for a new container. `private` writes no workspace grant. */
export const SHARE_DEFAULT_LEVELS = ["private", "freebusy", "view", "edit", "full"] as const;
export type ShareDefaultLevel = (typeof SHARE_DEFAULT_LEVELS)[number];

export const CHAT_CAPABILITIES = [
  "create_public",
  "create_private",
  "manage_any",
  "delete_others",
  "mention_everyone",
  "post",
  "start_calls",
] as const;
export type ChatCapability = (typeof CHAT_CAPABILITIES)[number];

/**
 * MCP connector key scopes — a SEPARATE vocabulary from workspace permissions
 * on purpose: `admin` is never key-grantable, and the scope map is per-module.
 * Mirrors moduleScope() in supabase/functions/moduo-mcp/registry.ts.
 */
export const MCP_KEY_SCOPES = ["none", "view", "edit"] as const;
export type McpKeyScope = (typeof MCP_KEY_SCOPES)[number];
export const mcpKeyScopeSchema = z.enum(MCP_KEY_SCOPES);
export function isMcpKeyScope(value: unknown): value is McpKeyScope {
  return typeof value === "string" && (MCP_KEY_SCOPES as readonly string[]).includes(value);
}
/** Key-scope normalization: case-insensitive view/edit; anything else → none. */
export function normalizeMcpKeyScope(input: unknown): McpKeyScope {
  if (typeof input !== "string") return "none";
  const key = input.trim().toLowerCase();
  return key === "edit" || key === "view" ? key : "none";
}
/** Strict parse for write paths: exactly none / view / edit. */
export function parseMcpKeyScope(input: unknown): SafeParseResult<McpKeyScope> {
  return parseOrError(mcpKeyScopeSchema, input);
}

/**
 * The modules an MCP key is scoped by: the keys of workspace_api_keys.scopes,
 * in Settings → API keys order. Mirrors workspace_api_key_scopes_valid() (the
 * table's CHECK) in 20261008120000_workspace_api_keys_set_scopes.sql and the
 * modules the connector registers (supabase/functions/moduo-mcp/registry.ts).
 * `links` is the spine: search, links and comments across the other modules.
 */
export const MCP_KEY_MODULES = [
  "tasks",
  "notes",
  "calendar",
  "email",
  "contacts",
  "chat",
  "links",
] as const;
export type McpKeyModule = (typeof MCP_KEY_MODULES)[number];
export const mcpKeyModuleSchema = z.enum(MCP_KEY_MODULES);
export function isMcpKeyModule(value: unknown): value is McpKeyModule {
  return typeof value === "string" && (MCP_KEY_MODULES as readonly string[]).includes(value);
}

/** A key's access with every module spelled out. */
export type McpKeyScopes = Record<McpKeyModule, McpKeyScope>;
/** Every module present, each exactly none / view / edit (Zod 4 enum-keyed records are exhaustive). */
export const mcpKeyScopesSchema = z.record(mcpKeyModuleSchema, mcpKeyScopeSchema);
/**
 * Read a stored (or partial) scope map as a full one. Absent, unknown and
 * `admin` levels read as none, which is what the connector grants them;
 * modules outside MCP_KEY_MODULES are dropped.
 */
export function normalizeMcpKeyScopes(input: unknown): McpKeyScopes {
  const raw =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    MCP_KEY_MODULES.map((module) => [module, normalizeMcpKeyScope(raw[module])]),
  ) as McpKeyScopes;
}
/** Strict parse for the create / set-scopes payload: every module, nothing else. */
export function parseMcpKeyScopes(input: unknown): SafeParseResult<McpKeyScopes> {
  return parseOrError(mcpKeyScopesSchema, input) as SafeParseResult<McpKeyScopes>;
}

// ---------------------------------------------------------------------------
// Workspace invites — the status set on workspace_invites.
// ---------------------------------------------------------------------------

export const INVITE_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];
export const inviteStatusSchema = z.enum(INVITE_STATUSES);

// ---------------------------------------------------------------------------
// Landing waitlist — public.waitlist.source / .status (CHECKs in
// 20261010155652_tx4_invite_only_gate.sql; the join function's source list in
// 20261001170000_waitlist_footer_source.sql).
// ---------------------------------------------------------------------------

/** The landing CTAs a person can join from: what `waitlist-join` / `waitlist_join()` accept. */
export const WAITLIST_SOURCES = ["nav", "hero", "close", "footer"] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];
export const waitlistSourceSchema = z.enum(WAITLIST_SOURCES);

export function isWaitlistSource(input: unknown): input is WaitlistSource {
  return waitlistSourceSchema.safeParse(input).success;
}

/**
 * Every source a waitlist row can have (the CHECK): the landing CTAs plus
 * `manual`, a person invited by `waitlist_invite_email()` without joining
 * (TX-4). Never accepted from the landing.
 */
export const WAITLIST_ROW_SOURCES = [...WAITLIST_SOURCES, "manual"] as const;
export type WaitlistRowSource = (typeof WAITLIST_ROW_SOURCES)[number];
export const waitlistRowSourceSchema = z.enum(WAITLIST_ROW_SOURCES);

/** `invited` (TX-4): the person may sign up; set in the dashboard or by the waitlist_invite_* helpers. */
export const WAITLIST_STATUSES = ["pending", "confirmed", "cancelled", "invited"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];
export const waitlistStatusSchema = z.enum(WAITLIST_STATUSES);

// ---------------------------------------------------------------------------
// Transactional email — every kind of email Moduo sends (specs/transactional-
// email.md T11). Defined in full up front so the TX blocks don't collide on
// this file; the email_outbox CHECK is in 20261008160000_email_outbox.sql (TX-2). The order
// follows the catalog (A1…E2), then the internal ops alert.
// ---------------------------------------------------------------------------

export const EMAIL_KINDS = [
  "auth_code",
  "account_deleted",
  "waitlist_invite",
  "updates_confirm",
  "workspace_invite",
  "workspace_owner",
  "workspace_removed",
  "booking_guest_confirmed",
  "booking_guest_added",
  "booking_host_new",
  "booking_host_guest_cancelled",
  "booking_guest_cancelled",
  "booking_guest_host_cancelled",
  "booking_guest_reminder",
  "welcome",
  "trial_ending",
  "trial_ended",
  "founder_access",
  "founder_access_ending",
  "announcement",
  "build_update",
  "ops_alert",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export const emailKindSchema = z.enum(EMAIL_KINDS);

export function isEmailKind(input: unknown): input is EmailKind {
  return emailKindSchema.safeParse(input).success;
}

/**
 * Booking links' "Remind guests" (TX-6): minutes before the meeting. Off is
 * NULL in `exposed_slot_links.guest_reminder_minutes`; the CHECK lists these.
 */
export const GUEST_REMINDER_MINUTES = [60, 1440] as const;
export type GuestReminderMinute = (typeof GUEST_REMINDER_MINUTES)[number];
export const guestReminderMinuteSchema = z.union([z.literal(60), z.literal(1440)]);

export function isGuestReminderMinute(input: unknown): input is GuestReminderMinute {
  return guestReminderMinuteSchema.safeParse(input).success;
}

/** Strict, for writes: a saved reminder or null (off); anything else throws. */
export function parseGuestReminderMinutes(input: unknown): GuestReminderMinute | null {
  if (input === null) return null;
  return guestReminderMinuteSchema.parse(input);
}

/** Lax, for reads: null stays off, an unknown or missing value reads as the 24-hour default. */
export function normalizeGuestReminderMinutes(input: unknown): GuestReminderMinute | null {
  if (input === null) return null;
  return isGuestReminderMinute(input) ? input : 1440;
}

/**
 * Which sender and reputation an email goes out on (T2): the account stream
 * from hello@moduo.app, build updates from updates@news.moduo.app. CHECK on
 * public.email_outbox.stream (20261008160000_email_outbox.sql).
 */
export const EMAIL_STREAMS = ["account", "updates"] as const;
export type EmailStream = (typeof EMAIL_STREAMS)[number];
export const emailStreamSchema = z.enum(EMAIL_STREAMS);

export function isEmailStream(input: unknown): input is EmailStream {
  return emailStreamSchema.safeParse(input).success;
}

/**
 * Where one email_outbox row stands (T10). TX-2 writes only `sent` and
 * `failed` (sign-in codes are sent before they're logged); the queue states
 * arrive with the worker in TX-3. CHECK on public.email_outbox.status.
 */
export const EMAIL_OUTBOX_STATUSES = [
  "queued",
  "sending",
  "sent",
  "failed",
  "cancelled",
  "suppressed",
  "skipped_pref",
] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];
export const emailOutboxStatusSchema = z.enum(EMAIL_OUTBOX_STATUSES);

export function isEmailOutboxStatus(input: unknown): input is EmailOutboxStatus {
  return emailOutboxStatusSchema.safeParse(input).success;
}

/**
 * Why an address gets no more email (T13): a hard bounce or a spam complaint
 * reported by Resend's webhook, or added by hand. CHECK on
 * public.email_suppressions.reason (20261008233000_email_outbox_worker.sql).
 */
export const EMAIL_SUPPRESSION_REASONS = ["bounce", "complaint", "manual"] as const;
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];
export const emailSuppressionReasonSchema = z.enum(EMAIL_SUPPRESSION_REASONS);

export function isEmailSuppressionReason(input: unknown): input is EmailSuppressionReason {
  return emailSuppressionReasonSchema.safeParse(input).success;
}

/**
 * Build-updates subscriptions (T21), public.email_subscriptions. TX-4 creates
 * the table so a waitlist person's build-updates request survives their
 * sign-up (AC22); TX-8 and TX-10 add confirming, Settings and unsubscribing.
 * CHECKs in 20261010155652_tx4_invite_only_gate.sql.
 */
export const EMAIL_SUBSCRIPTION_TOPICS = ["build_updates"] as const;
export type EmailSubscriptionTopic = (typeof EMAIL_SUBSCRIPTION_TOPICS)[number];
export const emailSubscriptionTopicSchema = z.enum(EMAIL_SUBSCRIPTION_TOPICS);

export const EMAIL_SUBSCRIPTION_STATUSES = ["pending", "subscribed", "unsubscribed"] as const;
export type EmailSubscriptionStatus = (typeof EMAIL_SUBSCRIPTION_STATUSES)[number];
export const emailSubscriptionStatusSchema = z.enum(EMAIL_SUBSCRIPTION_STATUSES);

export const EMAIL_SUBSCRIPTION_SOURCES = ["waitlist", "settings"] as const;
export type EmailSubscriptionSource = (typeof EMAIL_SUBSCRIPTION_SOURCES)[number];
export const emailSubscriptionSourceSchema = z.enum(EMAIL_SUBSCRIPTION_SOURCES);

// ---------------------------------------------------------------------------
// Email accounts — provider/status vocabularies.
//
// DRIFT NOTE (live resolution): the 20260704170000_email_module migration
// COMMENT says provider ∈ {'gmail','icloud','imap','outlook'}, but there is NO
// CHECK constraint and the code vocabulary has always been
// {gmail, outlook, icloud, custom} (src/features/email/model/email-types.ts and
// Rust normalize_provider in account_config.rs agree). "imap" is the legacy
// comment spelling; the canonical generic-IMAP value is "custom".
// NOTE: IMAP folder names are user-owned — OPEN strings, no schema here.
// ---------------------------------------------------------------------------

export const EMAIL_PROVIDERS = ["gmail", "outlook", "icloud", "custom"] as const;
export type MailboxProvider = (typeof EMAIL_PROVIDERS)[number];
export const mailboxProviderSchema = z.enum(EMAIL_PROVIDERS);
export function isMailboxProvider(value: unknown): value is MailboxProvider {
  return typeof value === "string" && (EMAIL_PROVIDERS as readonly string[]).includes(value);
}

/** Legacy spellings accepted on read, normalized to the canonical provider. */
const EMAIL_PROVIDER_LEGACY: Record<string, MailboxProvider> = {
  imap: "custom",
};

/**
 * Read-side bridge: known providers pass through, "imap" → "custom", and
 * unknown values fall back to "custom" (the generic IMAP case — matches the
 * Rust account_id host fallback; the Rust write path still REJECTS unknown).
 */
export function normalizeEmailProvider(input: unknown): MailboxProvider {
  if (typeof input !== "string") return "custom";
  const key = input.trim().toLowerCase();
  if (isMailboxProvider(key)) return key;
  return EMAIL_PROVIDER_LEGACY[key] ?? "custom";
}

export const EMAIL_ACCOUNT_STATUSES = ["active", "reauth_required", "error"] as const;
export type EmailAccountStatus = (typeof EMAIL_ACCOUNT_STATUSES)[number];
export const emailAccountStatusSchema = z.enum(EMAIL_ACCOUNT_STATUSES);

export const CONNECTION_STATUSES = ["disconnected", "connecting", "connected"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);

// ---------------------------------------------------------------------------
// Calendar accounts — provider/status vocabularies.
//
// LIVE DATA RESOLUTION: `moduo` is the built-in Moduo calendar provider
// (stored rows, runtime.types.ts), `ics` is a current feed provider written by
// caldav-connect (the 20260702130000 migration comment predates CAL-8 and
// omits it). Both are intentional members of the canonical set — not legacy
// spellings. There is NO CHECK constraint on provider (text + stale comment).
// ---------------------------------------------------------------------------

export const CALENDAR_PROVIDERS = ["google", "microsoft", "caldav", "ics", "moduo"] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];
export const calendarProviderSchema = z.enum(CALENDAR_PROVIDERS);
export function isCalendarProvider(value: unknown): value is CalendarProvider {
  return typeof value === "string" && (CALENDAR_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Read-side recognition: known providers (incl. stored `moduo` rows and
 * current `ics` rows) pass through; unknown returns NULL so the caller can
 * intentionally skip/fall back rather than silently mislabeling a row.
 */
export function normalizeCalendarProvider(input: unknown): CalendarProvider | null {
  return isCalendarProvider(input) ? input : null;
}

/** Providers the desktop sync engine can fetch (everything except built-in `moduo`). */
export const SYNCABLE_PROVIDERS = ["google", "microsoft", "caldav", "ics"] as const;
export type SyncableProvider = (typeof SYNCABLE_PROVIDERS)[number];
export const syncableProviderSchema = z.enum(SYNCABLE_PROVIDERS);

export const CALENDAR_ACCOUNT_STATUSES = ["ok", "error"] as const;
export type CalendarAccountStatus = (typeof CALENDAR_ACCOUNT_STATUSES)[number];
export const calendarAccountStatusSchema = z.enum(CALENDAR_ACCOUNT_STATUSES);

// ---------------------------------------------------------------------------
// Subscription status — Stripe-OWNED vocabulary (bounded, documented set).
// Kept as a known set + strict schema for write paths; display code passes
// unknown provider values through (a new Stripe status must never render as
// "none"). Stripe EVENT NAMES stay open strings (no schema — provider-owned).
// ---------------------------------------------------------------------------

export const KNOWN_SUBSCRIPTION_STATUSES = [
  "none", // local: no subscription row / no customer
  "trialing",
  "active",
  "canceled",
  "past_due",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
] as const;
export type KnownSubscriptionStatus = (typeof KNOWN_SUBSCRIPTION_STATUSES)[number];
export const knownSubscriptionStatusSchema = z.enum(KNOWN_SUBSCRIPTION_STATUSES);
export function isKnownSubscriptionStatus(value: unknown): value is KnownSubscriptionStatus {
  return (
    typeof value === "string" && (KNOWN_SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Chat — mirrors the CHECKs in 20261006150000_chat_module (chat_channels.kind,
// chat_members.notify_level). Gated by the workspace owner's plan rank ≥ duo.
// ---------------------------------------------------------------------------

export const CHAT_CHANNEL_KINDS = ["channel", "dm"] as const;
export type ChatChannelKind = (typeof CHAT_CHANNEL_KINDS)[number];
export const chatChannelKindSchema = z.enum(CHAT_CHANNEL_KINDS);
export function isChatChannelKind(value: unknown): value is ChatChannelKind {
  return typeof value === "string" && (CHAT_CHANNEL_KINDS as readonly string[]).includes(value);
}

export const CHAT_NOTIFY_LEVELS = ["all", "mentions", "none"] as const;
export type ChatNotifyLevel = (typeof CHAT_NOTIFY_LEVELS)[number];
export const chatNotifyLevelSchema = z.enum(CHAT_NOTIFY_LEVELS);
export function isChatNotifyLevel(value: unknown): value is ChatNotifyLevel {
  return typeof value === "string" && (CHAT_NOTIFY_LEVELS as readonly string[]).includes(value);
}
/** Read-side normalization: an unknown level degrades to the quiet default. */
export function normalizeChatNotifyLevel(input: unknown): ChatNotifyLevel {
  return isChatNotifyLevel(input) ? input : "mentions";
}
/** Strict parse for write paths. */
export function parseChatNotifyLevel(input: unknown): SafeParseResult<ChatNotifyLevel> {
  return parseOrError(chatNotifyLevelSchema, input);
}

/** Plans whose workspaces get chat (mirrors public.chat_workspace_enabled: rank ≥ duo). */
export const CHAT_PLAN_TIERS = ["duo", "team", "founder"] as const satisfies readonly PlanTier[];
export function planHasChat(tier: unknown): boolean {
  return (CHAT_PLAN_TIERS as readonly string[]).includes(normalizePlanTier(tier));
}

// ---------------------------------------------------------------------------
// Content authors — who wrote a chat message, a comment or a note update.
// Mirrors chat_messages_author_kind_check (20261006160000_chat_agent_access),
// comments_author_kind_check (20261008123000_key_writes_act_as_creator) and
// note_updates_origin_check (20261014120000_notes_agent_writes, NR-6).
// `api_key` = an app over MCP, shown by the key's name and marked as an app
// (an "App" badge in chat, "<key name> (app)" on a comment), never as a person.
// ---------------------------------------------------------------------------

export const CONTENT_AUTHOR_KINDS = ["user", "api_key"] as const;
export type ContentAuthorKind = (typeof CONTENT_AUTHOR_KINDS)[number];
export const contentAuthorKindSchema = z.enum(CONTENT_AUTHOR_KINDS);
export function isContentAuthorKind(value: unknown): value is ContentAuthorKind {
  return typeof value === "string" && (CONTENT_AUTHOR_KINDS as readonly string[]).includes(value);
}
/** Read-side normalization: rows written before the column existed are a person's. */
export function normalizeContentAuthorKind(input: unknown): ContentAuthorKind {
  return isContentAuthorKind(input) ? input : "user";
}

// ---------------------------------------------------------------------------
// Comment reactions (TV-U13, REPLAN 88) — mirrors comment_reactions.reaction's
// CHECK and comments_op_react in 20261013100000_comment_reactions_edits. Six,
// fixed, in this order: 👍 ✅ 👀 🙏 ❤️ 😄. Nobody adds their own, and a
// reaction never notifies anyone.
// ---------------------------------------------------------------------------

export const COMMENT_REACTIONS = ["thumbs_up", "check", "eyes", "pray", "heart", "smile"] as const;
export type CommentReaction = (typeof COMMENT_REACTIONS)[number];
export const commentReactionSchema = z.enum(COMMENT_REACTIONS);
export function isCommentReaction(value: unknown): value is CommentReaction {
  return typeof value === "string" && (COMMENT_REACTIONS as readonly string[]).includes(value);
}
export function parseCommentReaction(input: unknown): SafeParseResult<CommentReaction> {
  return parseOrError(commentReactionSchema, input);
}
/** Lax read: a reaction this build doesn't know is left out (null), never shown wrong. */
export function normalizeCommentReaction(input: unknown): CommentReaction | null {
  return isCommentReaction(input) ? input : null;
}

// ---------------------------------------------------------------------------
// Templates (TV-D15, REPLAN 9 and 79) — mirrors the op guards in
// 20261013160000_templates.sql. A template is a task template or a project
// template (two tables, one `templates_op_update(…, p_kind, …)`); what a
// template's task keeps a link to is a lasting thing only: a note or a
// contact (emails and events belong to one run of the work).
// ---------------------------------------------------------------------------

export const TEMPLATE_KINDS = ["task", "project"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const templateKindSchema = z.enum(TEMPLATE_KINDS);
export function isTemplateKind(value: unknown): value is TemplateKind {
  return typeof value === "string" && (TEMPLATE_KINDS as readonly string[]).includes(value);
}
export function parseTemplateKind(input: unknown): SafeParseResult<TemplateKind> {
  return parseOrError(templateKindSchema, input);
}
/** Lax read: a kind this build doesn't know is left out (null). */
export function normalizeTemplateKind(input: unknown): TemplateKind | null {
  return isTemplateKind(input) ? input : null;
}

export const TEMPLATE_LINK_TYPES = ["note", "contact"] as const;
export type TemplateLinkType = (typeof TEMPLATE_LINK_TYPES)[number];
export const templateLinkTypeSchema = z.enum(TEMPLATE_LINK_TYPES);
export function isTemplateLinkType(value: unknown): value is TemplateLinkType {
  return typeof value === "string" && (TEMPLATE_LINK_TYPES as readonly string[]).includes(value);
}
export function parseTemplateLinkType(input: unknown): SafeParseResult<TemplateLinkType> {
  return parseOrError(templateLinkTypeSchema, input);
}
/** Lax read: a link to anything else is dropped (null). */
export function normalizeTemplateLinkType(input: unknown): TemplateLinkType | null {
  return isTemplateLinkType(input) ? input : null;
}

// ---------------------------------------------------------------------------
// Starter templates (TV-U17, REPLAN 34) — mirrors the key guard of
// project_templates_op_starter in 20261013230000_templates_starter. The role
// question offers one of these; the server builds its body from the key, so
// the app never sends one.
// ---------------------------------------------------------------------------

export const STARTER_TEMPLATES = ["kickoff", "monthly_close", "client_onboarding", "episode"] as const;
export type StarterTemplate = (typeof STARTER_TEMPLATES)[number];
export const starterTemplateSchema = z.enum(STARTER_TEMPLATES);
export function isStarterTemplate(value: unknown): value is StarterTemplate {
  return typeof value === "string" && (STARTER_TEMPLATES as readonly string[]).includes(value);
}
export function parseStarterTemplate(input: unknown): SafeParseResult<StarterTemplate> {
  return parseOrError(starterTemplateSchema, input);
}
/** Lax read: a starter this build doesn't know is left out (null). */
export function normalizeStarterTemplate(input: unknown): StarterTemplate | null {
  return isStarterTemplate(input) ? input : null;
}

// ---------------------------------------------------------------------------
// Onboarding roles (TV-U17, REPLAN §3) — the answers to "What will you run in
// Moduo?". Kept only in the synced preferences JSON
// (user_preferences.tasks_onboarding.role), never in a column, so there is no
// Postgres CHECK to mirror. A role sets defaults only (src/features/tasks/
// onboarding.ts ROLE_DEFAULTS); an unknown one reads as no answer.
// ---------------------------------------------------------------------------

export const TASKS_ROLES = [
  "student",
  "developer",
  "pm",
  "founder",
  "client_work",
  "creator",
] as const;
export type TasksRole = (typeof TASKS_ROLES)[number];
export const tasksRoleSchema = z.enum(TASKS_ROLES);
export function isTasksRole(value: unknown): value is TasksRole {
  return typeof value === "string" && (TASKS_ROLES as readonly string[]).includes(value);
}
export function parseTasksRole(input: unknown): SafeParseResult<TasksRole> {
  return parseOrError(tasksRoleSchema, input);
}
/** Lax read: a role this build doesn't know reads as no answer (null). */
export function normalizeTasksRole(input: unknown): TasksRole | null {
  return isTasksRole(input) ? input : null;
}

// ---------------------------------------------------------------------------
// Saved views (TV-U8, REPLAN 29d) — mirrors the CHECK on task_views.scope and
// task_views_op_create's guard in <stamp>_task_views. A view keeps one base
// scope: All, My tasks, Upcoming (each reader's own) or one project. Focus
// has no Filter or Display, and the Inbox is each person's own place.
// ---------------------------------------------------------------------------

export const TASK_VIEW_SCOPES = ["all", "mine", "upcoming", "project"] as const;
export type TaskViewScope = (typeof TASK_VIEW_SCOPES)[number];
export const taskViewScopeSchema = z.enum(TASK_VIEW_SCOPES);
export function isTaskViewScope(value: unknown): value is TaskViewScope {
  return typeof value === "string" && (TASK_VIEW_SCOPES as readonly string[]).includes(value);
}
export function parseTaskViewScope(input: unknown): SafeParseResult<TaskViewScope> {
  return parseOrError(taskViewScopeSchema, input);
}
/** Lax read: a scope this build doesn't know drops the view (null). */
export function normalizeTaskViewScope(input: unknown): TaskViewScope | null {
  return isTaskViewScope(input) ? input : null;
}

/**
 * The Filter dimensions a saved view may keep (mirrors
 * task_views__check_filters). An id dimension holds "none" or the id of a
 * person, team or tag of the same workspace, or of a project the saver can
 * see (Project also takes "inbox", each reader's own; MOD-141); a word
 * dimension holds short words. The app's Filter offers exactly these
 * (TASK_FILTER_DIMENSIONS in features/tasks/filters.ts, held to them by a
 * test).
 */
export const TASK_VIEW_ID_DIMENSIONS = ["assignee", "creator", "team", "tag", "project"] as const;
export const TASK_VIEW_WORD_DIMENSIONS = [
  "status",
  "completed",
  "priority",
  "energy",
  "due",
  "scheduled",
  "queued",
  "blocked",
  "waiting",
  "recurring",
  "subtasks",
  "attachments",
] as const;
export type TaskViewFilterDimension =
  | (typeof TASK_VIEW_ID_DIMENSIONS)[number]
  | (typeof TASK_VIEW_WORD_DIMENSIONS)[number];

// ---------------------------------------------------------------------------
// Attachments (AT-1, specs/attachments.md) — mirrors the CHECKs on
// public.attachments in 20261008210500_attachments_storage. `pending` = begun,
// bytes not confirmed yet; `ready` = finalize checked the stored size;
// `failed` = finalize refused it (size mismatch, over the limit) and the daily
// purge removes it. A deleted reason says what put the file in the trash:
// the person (`user`), its task (`task`), or a bucket deleted with its tasks
// (`bucket`, reserved for TV-U6). Previews are only ever these three formats.
// ---------------------------------------------------------------------------

export const ATTACHMENT_STATUSES = ["pending", "ready", "failed"] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];
export const attachmentStatusSchema = z.enum(ATTACHMENT_STATUSES);
export function isAttachmentStatus(value: unknown): value is AttachmentStatus {
  return typeof value === "string" && (ATTACHMENT_STATUSES as readonly string[]).includes(value);
}
/** Read-side normalization: anything unknown is treated as not ready. */
export function normalizeAttachmentStatus(input: unknown): AttachmentStatus {
  return isAttachmentStatus(input) ? input : "pending";
}

export const ATTACHMENT_DELETED_REASONS = ["user", "task", "bucket"] as const;
export type AttachmentDeletedReason = (typeof ATTACHMENT_DELETED_REASONS)[number];
export const attachmentDeletedReasonSchema = z.enum(ATTACHMENT_DELETED_REASONS);
export function isAttachmentDeletedReason(value: unknown): value is AttachmentDeletedReason {
  return (
    typeof value === "string" && (ATTACHMENT_DELETED_REASONS as readonly string[]).includes(value)
  );
}

export const ATTACHMENT_PREVIEW_MIMES = ["image/webp", "image/png", "image/jpeg"] as const;
export type AttachmentPreviewMime = (typeof ATTACHMENT_PREVIEW_MIMES)[number];
export const attachmentPreviewMimeSchema = z.enum(ATTACHMENT_PREVIEW_MIMES);
export function isAttachmentPreviewMime(value: unknown): value is AttachmentPreviewMime {
  return (
    typeof value === "string" && (ATTACHMENT_PREVIEW_MIMES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Label hues — the shared palette for workspace tags (and the hue a calendar
// or mail account shows). Each name maps 1:1 to a [data-label="…"] token in
// src/styles/tokens.css (§13b), so a stored hue stays token-routed and
// theme-safe. Stored as a name in tags.color (and in account prefs), read
// laxly: tags.color has no CHECK, and an unknown or missing value shows as
// the default hue. The app (src/components/tag-colors.ts re-exports these)
// and the MCP connector colour a new tag with the same rule (MOD-93).
// ---------------------------------------------------------------------------

export const LABEL_COLORS = ["blue", "green", "amber", "red", "violet", "teal", "pink", "gray"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];
export const labelColorSchema = z.enum(LABEL_COLORS);
export function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === "string" && (LABEL_COLORS as readonly string[]).includes(value);
}
export function parseLabelColor(input: unknown): SafeParseResult<LabelColor> {
  return parseOrError(labelColorSchema, input);
}

/** Used when a tag has no stored color, or an unknown one. */
export const DEFAULT_LABEL_COLOR: LabelColor = "gray";

/** Coerce any stored value to a known hue (fallback: {@link DEFAULT_LABEL_COLOR}). */
export function normalizeLabelColor(color: unknown): LabelColor {
  return isLabelColor(color) ? color : DEFAULT_LABEL_COLOR;
}

/**
 * Auto-assign a hue for a new tag: the least-used color among `existing`, with
 * ties broken by palette order. Deterministic (no randomness) so the same set of
 * tags always colors the same way, and colors spread evenly as tags accumulate.
 * `gray` is reserved as a fallback and only chosen once every hue is in use.
 */
export function pickTagColor(existing: ReadonlyArray<{ color: string | null }>): LabelColor {
  const counts = new Map<LabelColor, number>(LABEL_COLORS.map((c) => [c, 0]));
  for (const tag of existing) {
    const c = normalizeLabelColor(tag.color);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  // Prefer the colored hues; only fall back to gray when everything else is used
  // at least as much (it sorts last in LABEL_COLORS, so the tie-break handles it).
  let best: LabelColor = LABEL_COLORS[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const color of LABEL_COLORS) {
    const count = counts.get(color) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}
