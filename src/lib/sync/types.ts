// The shared store's vocabulary (Tasks v3 TV-D11a, spec §Assumptions #7).
//
// Every table the store keeps is named here with the model it holds. The
// runtime's `tasks.syncRead` reads one table at a time (a delta since a
// server stamp, or its live rows), and the store keeps one map per table.
// Adding a table (TV-D10's areas, sections, sessions…) is one entry here, one
// source in `runtime.web.ts` (SYNC_SOURCES) and one line in `tables.ts`.

import type {
  Bucket,
  ProjectStatus,
  Tag,
  TagLink,
  Task,
  TaskCompletion,
  TaskQueueEntry,
  TaskRelation,
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
};

export type SyncReadResult<R = unknown> = {
  /** Live rows, mapped (rows that couldn't be read are dropped). */
  rows: R[];
  /** Ids of rows deleted since `since` (soft deletes). */
  deleted: string[];
  /** The newest server `updated_at` among the rows read (live or deleted). */
  maxUpdatedAt: string | null;
  /** Set when the read stopped at its ceiling. */
  truncated: Truncation | null;
};

/** Every live id of a table the reader can see: the access check (rows that
 *  were taken away from you never show up in a delta). */
export type SyncIdsResult = { ids: string[]; complete: boolean };
