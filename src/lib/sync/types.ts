// The shared store's vocabulary (Tasks v3 TV-D11a, spec §Assumptions #7).
//
// Every table the store keeps is named here with the model it holds. The
// runtime's `tasks.syncRead` reads one table at a time (a delta since a
// server stamp, or its live rows), and the store keeps one map per table.
// Adding a table is one entry here, one source in `runtime.web.ts`
// (SYNC_SOURCES), one line in `store.ts` (SYNC_TABLES, and ACCESS_CHECKED for
// a delta table RLS can hide rows of) and its Realtime mapping in
// `features/tasks/live.ts` if it is published.

import type {
  Area,
  Bucket,
  ProjectStatus,
  Section,
  Tag,
  TagLink,
  Task,
  TaskCompletion,
  TaskQueueEntry,
  TaskRelation,
  TaskReminder,
  TaskSession,
  TaskWaitingEntry,
  Team,
  TeamMember,
} from "../../features/tasks/model";
import type { Truncation } from "../paged-select";

/**
 * A task comment, as far as the counts need it (the body never comes along).
 * Only comments on tasks are read.
 */
export type CommentMark = {
  id: string;
  taskId: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** Each synced table and the model the store holds for it. */
export type SyncRows = {
  tasks: Task;
  buckets: Bucket;
  statuses: ProjectStatus;
  queue: TaskQueueEntry;
  relations: TaskRelation;
  completions: TaskCompletion;
  tags: Tag;
  tagLinks: TagLink;
  comments: CommentMark;
  // TV-D10's structure and the task's own rows.
  areas: Area;
  sections: Section;
  teams: Team;
  teamMembers: TeamMember;
  sessions: TaskSession;
  /** Only your own (RLS returns nobody else's). */
  reminders: TaskReminder;
  waiting: TaskWaitingEntry;
};

export type SyncTableName = keyof SyncRows;

/**
 * One read of one table.
 *  - `since` null: the table's live rows (a first load).
 *  - `since` a server stamp: every row changed at or after it, deleted ones
 *    included (`deleted` lists their ids). Tables without `updated_at` and
 *    `deleted_at` (queue, tag links, relations) ignore it and read everything.
 *  - `part` (tasks, first load only): "open" = To do and In progress; "rest" =
 *    everything else (Done, Won't do, Backlog), read after the open ones.
 */
export type SyncReadInput<T extends SyncTableName = SyncTableName> = {
  workspaceId: string;
  table: T;
  since: string | null;
  part?: "open" | "rest";
  /** Only these rows (live ones): what the access check found you can see now. */
  ids?: readonly string[];
};

export type SyncReadResult<R = unknown> = {
  /** Live rows, mapped (rows that couldn't be read are dropped). */
  rows: R[];
  /** Ids of rows deleted since `since` (soft deletes, or tombstones of hard ones). */
  deleted: string[];
  /** The newest server `updated_at` among the rows read (live or deleted). */
  maxUpdatedAt: string | null;
  /** Set when the read stopped at its ceiling. */
  truncated: Truncation | null;
  /**
   * The answer is every live row, though changes were asked for: a table
   * without stamps or tombstones on this database (before TV-D11b's
   * migration) is read whole. What it lacks is gone.
   */
  whole?: boolean;
};

/** Every live id of a table the reader can see: the access check (rows that
 *  were taken away from you never show up in a delta). */
export type SyncIdsResult = { ids: string[]; complete: boolean };

/**
 * One change in what someone can see (TV-D11b's grant feed): a project or a
 * task was shared or unshared, a task moved project, or a member's role
 * changed (`workspace`). It names the thing, never its contents.
 */
export type AccessChange = {
  /** The feed row's id: a read that overlaps an earlier one handles it once. */
  id?: string;
  resourceType: "bucket" | "task" | "workspace" | (string & {});
  resourceId: string;
  changedAt: string;
};

export type SyncAccessResult = {
  changes: AccessChange[];
  /** The newest `changedAt` read (the next read's cursor). */
  maxChangedAt: string | null;
  /** False when the database has no feed yet (before TV-D11b's migration). */
  supported: boolean;
};

/** The server's search over every task you can see (`tasks_search`, TV-D11b). */
export type TaskSearchResult = {
  /** Matching task ids, newest change first. */
  ids: string[];
  /** False when the database has no `tasks_search` yet: search the copy only. */
  supported: boolean;
};
