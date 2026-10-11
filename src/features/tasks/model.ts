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
  ProjectState,
  TaskReminderKind,
  TaskStatus,
  TaskStatusCategory,
  TaskTimeAction,
  TaskTimeStatus,
  TaskWaitingKind,
} from "@contracts/vocabularies";
import { isOpenTask } from "@contracts/vocabularies";
import type { Truncation } from "../../lib/paged-select";

export type {
  ActivityActorType,
  EnergyLevel,
  PriorityLevel,
  ProjectState,
  TaskReminderKind,
  TaskStatus,
  TaskStatusCategory,
  TaskTimeAction,
  TaskTimeStatus,
  TaskWaitingKind,
} from "@contracts/vocabularies";

/**
 * One status of a project (TV-D9, `public.project_statuses`): a name the
 * project chose inside one of the five fixed categories, which carry the
 * app's behaviour. `projectId` null = the workspace default set (new projects
 * copy it; the Inbox uses it as it is). Order: by category, then `position`.
 */
export type ProjectStatus = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  category: TaskStatusCategory;
  name: string;
  position: number;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
};

// ── TV-D10: the structure around tasks ────────────────────────────────────

/**
 * An area (`public.areas`): an optional group of projects in the sidebar —
 * name, colour, order; no permissions, no page, no tasks of its own. Today's
 * rail sections became areas (a project's `group` mirrors its area's name).
 */
