// Tasks module v1 data model — the ADHD bucket / commit / execute model.
//
// Canonical going forward (see docs/moduo-tasks-feature-spec.md §11 and
// docs/moduo-architecture-vocabulary.md). Mirrors the Rust domain structs in
// src-tauri/src/domain/mod.rs (serde camelCase fields, snake_case enum values).
//
// This is the only Tasks model. The legacy Linear-style types (TaskProject /
// TaskWorkflowState / Task-as-issue) and the features/plan UI were removed.

import type {
  ActivityActorType,
  EnergyLevel,
  PriorityLevel,
  TaskStatus,
  TaskTimeAction,
  TaskTimeStatus,
} from "@contracts/vocabularies";
import type { Truncation } from "../../lib/paged-select";

export type {
  ActivityActorType,
  EnergyLevel,
  PriorityLevel,
  TaskStatus,
  TaskTimeAction,
  TaskTimeStatus,
} from "@contracts/vocabularies";

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
  /**
   * Who created the task (`owner_id`). The server sets it on insert and it
   * never changes. Empty on a task that isn't saved yet.
   */
  creatorId: string;
  /**
   * The creator was overwritten by a reassignment before TV-D1 and couldn't
   * be recovered, so the app doesn't claim one ("Created by" stays hidden).
   */
  creatorUnknown: boolean;
  /**
   * Who the task is assigned to; null = Unassigned. On a task that isn't
   * created yet, "" means "the creator" (the runtime fills it in).
   */
  assigneeId: string | null;
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
  /** Accumulated tracked work time in seconds (lightweight time-tracking). */
  timeSpentSeconds: number;
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

/**
 * One task in one person's Queue (TV-D2, `public.task_queue`): the line-up of
 * what they mean to do next, not tied to a date. Rows of other people are
 * claims ("In Mike's queue"). Order by `position` (bytewise, like the rest of
 * the app's fractional keys) within one person.
 */
export type TaskQueueEntry = {
  id: string;
  workspaceId: string;
  userId: string;
  taskId: string;
  position: string;
  queuedAt: string;
  updatedAt: string;
};

/** Where `opQueueAdd` puts a task: the end (default), or the top (Calendar's "Start focus"). */
export type QueuePlacement = "end" | "top";

/**
 * A write of tracked time (TV-D3, `tasks_op_track_time`): a finished focus or
 * waiting stretch, an adjustment (signed), the adjustment that makes the total
 * a typed value, or the Undo of your own adjustment. `key` makes a resend of
 * the same save count once.
 */
export type TrackTimeInput = {
  workspaceId: string;
  taskId: string;
  action: TaskTimeAction;
  /** The stretch's length, the adjustment, or the total to reach. For an Undo,
   *  the adjustment being undone (used only by a database without entries). */
  seconds?: number;
  /** When the stretch ended (now when left out). */
  endedAt?: string | null;
  key?: string | null;
  /** The adjustment an Undo removes. */
  entryId?: string | null;
};

/** What a time write answered. Totals are null when the task is gone. */
export type TaskTimeResult = {
  status: TaskTimeStatus;
  taskId: string;
  /** The entry written (or, for a resend, the one already there). */
  entryId: string | null;
  /** The task's total: what `timeSpentSeconds` holds everywhere. */
  totalSeconds: number | null;
  /** Your share of it. */
  mySeconds: number | null;
  /** Your waiting (in-flight) time on it, never part of the total. */
  myWaitingSeconds: number | null;
};

/** A task's time as `tasks_time_totals` reads it for the caller. */
export type TaskTimeTotals = {
  taskId: string;
  totalSeconds: number;
  mySeconds: number;
  myWaitingSeconds: number;
  /** Your share since the asked-for time (legacy time never counts); null when
   *  none was asked for. */
  mySecondsSince: number | null;
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

/**
 * One attributed intent-op record from the shared, append-only cross-module
 * `module_activity` table (docs/moduo-module-contract.md). Written only by
 * `<module>_op_*` RPCs — never from clients. Rendered as a quiet trail in the
 * entity's detail surface (a mirror, never a wall).
 */
export type ActivityEntry = {
  id: string;
  workspaceId: string;
  module: string;
  entityType: string;
  entityId: string;
  /** Intent-op name, e.g. "tasks.commit". */
  op: string;
  actorType: ActivityActorType;
  actorId: string | null;
  /** Display snapshot at write time (profiles.display_name for users). */
  actorLabel: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

/**
 * One engine result for the batched `tasks.catch_up` op (spec §5d): the
 * client computes the occurrence math; the op enforces structure + attribution.
 */
export type TasksCatchUpItem = {
  taskId: string;
  kind: "reopen" | "collapse" | "adopt";
  /** Only ever "todo" — catch-up reopens, it never completes/archives. */
  status?: "todo";
  scheduledAt?: string;
  recurrence: RecurrenceRule;
  clearCommit?: boolean;
};

/** Read bundle for the Tasks module, scoped to a workspace. */
export type TasksModuleBundle = {
  buckets: Bucket[];
  tasks: Task[];
  tags: Tag[];
  tagLinks: TagLink[];
  taskRelations: TaskRelation[];
  /**
   * Collections the read had to cut at their ceiling (SCALE-1). Empty = you
   * are holding everything. Non-empty MUST be shown — a silent cut is the bug
   * this field exists to kill.
   */
  truncated: Truncation[];
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

/** What a task's project reads when you can't see that project (TV-P0, AC1.10). */
export const PRIVATE_PROJECT_LABEL = "Private project";

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

/**
 * Who a task's attention goes to: its assignee, else its creator when the
 * creator is known. Mirrors the SQL that targets unblocked notifications
 * (tasks_notify_spine); the bell's overdue list uses it. Comments notify the
 * assignee and the creator both (comments_op_add).
 */
export function taskAttentionUserId(
  task: Pick<Task, "assigneeId" | "creatorId" | "creatorUnknown">,
): string | null {
  if (task.assigneeId) return task.assigneeId;
  if (task.creatorUnknown || !task.creatorId) return null;
  return task.creatorId;
}
