// Tasks module v1 data model — the ADHD bucket / commit / execute model.
//
// Canonical going forward (see docs/moduo-tasks-feature-spec.md §11 and
// docs/moduo-architecture-vocabulary.md). Mirrors the Rust domain structs in
// src-tauri/src/domain/mod.rs (serde camelCase fields, snake_case enum values).
//
// This SUPERSEDES the legacy Linear-style types in ./types.ts (TaskProject /
// TaskWorkflowState / Task-as-issue), which will be removed together with the
// features/plan UI in a later session. Don't mix the two.

/** Fixed task lifecycle status. */
export type TaskStatus = "todo" | "in_progress" | "done" | "archived";

/** Optional per-task energy estimate. */
export type EnergyLevel = "low" | "medium" | "high";

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
  title: string;
  description: string;
  /** When the task is due. */
  dueDate: string | null;
  /** When the task is planned to a clock time. Works with Calendar hidden. */
  scheduledAt: string | null;
  /** Estimated/blocked duration in minutes (default-on-drop, resizable). */
  durationMinutes: number | null;
  recurrence: RecurrenceRule | null;
  energyLevel: EnergyLevel | null;
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

/** Read bundle for the Tasks module, scoped to a workspace. */
export type TasksModuleBundle = {
  buckets: Bucket[];
  tasks: Task[];
  tags: Tag[];
  tagLinks: TagLink[];
};

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
