/**
 * Pure list helpers for the Tasks connector (moduo-mcp/modules/tasks.ts).
 * No Deno or Supabase imports, so the app's test runner covers them
 * (MCC-1; tool catalog in docs/moduo-mcp-connector.md).
 */

import { isOpenTask, normalizeTaskStatusCategory } from "./contracts/vocabularies.ts";
import { assigneeIdOf, FORMER_MEMBER, taskPeople } from "./task-people.ts";

type Row = Record<string, any>;

export type Assignee = "me" | "anyone";

/** Unknown or missing values keep the old behavior (`anyone`). */
export function parseAssignee(value: unknown): Assignee {
  return value === "me" ? "me" : "anyone";
}

/**
 * "Mine" = assigned to the key's creator (`assignee_id`, TV-D1). `owner_id` is
 * the creator, not the assignee, and Unassigned tasks are nobody's.
 */
export function filterByAssignee<T extends Row>(tasks: T[], assignee: Assignee, userId: string): T[] {
  return assignee === "me" ? tasks.filter((t) => assigneeIdOf(t) === userId) : tasks;
}

/** A task is top-level when its parent is not in `inScope` (a subtask whose parent is filtered out stays visible, as in the app). */
export function topLevelOnly<T extends Row>(tasks: T[], inScope: Set<string>): T[] {
  return tasks.filter((t) => !t.parent_id || !inScope.has(t.parent_id));
}

/** Subtasks per parent, counting visible tasks; archived ones are left out, as in the app. */
export function subtaskCounts(tasks: Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (!t.parent_id || t.parent_id === t.id || t.status === "archived") continue;
    counts.set(t.parent_id, (counts.get(t.parent_id) ?? 0) + 1);
  }
  return counts;
}

function compareText(a: string | null | undefined, b: string | null | undefined): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

type BucketRow = Record<string, any>;

/** The app's bucket order: Inbox pinned first, then ungrouped buckets by position, then each group section (sections in order of their first bucket). */
export function bucketRanks(buckets: BucketRow[]): Map<string, number> {
  const sorted = [...buckets].sort(
    (a, b) => compareText(a.position, b.position) || compareText(a.id, b.id),
  );
  const inbox = sorted.filter((b) => b.is_system);
  const rest = sorted.filter((b) => !b.is_system);
  const ungrouped = rest.filter((b) => !b.group_label?.trim());
  const sections: string[] = [];
  for (const b of rest) {
    if (b.group_label?.trim() && !sections.includes(b.group_label.trim())) sections.push(b.group_label.trim());
  }
  const ordered = [
    ...inbox,
    ...ungrouped,
    ...sections.flatMap((label) => rest.filter((b) => b.group_label?.trim() === label)),
  ];
  return new Map(ordered.map((b, i) => [b.id as string, i]));
}

/**
 * Tasks in the app's order: bucket order (see bucketRanks), then `position`
 * inside a bucket (fractional-index strings, compared as text). Ties break by
 * id so paging stays stable. Tasks in an unknown bucket go last.
 */
export function orderByBucket<T extends Row>(tasks: T[], buckets: BucketRow[]): T[] {
  const rank = bucketRanks(buckets);
  const last = rank.size;
  return [...tasks].sort((a, b) => {
    const byBucket = (rank.get(a.bucket_id) ?? last) - (rank.get(b.bucket_id) ?? last);
    return byBucket || compareText(a.position, b.position) || compareText(a.id, b.id);
  });
}

export const MAX_PAGE = 200;

/** `offset` pages past the cap; a short page means the end. */
export function pageOf<T>(list: T[], offset: unknown, limit: number): T[] {
  const n = Number(offset);
  const start = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return list.slice(start, start + limit);
}

export type FocusSettings = {
  work_minutes: number;
  break_minutes: number;
  long_break_minutes: number;
  sessions_before_long_break: number;
  auto_start_next: boolean;
  sound_enabled: boolean;
};

/** The app's defaults (src/lib/focus-prefs.ts), kept in sync by hand. */
export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  work_minutes: 25,
  break_minutes: 5,
  long_break_minutes: 15,
  sessions_before_long_break: 4,
  auto_start_next: false,
  sound_enabled: true,
};

function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === "" || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** `user_preferences.focus` (camelCase jsonb, possibly `{}`) → settings with defaults and the app's clamps. */
export function focusSettingsFrom(raw: unknown): FocusSettings {
  const f: Row = raw && typeof raw === "object" ? (raw as Row) : {};
  const d = DEFAULT_FOCUS_SETTINGS;
  return {
    work_minutes: clampInt(f.workMinutes, 1, 180, d.work_minutes),
    break_minutes: clampInt(f.breakMinutes, 1, 180, d.break_minutes),
    long_break_minutes: clampInt(f.longBreakMinutes, 1, 180, d.long_break_minutes),
    sessions_before_long_break: clampInt(f.sessionsBeforeLongBreak, 1, 12, d.sessions_before_long_break),
    auto_start_next: bool(f.autoStartNext, d.auto_start_next),
    sound_enabled: bool(f.soundEnabled, d.sound_enabled),
  };
}

