/**
 * Pure list helpers for the Tasks connector (moduo-mcp/modules/tasks.ts).
 * No Deno or Supabase imports, so the app's test runner covers them
 * (specs/moduo-for-claude-code.md, MCC-1).
 */

type Row = Record<string, any>;

export type Assignee = "me" | "anyone";

/** Unknown or missing values keep the old behavior (`anyone`). */
export function parseAssignee(value: unknown): Assignee {
  return value === "me" ? "me" : "anyone";
}

/** "Mine" = `owner_id` is the key's creator (there is no assignee column yet). */
export function filterByAssignee<T extends Row>(tasks: T[], assignee: Assignee, userId: string): T[] {
  return assignee === "me" ? tasks.filter((t) => t.owner_id === userId) : tasks;
}

/** A task is top-level when it has no parent the caller can see. */
export function topLevelOnly<T extends Row>(tasks: T[], visibleIds: Set<string>): T[] {
  return tasks.filter((t) => !t.parent_id || !visibleIds.has(t.parent_id));
}

/** Subtasks per parent, counting only tasks in `tasks` (visible, not deleted). */
export function subtaskCounts(tasks: Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (!t.parent_id) continue;
    counts.set(t.parent_id, (counts.get(t.parent_id) ?? 0) + 1);
  }
  return counts;
}

function compareText(a: string | null | undefined, b: string | null | undefined): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The app's order: buckets by `position`, then tasks by `position` inside a
 * bucket (both are fractional-index strings, compared as text). Tasks in an
 * unknown bucket go last. Stable, so equal positions keep the incoming order.
 */
export function orderByBucket<T extends Row>(
  tasks: T[],
  buckets: { id: string; position?: string | null }[],
): T[] {
  const rank = new Map<string, number>();
  [...buckets]
    .sort((a, b) => compareText(a.position, b.position))
    .forEach((b, i) => rank.set(b.id, i));
  const last = rank.size;
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const byBucket = (rank.get(a.t.bucket_id) ?? last) - (rank.get(b.t.bucket_id) ?? last);
      return byBucket || compareText(a.t.position, b.t.position) || a.i - b.i;
    })
    .map(({ t }) => t);
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
};

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
  };
  if (t.owner_id) out.assignee_id = t.owner_id;
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
