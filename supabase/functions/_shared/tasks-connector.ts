/**
 * Pure list helpers for the Tasks connector (moduo-mcp/modules/tasks.ts).
 * No Deno or Supabase imports, so the app's test runner covers them
 * (MCC-1; tool catalog in docs/moduo-mcp-connector.md).
 */

import { assigneeIdOf, taskPeople } from "./task-people.ts";

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

export function isDrifted(t: Row, now: Date): boolean {
  if (t.status === "done" || t.status === "archived") return false;
  return !!t.scheduled_at && new Date(t.scheduled_at).getTime() < now.getTime();
}

/** Quiet, compact task shape for agents — full row noise stays out. */
export function shapeTask(t: Row, data: ShapeData, now: Date, full = false): Row {
  const out: Row = {
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
  if (t.due_date) out.due_date = t.due_date;
  if (t.scheduled_at) out.scheduled_at = t.scheduled_at;
  if (t.duration_minutes != null) out.duration_minutes = t.duration_minutes;
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