export type ShapeData = {
  byId: Map<string, Row>;
  blockedIds: Set<string>;
  taskTags: Map<string, string[]>;
  subtaskCounts: Map<string, number>;
  /** Member names by user id; anyone missing reads "Former member". */
  names: ReadonlyMap<string, string>;
  /** Tasks in the key creator's own queue (TV-D2). */
  queuedByMe?: ReadonlySet<string>;
  /** The workspace's task key (TV-D8): with a task's number, its handle. */
  taskKey?: string | null;
};

/**
 * The key creator's queue rows (TV-D2) → task ids in line-up order: by
 * position compared bytewise (the column is COLLATE "C"), then by id, keeping
 * only tasks the agent can see.
 */
export function queueTaskIds(
  rows: ReadonlyArray<{ task_id: string; position: string; id?: string }>,
  visible: ReadonlySet<string>,
): string[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return rows
    .filter((r) => visible.has(r.task_id))
    .slice()
    .sort((a, b) => cmp(a.position, b.position) || cmp(a.id ?? "", b.id ?? ""))
    .map((r) => r.task_id);
}

/**
 * Every row of a read, page by page (TV-D8, AC1.13): PostgREST answers at most
 * 1,000 rows per request whatever the limit says (docs/gotchas/supabase.md),
 * so a workspace past that lost tasks silently. The query must be in a total
 * order (end it with `.order("id")`) or a page boundary skips and repeats rows.
 */
export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const got = data ?? [];
    out.push(...got);
    if (got.length < pageSize) break;
  }
  return out;
}

/** A row's state through the one open rule (TV-D9): its category, else its
 *  legacy status (a row from before TV-D9). */
export function rowTaskState(t: Row): { status: unknown; statusCategory: ReturnType<typeof normalizeTaskStatusCategory> | null } {
  return {
    status: t.status,
    statusCategory: t.status_category ? normalizeTaskStatusCategory(t.status_category) : null,
  };
}

export function isDrifted(t: Row, now: Date): boolean {
  if (!isOpenTask(rowTaskState(t))) return false;
  return !!t.scheduled_at && new Date(t.scheduled_at).getTime() < now.getTime();
}

/** Quiet, compact task shape for agents — full row noise stays out. */
export function shapeTask(t: Row, data: ShapeData, now: Date, full = false): Row {
  const out: Row = {
    // TV-D8: lead with the handle (MOD-142) when the task has one.
    ...(data.taskKey && t.number != null ? { handle: `${data.taskKey}-${t.number}` } : {}),
    id: t.id,
    title: t.title,
    bucket_id: t.bucket_id,
    status: t.status,
    drifted: isDrifted(t, now),
    blocked: data.blockedIds.has(t.id),
    // MCC-1's flat field, now the real assignee (TV-D1): null = Unassigned, never the creator.
    assignee_id: assigneeIdOf(t),
    // TV-D1: who it's assigned to (null = Unassigned) and, when known, who made it.
    ...taskPeople(t, data.names),
  };
  const subtasks = data.subtaskCounts.get(t.id);
  if (subtasks) out.subtask_count = subtasks;
  const description = (t.description ?? "").trim();
  if (description) out.description = full ? description : description.slice(0, 280);
  if (t.parent_id && data.byId.has(t.parent_id)) out.parent_id = t.parent_id;
  // TV-D9: the status's category (backlog · todo · in_progress · done ·
  // wont_do) and the due date as a date, the same for everyone (due_date is
  // its noon-UTC mirror until TV-D7), plus an optional due time.
  if (t.status_category) out.status_category = t.status_category;
  if (t.due_on) out.due_on = t.due_on;
  if (t.due_time) out.due_time = t.due_time;
  if (t.due_date) out.due_date = t.due_date;
  if (t.scheduled_at) out.scheduled_at = t.scheduled_at;
  if (t.duration_minutes != null) out.duration_minutes = t.duration_minutes;
  // TV-D10/D16: the section and team it's in, its estimate, when it was
  // finished, and where an import brought it from (ENG-123).
  if (t.section_id) out.section_id = t.section_id;
  if (t.team_id) out.team_id = t.team_id;
  if (t.estimate_minutes != null) out.estimate_minutes = t.estimate_minutes;
  if (t.completed_at) out.completed_at = t.completed_at;
  if (t.imported_from && typeof t.imported_from === "object") out.imported_from = t.imported_from;
  if (t.energy_level) out.energy_level = t.energy_level;
  if (t.priority) out.priority = t.priority;
  // TV-D2: queues are personal (queued_by_me). committed_for/commit_order are
  // the old shared day list, still shown until TV-D7 removes them.
  if (data.queuedByMe?.has(t.id)) out.queued_by_me = true;
  if (t.committed_for) {
    out.committed_for = t.committed_for;
    out.commit_order = t.commit_order;
  }
  if (t.reschedule_count) out.reschedule_count = t.reschedule_count;
  if (t.recurrence) {
    out.recurrence = { rrule: t.recurrence.rrule, next_occurrence: t.recurrence.nextOccurrence ?? null };
  }
  const tags = data.taskTags.get(t.id);
  if (tags?.length) out.tags = tags;
  if (full) {
    out.created_at = t.created_at;
    out.updated_at = t.updated_at;
  }
  return out;
}