export type Area = {
  id: string;
  workspaceId: string;
  name: string;
  color: string | null;
  position: number;
  /**
   * Made as a workspace area (every Tasks reader sees it); otherwise made from
   * a label, and seen by its maker and whoever sees one of its projects.
   */
  shared: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * A section (`public.sections`): an ordered part of one project (a phase, a
 * week, a sprint), with a date range or an end date only.
 */
export type Section = {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  position: number;
  /** YYYY-MM-DD; set only together with an end. */
  startsOn: string | null;
  /** YYYY-MM-DD. */
  endsOn: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * A team (`public.teams`): a named group that work is routed to (routing
 * only: a team hides nothing). People are round; a team's mark is a rounded
 * square with two letters.
 */
export type Team = {
  id: string;
  workspaceId: string;
  name: string;
  /** One or two letters. */
  mark: string;
  color: string | null;
  /** Where a task for this team goes when it names no project. */
  defaultProjectId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One person in a team (`public.team_members`). */
export type TeamMember = {
  id: string;
  workspaceId: string;
  teamId: string;
  userId: string;
  createdAt: string;
};

/**
 * One scheduled block of work on a task (`public.task_sessions`); a task can
 * have several. Until TV-D7 the task's `scheduledAt` / `durationMinutes`
 * mirror its next session (the earliest that hasn't ended, else the latest).
 */
export type TaskSession = {
  id: string;
  workspaceId: string;
  taskId: string;
  /** Whose calendar holds it. */
  userId: string | null;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
};

/** One of your own reminders on a task (`public.task_reminders`). */
export type TaskReminder = {
  id: string;
  workspaceId: string;
  taskId: string;
  userId: string;
  kind: TaskReminderKind;
  /** When it fires; null for a relative one while the task has no due date. */
  at: string | null;
  /** When the sender picked it up (TV-D12 delivers it). */
  firedAt: string | null;
  updatedAt: string;
};

/**
 * One Waiting on… entry (`public.task_waiting`): a person, an email thread,
 * an agent (an API key) or free text, with when the wait began. `ref` names
 * the item for the first three; `label` is the text for the last.
 */
export type TaskWaitingEntry = {
  id: string;
  workspaceId: string;
  taskId: string;
  kind: TaskWaitingKind;
  ref: string | null;
  label: string | null;
  since: string;
  createdBy: string | null;
  updatedAt: string;
};

/** Recurrence definition (rrule.js-compatible). Produced by the capture parser. */
export type RecurrenceRule = {
  /** RFC 5545 RRULE string, e.g. "FREQ=DAILY;INTERVAL=1". */
  rrule: string;
  /** Optional anchor datetime (DTSTART), ISO 8601. */
  dtstart: string | null;
  /** Precomputed next occurrence datetime, ISO 8601. The server moves it (TV-D8). */
  nextOccurrence: string | null;
  /**
   * "after_completion": the next one counts from the day it was done (the
   * server reads it; the picker comes with TV-D12/TV-U13). Absent: by the rule.
   */
  mode?: "after_completion";
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
  /**
   * TV-D10 project fields (absent on a row read before that migration): the
   * project's state, its start and target dates (YYYY-MM-DD), an optional lead
   * (a member), a client (a contact) and its area.
   */
  status?: ProjectState;
  startsOn?: string | null;
  targetOn?: string | null;
  leadId?: string | null;
  clientContactId?: string | null;
  areaId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /**
   * The sidebar dot's label hue (a `LABEL_COLORS` name); null or absent =
   * neutral (TV-U6). Read through `normalizeLabelColor`, like a tag's colour.
   */
  color?: string | null;
  /**
   * Set while the project is archived (TV-U6, REPLAN 16 + 78): it leaves the
   * sidebar, every list, count and queue, and opens from the sidebar's ⋯ →
   * Archived projects; Tasks' search still finds its tasks, labelled.
   */
  archivedAt?: string | null;
};

/**
 * A task in the Tasks module. Note `drifted` is NOT a stored field — derive it
 * with {@link isDrifted}.
 */
export type Task = {
  id: string;
  workspaceId: string;
  /**
   * The task's permanent number in its workspace (TV-D8): with the workspace's
   * task key it is the handle, `MOD-142`. Set by the server; absent on a task
   * that isn't saved yet (or read from a database before TV-D8).
   */
  number?: number | null;
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
  /**
   * When the task is due, as the local midnight of its due date (an ISO
   * instant, as every date reader in the app expects). Since TV-D9 the date
   * itself is {@link Task.dueOn}, the same for everyone; this is derived from
   * it on read and written back as a date.
   */
  dueDate: string | null;
  /** The due date, YYYY-MM-DD (TV-D9). Absent on a row read before TV-D9. */
  dueOn?: string | null;
  /** An optional due time, HH:MM[:SS], the clock time in the assignee's zone (TV-D9). */
  dueTime?: string | null;
  /** When the task is planned to a clock time. Works with Calendar hidden. */
  scheduledAt: string | null;
  /**
   * The scheduled block's length in minutes (default-on-drop, resizable). It
   * was the estimate too until TV-D10; since then it mirrors the next work
   * session, and the estimate is {@link Task.estimateMinutes}. Read the
   * estimate with `estimateOf`.
   */
  durationMinutes: number | null;
  /** The estimate in minutes (TV-D10). Absent on a row read before it. */
  estimateMinutes?: number | null;
  /** The task's section in its project (TV-D10); null = No section. */
  sectionId?: string | null;
  /** The team it's routed to (TV-D10), next to its one assignee. */
  teamId?: string | null;
  /** Where it was imported from (TV-D10; TV-D16 writes it). */
  importedFrom?: { source: string; key: string } | null;
  /** Accumulated tracked work time in seconds (lightweight time-tracking). */
  timeSpentSeconds: number;
  recurrence: RecurrenceRule | null;
  /** How demanding the task is to do. */
  energyLevel: EnergyLevel | null;
  /** How important the task is to get done. Optional, ambient. */
  priority: PriorityLevel | null;
  /**
   * The legacy status (what builds before TV-D9 read): the category with
   * Backlog as "todo" and Won't do as "archived". Read the task's state
   * through `taskCategoryOf` / `isOpenTask` / `isClosedTask`, never this alone.
   */
  status: TaskStatus;
  /** The task's status in its project (TV-D9, a {@link ProjectStatus} id). */
  statusId?: string | null;
  /** Its category, as the server keeps it (TV-D9). Absent before TV-D9:
   *  `taskCategoryOf` then reads `status`. */
  statusCategory?: TaskStatusCategory | null;
  /** When it was last finished, and by whom (TV-D9; null unless Done). */
  completedAt?: string | null;
  completedBy?: string | null;
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
 * One completion of a task (TV-D8, `public.task_completions`): who, when, and
 * which cycle it closed (the occurrence for a repeat, "once" otherwise).
 * Written by the server's status op; reopening by hand takes it back.
 */
export type TaskCompletion = {
  id: string;
  workspaceId: string;
  taskId: string;
  userId: string | null;
  completedAt: string;
  cycleKey: string;
  updatedAt: string;
  deletedAt: string | null;
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
   * Every status the reader can see (TV-D9): the workspace default set and
   * each visible project's. Absent from a database before TV-D9.
   */
  statuses?: ProjectStatus[];
  /**
   * TV-D10: the workspace's areas, every visible project's sections, the
   * teams and their members. Absent from a database before TV-D10.
   */
  areas?: Area[];
  sections?: Section[];
  teams?: Team[];
  teamMembers?: TeamMember[];
  /**
   * Collections the read had to cut at their ceiling (SCALE-1). Empty = you
   * are holding everything. Non-empty MUST be shown — a silent cut is the bug
   * this field exists to kill.
   */
  truncated: Truncation[];
  /**
   * Archived projects and their tasks (TV-U6), kept out of `buckets` and
   * `tasks` so every other reader of the bundle (Home, the Calendar, contact
   * hubs) hides them without knowing about archiving. The Tasks module joins
   * them back: Archived projects and search show them.
   */
  archivedBuckets?: Bucket[];
  archivedTasks?: Task[];
};

/** A project in Recently deleted (TV-U6). */
export type TrashedBucket = {
  bucket: Bucket;
  /** Shared with the finished tasks (and files) deleted with it; null for a delete from before TV-U6. */
  batchId: string | null;
  /** The open tasks its delete handed to their assignees' Inboxes (REPLAN 78);
   *  a Restore takes back the ones nobody edited since. */
  movedTaskIds: string[];
};

/** A task in Recently deleted (TV-U6). */
export type TrashedTask = {
  task: Task;
  /** The batch it was deleted in (with a project), or null when deleted on its own. */
  batchId: string | null;
};

/** What Recently deleted holds: everything deleted in the last 30 days. */
export type TasksTrash = { buckets: TrashedBucket[]; tasks: TrashedTask[] };

/** What deleting a project did (REPLAN 78): open tasks handed to Inboxes,
 *  finished ones deleted with it, people told. */
export type ProjectDeleteResult = { moved: number; deleted: number; notified: number };

/** Days a deleted task, project or file stays restorable before the purge. */
export const TRASH_DAYS = 30;

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
 * A task's estimate in minutes: its own column since TV-D10, else (a row read
 * from a database before it) `durationMinutes`, which held the estimate then.
 */
export function estimateOf(
  task: Pick<Task, "durationMinutes"> & { estimateMinutes?: number | null },
): number | null {
  return task.estimateMinutes !== undefined ? task.estimateMinutes : task.durationMinutes;
}

/**
 * Computed `drifted` flag — mirrors `Task::is_drifted` in the Rust backend and
 * the spec: a scheduled task whose time has passed without completion.
 *
 *   drifted = scheduledAt < now AND the task is open (To do / In progress)
 *
 * Backlog never drifts (TV-D9). Ambient signal only — never render as red /
 * "overdue" (design principles 4 & 5).
 */
export function isDrifted(
  task: Pick<Task, "scheduledAt" | "status" | "statusCategory">,
  now: Date = new Date(),
): boolean {
  if (!isOpenTask(task)) return false;
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
