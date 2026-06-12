// Pure helpers for the Tasks module Plan-mode UI: a task factory, fractional
// position generation (Lexorank-lite), label maps, datetime formatting, and the
// grouping logic for the List view. No React, no IO — easy to unit-test.

import type {
  Bucket,
  EnergyLevel,
  PriorityLevel,
  Task,
  TaskStatus,
} from "./model";

// ── Position (fractional indexing) ───────────────────────────────────────────
// Fixed-width base-36 keys so lexicographic order == numeric order. STEP leaves
// room to insert between neighbours without re-indexing. Enough for v1; a full
// Lexorank can replace this later without touching call sites.

const POS_WIDTH = 10;
const POS_STEP = 1 << 20;

function encodePos(n: number): string {
  return Math.max(0, Math.floor(n)).toString(36).padStart(POS_WIDTH, "0");
}
function decodePos(s: string): number {
  const n = parseInt(s, 36);
  return Number.isFinite(n) ? n : 0;
}

/** A position string that sorts after every existing position. */
export function endPosition(existing: Array<{ position: string }>): string {
  let max = 0;
  for (const item of existing) {
    const n = decodePos(item.position);
    if (n > max) max = n;
  }
  return encodePos(max + POS_STEP);
}

/** A position string strictly between `a` and `b` (either bound may be null). */
export function betweenPositions(a: string | null, b: string | null): string {
  const lo = a ? decodePos(a) : 0;
  const hi = b ? decodePos(b) : lo + 2 * POS_STEP;
  if (hi - lo <= 1) return encodePos(lo + 1); // overflow-safe-ish fallback
  return encodePos(Math.floor((lo + hi) / 2));
}