/** tasks_list's default page: summary rows are small, full ones aren't (MOD-113). */
export const LIST_PAGE = { summary: 100, full: 25 } as const;

/** Names a summary row shows instead of ids (MOD-113). */
export type SummaryNames = {
  /** Section id → name. */
  sections: ReadonlyMap<string, string>;
  /** Status id → the name people see (project_statuses). */
  statuses: ReadonlyMap<string, string>;
  /** Project id → name; only when the list spans projects. */
  projects?: ReadonlyMap<string, string>;
};

/** "In progress", "To do", "Won't do" are just their category, written out. */
function sameWords(a: string, b: string): boolean {
  const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  return letters(a) === letters(b);
}

/**
 * tasks_list's default row (MOD-113): what an agent triaging a big project
 * needs, with names instead of ids and nothing it would have to skip. 66
 * full rows ran to 57,000 characters (a description excerpt, both people as
 * objects, every legacy field); `fields: "full"` still answers shapeTask's.
 * Flags show only when they're true; no assignee means Unassigned.
 */
export function shapeTaskSummary(t: Row, data: ShapeData, now: Date, names: SummaryNames): Row {
  const handleOf = (row: Row | undefined) =>
    row && data.taskKey && row.number != null ? `${data.taskKey}-${row.number}` : undefined;
  // A row from before TV-D9 has no category: its legacy status reads as one.
  const category = normalizeTaskStatusCategory(t.status_category ?? t.status);
  const statusName = typeof t.status_id === "string" ? names.statuses.get(t.status_id) : undefined;
  const assigneeId = assigneeIdOf(t);
  const dueDay = t.due_on ?? (typeof t.due_date === "string" ? t.due_date.slice(0, 10) : null);
  const out: Row = {
    ...(handleOf(t) ? { handle: handleOf(t) } : {}),
    id: t.id,
    title: t.title,
    status: category,
    ...(statusName && !sameWords(statusName, category) ? { status_name: statusName } : {}),
  };
  if (t.priority) out.priority = t.priority;
  if (assigneeId) out.assignee = data.names.get(assigneeId) ?? FORMER_MEMBER;
  const project = names.projects?.get(t.bucket_id);
  if (project) out.project = project;
  const section = t.section_id ? names.sections.get(t.section_id) : undefined;
  if (section) out.section = section;
  const tags = data.taskTags.get(t.id);
  if (tags?.length) out.tags = tags;
  if (dueDay) out.due = t.due_time ? `${dueDay} ${String(t.due_time).slice(0, 5)}` : dueDay;
  if (data.blockedIds.has(t.id)) out.blocked = true;
  if (isDrifted(t, now)) out.drifted = true;
  if (data.queuedByMe?.has(t.id)) out.queued_by_me = true;
  const subtasks = data.subtaskCounts.get(t.id);
  if (subtasks) out.subtasks = subtasks;
  if (t.parent_id && data.byId.has(t.parent_id)) {
    out.parent = handleOf(data.byId.get(t.parent_id)) ?? t.parent_id;
  }
  return out;
}

/** How many comments tasks_get carries (the latest; tasks_comments_list reads more). */
export const TASK_GET_COMMENTS = 20;

/**
 * A task's comment as agents read it (MOD-94): who wrote it as the app shows
 * them (a person by name; an app as "<key name> (app)", spine/comments.ts),
 * when, whether it was edited, and the body. Reactions stay out.
 */
export function shapeComment(c: Row, names: ReadonlyMap<string, string>): Row {
  const person = typeof c.created_by === "string" ? names.get(c.created_by) : undefined;
  return {
    id: c.id,
    author: c.author_kind === "api_key" ? `${c.author_label || "App"} (app)` : (person ?? FORMER_MEMBER),
    at: c.created_at,
    ...(c.edited_at ? { edited: true } : {}),
    body: typeof c.body === "string" ? c.body : "",
  };
}

/** Comments oldest first, so the newest is last (ties by id, so it's stable). */
export function commentsInOrder<T extends Row>(comments: T[]): T[] {
  return [...comments].sort(
    (a, b) => compareText(a.created_at, b.created_at) || compareText(a.id, b.id),
  );
}
