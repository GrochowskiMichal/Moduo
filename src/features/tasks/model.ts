// Tasks module v1 data model — the ADHD bucket / commit / execute model.
//
// Canonical going forward (see docs/moduo-tasks-feature-spec.md §11 and
// docs/moduo-architecture-vocabulary.md). Mirrors the Rust domain structs in
// src-tauri/src/domain/mod.rs (serde camelCase fields, snake_case enum values).
//
// This is the only Tasks model. The legacy Linear-style types (TaskProject /
// TaskWorkflowState / Task-as-issue) and the features/plan UI were removed.

/** Fixed task lifecycle status. */
export type TaskStatus = "todo" | "in_progress" | "done" | "archived";

/** Optional per-task energy estimate — *how demanding* a task is to do. */
export type EnergyLevel = "low" | "medium" | "high";

/**
 * Optional per-task priority — *how important* a task is to get done. Distinct
 * from {@link EnergyLevel} (demand). Ambient only — never render as red/alarming
 * (design principles 4 & 5). An `"urgent"` tier is a future, non-breaking add.
 */
export type PriorityLevel = "low" | "medium" | "high";

/** Recurrence definition (rrule.js-compatible). Produced by the capture parser. */
export type RecurrenceRule = {
  /** RFC 5545 RRULE string, e.g. "FREQ=DAILY;INTERVAL=1". */
  rrule: string;
  /** Optional anchor datetime (DTSTART), ISO 8601. */
  dtstart: string | null;
  /** Precomputed next occurrence datetime, ISO 8601. */
  nextOccurrence: string | null;
};

/**
 * A user-defined, exclusive category for tasks. One task lives in exactly one
 * bucket. `isSystem` marks the reserved, undeletable Inbox.
 */
export type Bucket = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  isSystem: boolean;
  /**
   * Optional, presentational section label. Buckets that share a `group` render
   * under a collapsible rail section (two levels max). Unset by default — the
   * rail stays flat until a bucket is assigned one. Stored as `group_label` on
   * the cloud side (reserved-word avoidance).
   */
  group: string | null;
  /** Lexorank-style ordering string. */
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/**
 * A task in the Tasks module. Note `drifted` is NOT a stored field — derive it
 * with {@link isDrifted}.
 */
export type Task = {
  id: string;
  workspaceId: string;
  ownerId: string;
  /** Required: the bucket this task belongs to (Inbox as fallback). */
  bucketId: string;
  /**
   * Optional parent task — subtasks are exactly one level deep (a task with a
   * parent is never itself a parent; recursion forbidden). A `parentId` that no
   * longer resolves to a live task is treated as unset (the task renders
   * top-level), so children of a deleted parent are never lost.
   */
  parentId: string | null;
  title: string;
  description: string;
  /** When the task is due. */
  dueDate: string | null;
  /** When the task is planned to a clock time. Works with Calendar hidden. */
  scheduledAt: string | null;
  /** Estimated/blocked duration in minutes (default-on-drop, resizable). */
  durationMinutes: number | null;
  recurrence: RecurrenceRule | null;
  /** How demanding the task is to do. */
  energyLevel: EnergyLevel | null;
  /** How important the task is to get done. Optional, ambient. */
  priority: PriorityLevel | null;
  status: TaskStatus;
  /** Today's-commit-queue membership: the date (YYYY-MM-DD) committed for. */
  committedFor: string | null;
  /** Ordering within the commit queue. */
  commitOrder: number | null;
  /** Ambient count of reschedules. Never blocking (design principle 5). */
  rescheduleCount: number;
  /** Lexorank-style ordering string for list/board position. */
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** A workspace-level, cross-cutting label. Attached to entities via {@link TagLink}. */
export type Tag = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** Polymorphic target type for a tag link. Known: "task" | "note" | "email". */
export type TagEntityType = string;

/** Polymorphic association joining a {@link Tag} to any entity. */
export type TagLink = {
  id: string;
  workspaceId: string;
  tagId: string;
  entityType: TagEntityType;
  entityId: string;
  createdAt: string;
};

/**
 * A directed dependency edge: `blockerTaskId` blocks `blockedTaskId` (spec §5c).
 * *Blocked* is computed at read time from these edges — see `blockedTaskIds`
 * in helpers — never stored on the task. The edge graph is a DAG (cycles are
 * forbidden client-side and by a DB trigger).
 */
export type TaskRelation = {
  id: string;
  workspaceId: string;
  blockerTaskId: string;
  blockedTaskId: string;
  createdAt: string;
};

/** Read bundle for the Tasks module, scoped to a workspace. */
export type TasksModuleBundle = {
  buckets: Bucket[];
  tasks: Task[];
  tags: Tag[];
  tagLinks: TagLink[];
  taskRelations: TaskRelation[];
};

/** Coarse time-of-day slots that a bucket can be mapped to (spec §9). */
export type TimeBlockSlot = "morning" | "afternoon" | "evening";

export const TIME_BLOCK_SLOTS: TimeBlockSlot[] = ["morning", "afternoon", "evening"];

/**
 * Per-workspace slot → bucketId assignment. A bucket holds at most one slot.
 * Persisted in the `task_time_blocks` table (one row per workspace).
 */
export type TimeBlockMap = Partial<Record<TimeBlockSlot, string>>;

/** Keep only well-formed slot entries — used on every read from storage. */
export function sanitizeTimeBlocks(raw: unknown): TimeBlockMap {
  if (!raw || typeof raw !== "object") return {};
  const out: TimeBlockMap = {};
  for (const slot of TIME_BLOCK_SLOTS) {
    const v = (raw as Record<string, unknown>)[slot];
    if (typeof v === "string" && v) out[slot] = v;
  }
  return out;
}

/** Name of the reserved system Inbox bucket. */
export const INBOX_BUCKET_NAME = "Inbox";

/**
 * Computed `drifted` flag — mirrors `Task::is_drifted` in the Rust backend and
 * the spec: a scheduled task whose time has passed without completion.
 *
 *   drifted = scheduledAt < now AND status NOT IN (done, archived)
 *
 * Ambient signal only — never render as red / "overdue" (design principles 4 & 5).
 */
export function isDrifted(
  task: Pick<Task, "scheduledAt" | "status">,
  now: Date = new Date(),
): boolean {
  if (task.status === "done" || task.status === "archived") return false;
  if (!task.scheduledAt) return false;
  return new Date(task.scheduledAt).getTime() < now.getTime();
}