/** Local calendar date as YYYY-MM-DD (the value stored in `committedFor`). */
export function todayStr(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ── Task factory ─────────────────────────────────────────────────────────────

export type NewTaskFields = {
  workspaceId: string;
  bucketId: string;
  title: string;
  position: string;
  /** Parent task id — makes the new task a subtask (one level, spec §11). */
  parentId?: string | null;
  description?: string;
  dueDate?: string | null;
  scheduledAt?: string | null;
  recurrence?: Task["recurrence"];
  energyLevel?: EnergyLevel | null;
  priority?: PriorityLevel | null;
  durationMinutes?: number | null;
};

/**
 * Build a client-side Task. `id`/`ownerId` are left empty for the backend to
 * fill (both runtimes mint them on upsert), and timestamps are stamped now so
 * optimistic rendering has a stable value.
 */
export function makeTask(fields: NewTaskFields): Task {
  const now = new Date().toISOString();
  return {
    id: "",
    workspaceId: fields.workspaceId,
    ownerId: "",
    bucketId: fields.bucketId,
    parentId: fields.parentId ?? null,
    title: fields.title,
    description: fields.description ?? "",
    dueDate: fields.dueDate ?? null,
    scheduledAt: fields.scheduledAt ?? null,
    durationMinutes: fields.durationMinutes ?? null,
    recurrence: fields.recurrence ?? null,
    energyLevel: fields.energyLevel ?? null,
    priority: fields.priority ?? null,
    status: "todo",
    committedFor: null,
    commitOrder: null,
    rescheduleCount: 0,
    position: fields.position,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  archived: "Archived",
};

/** Status order for grouping (open work first, terminal states last). */
export const STATUS_ORDER: TaskStatus[] = ["in_progress", "todo", "done", "archived"];

export const ENERGY_LABELS: Record<EnergyLevel, string> = {
  low: "Low energy",
  medium: "Medium energy",
  high: "High energy",
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  low: "Low priority",
  medium: "Medium priority",
  high: "High priority",
};

export const LEVEL_ORDER = ["high", "medium", "low"] as const;

/** Ascending level options for pickers (context menus, detail panel selects). */
export const LEVEL_OPTIONS: Array<{ value: EnergyLevel | PriorityLevel; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// ── Datetime formatting ──────────────────────────────────────────────────────

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DATE_TIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const TIMESTAMP_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Absolute timestamp with year — created/updated metadata, activity trails. */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : TIMESTAMP_FMT.format(d);
}

/** Scheduled clock time — just the time if today, else short date + time. */
export function formatScheduled(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return sameDay(d, now) ? TIME_FMT.format(d) : DATE_TIME_FMT.format(d);
}

/** Due marker — relative ("Today"/"Tomorrow") near now, else a short date. */
export function formatDue(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return DATE_FMT.format(d);
}

/** For datetime-local inputs (YYYY-MM-DDTHH:mm in local time). */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** For date inputs (YYYY-MM-DD in local time). */
export function toDateInputValue(iso: string | null): string {
  return toLocalInputValue(iso).slice(0, 10);
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export type GroupBy = "none" | "status" | "bucket" | "energy" | "priority";

export type TaskGroup = {
  key: string;
  label: string;
  tasks: Task[];
};

export type GroupContext = {
  bucketName: (bucketId: string) => string;
};

const UNSET_LABEL = "Unset";

/**
 * Partition tasks into ordered, labeled groups for the List view. "bucket"
 * grouping is the implicit mode used in the cross-bucket "All" selection.
 */
export function groupTasks(tasks: Task[], by: GroupBy, ctx: GroupContext): TaskGroup[] {
  if (by === "none") {
    return [{ key: "all", label: "", tasks }];
  }

  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = groupKeyFor(task, by);
    const list = map.get(key);
    if (list) list.push(task);
    else map.set(key, [task]);
  }

  const orderedKeys = orderedGroupKeys(by, map);
  return orderedKeys.map((key) => ({
    key,
    label: groupLabel(by, key, ctx),
    tasks: map.get(key) ?? [],
  }));
}

function groupKeyFor(task: Task, by: GroupBy): string {
  switch (by) {
    case "status":
      return task.status;
    case "bucket":
      return task.bucketId;
    case "energy":
      return task.energyLevel ?? "unset";
    case "priority":
      return task.priority ?? "unset";
    default:
      return "all";
  }
}

function orderedGroupKeys(by: GroupBy, map: Map<string, Task[]>): string[] {
  const present = new Set(map.keys());
  if (by === "status") {
    return STATUS_ORDER.filter((s) => present.has(s));
  }
  if (by === "energy" || by === "priority") {
    const ranked: string[] = LEVEL_ORDER.filter((l) => present.has(l));
    if (present.has("unset")) ranked.push("unset");
    return ranked;
  }
  // bucket: keep map insertion order (already position-sorted upstream)
  return [...map.keys()];
}

function groupLabel(by: GroupBy, key: string, ctx: GroupContext): string {
  if (by === "status") return STATUS_LABELS[key as TaskStatus] ?? key;
  if (by === "bucket") return ctx.bucketName(key);
  if (by === "energy") return key === "unset" ? UNSET_LABEL : ENERGY_LABELS[key as EnergyLevel];
  if (by === "priority") return key === "unset" ? UNSET_LABEL : PRIORITY_LABELS[key as PriorityLevel];
  return key;
}

// ── Organization: rail sections + tag filter (Session 4) ─────────────────────

export type BucketSection = { name: string; buckets: Bucket[] };

export type BucketLayout = {
  /** Buckets with no section — rendered flat, first (presentational). */
  ungrouped: Bucket[];
  /** Sections in first-appearance order; buckets keep their incoming order. */
  sections: BucketSection[];
};

/**
 * Partition position-sorted buckets into the flat (ungrouped) set and the
 * collapsible sections, by their optional `group` label. Two levels max:
 * section → bucket, never nested. Pure / presentational — capture and task
 * assignment never touch this. A blank/whitespace group counts as ungrouped.
 */
export function bucketSections(buckets: Bucket[]): BucketLayout {
  const ungrouped: Bucket[] = [];
  const order: string[] = [];
  const byName = new Map<string, Bucket[]>();
  for (const bucket of buckets) {
    const name = bucket.group?.trim();
    if (!name) {
      ungrouped.push(bucket);
      continue;
    }
    const list = byName.get(name);
    if (list) {
      list.push(bucket);
    } else {
      byName.set(name, [bucket]);
      order.push(name);
    }
  }
  return { ungrouped, sections: order.map((name) => ({ name, buckets: byName.get(name) ?? [] })) };
}

/** Existing section names (first-appearance order) — for the "move to section" menu. */
export function bucketGroupNames(buckets: Bucket[]): string[] {
  return bucketSections(buckets).sections.map((s) => s.name);
}

// ── Subtasks, one level (Session 5) ──────────────────────────────────────────

/**
 * Children keyed by parent id, resolved among `tasks` (pass the *live* task
 * set). A `parentId` that doesn't resolve to a task in the set is ignored —
 * that task is treated as top-level (children of a deleted parent are never
 * lost). Children keep the incoming order (position-sorted upstream).
 */
export function subtasksByParent(tasks: Task[]): Map<string, Task[]> {
  const ids = new Set(tasks.map((t) => t.id));
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parentId || !ids.has(task.parentId) || task.parentId === task.id) continue;
    const list = map.get(task.parentId);
    if (list) list.push(task);
    else map.set(task.parentId, [task]);
  }
  return map;
}

/** Quiet n/m progress for a parent (mirror, never a wall). Archived subtasks
 * are out of open lists, so they count toward neither side. */
export function subtaskProgress(children: Task[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const child of children) {
    if (child.status === "archived") continue;
    total += 1;
    if (child.status === "done") done += 1;
  }
  return { done, total };
}

/**
 * The ids hidden from a scope's top level: subtasks whose parent is in the
 * same rendered set. A subtask whose parent is *not* in the scope (other
 * bucket, filtered out, deleted) renders as a normal top-level row instead —
 * nothing is ever invisible. Today's queue passes `nest = false` (it is an
 * ordered flat queue, and subtasks are individually committable).
 */
export function nestedSubtaskIds(scopeTasks: Task[], nest = true): Set<string> {
  if (!nest) return new Set();
  const scopeIds = new Set(scopeTasks.map((t) => t.id));
  const nested = new Set<string>();
  for (const task of scopeTasks) {
    if (task.parentId && task.parentId !== task.id && scopeIds.has(task.parentId)) {
      nested.add(task.id);
    }
  }
  return nested;
}

/**
 * Tag filter predicate (OR / union): a task matches when no tags are selected,
 * or it carries at least one of them. Union is the intuitive "show me #x or #y";
 * the dominant single-tag case is identical under either rule.
 */
export function taskMatchesTagFilter(taskTagIds: Iterable<string>, filterTagIds: string[]): boolean {
  if (filterTagIds.length === 0) return true;
  const wanted = new Set(filterTagIds);
  for (const id of taskTagIds) {
    if (wanted.has(id)) return true;
  }
  return false;
}
