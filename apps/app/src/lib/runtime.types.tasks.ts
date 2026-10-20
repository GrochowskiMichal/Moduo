/** The runtime port's tasks (implemented in runtime.web.tasks.ts). */

import type {
  ActivityEntry,
  Bucket,
  ProjectStatus,
  QueuePlacement,
  RecurrenceRule,
  Tag,
  TagLink,
  Task,
  TaskCompletion,
  TaskCycle,
  TaskQueueEntry,
  TaskRelation,
  TaskStatus,
  TaskStatusCategory,
  TasksCatchUpItem,
  TasksModuleBundle,
  TaskTimeEntry,
  TaskTimeResult,
  TaskTimeTotals,
  TimeBlockMap,
  TimeReportQuery,
  TimeReportResult,
  TrackTimeInput,
} from "../features/tasks/model";
import type { Truncation } from "./paged-select";
import type { TasksAgentsApi } from "./runtime.web.agents";
import type { TasksStructureApi } from "./runtime.web.structure";
import type { TasksTemplatesApi } from "./runtime.web.templates";
import type { TasksViewsApi } from "./runtime.web.views";
import type {
  SyncAccessResult,
  SyncIdsResult,
  SyncReadInput,
  SyncReadResult,
  SyncRows,
  SyncTableName,
  TaskSearchResult,
} from "./sync/types";
import type { TaskFieldPatch } from "./task-rows";

/**
 * TV-D10's structure around tasks (runtime.web.structure.ts): areas, project
 * fields ("bucket" calls stay as aliases), sections, teams, work sessions,
 * your reminders, Waiting on…; each write is an op. Time blocks keep their
 * own signatures above.
 */
export type TasksStructureRuntime = Omit<TasksStructureApi, "getTimeBlocks" | "setTimeBlocks">;

/**
 * TV-D15's templates and "Duplicate project…" (runtime.web.templates.ts):
 * reads under RLS, writes as ops; an apply or a duplicate answers with every
 * row it made. Optional: a runtime without them offers neither.
 */
export type TasksTemplatesRuntime = Partial<TasksTemplatesApi>;

/**
 * TV-U8's saved views (runtime.web.views.ts): the store reads `task_views`
 * through `syncRead`; these are the ops. Optional: a runtime without them
 * offers no views.
 */
export type TasksViewsRuntime = Partial<TasksViewsApi>;

/**
 * TV-D16's agent work and import runs (runtime.web.agents.ts): a session's
 * summary, posting or clearing it, the share switch, and your import runs.
 * Optional: a runtime without them shows no agent work.
 */
export type TasksAgentsRuntime = Partial<TasksAgentsApi>;

/**
 * Tasks module v1 — buckets / tasks / tags. Desktop reads/writes the
 * local-first redb store via Tauri commands; web talks to Supabase directly.
 * Both seed the reserved Inbox bucket lazily on first `list`.
 */
export type TasksRuntime = {
  list(workspaceId: string): Promise<TasksModuleBundle>;
  /**
   * The shared store's read (TV-D11a): one table's live rows, or every row
   * changed since a server stamp (deleted ones as ids). Paged by key, so a
   * row saved during the read is never skipped. Optional: a runtime without
   * it (test doubles) is read whole through `list` + `listQueue`.
   */
  syncRead?<T extends SyncTableName>(input: SyncReadInput<T>): Promise<SyncReadResult<SyncRows[T]>>;
  /** Every live id of a table you can see (tasks, buckets, statuses): what
   *  the store keeps after access was taken away. */
  syncIds?(input: { workspaceId: string; table: SyncTableName }): Promise<SyncIdsResult>;
  /**
   * The grant feed (TV-D11b): what changed in who can see which project or
   * task since a stamp (yours and the workspace's), so the store checks
   * access at once instead of at its next periodic check.
   */
  syncAccessChanges?(input: {
    workspaceId: string;
    since: string | null;
  }): Promise<SyncAccessResult>;
  /**
   * Search every task you can see on the server (`tasks_search`, TV-D11b):
   * every word in the title or the description's text. Ids only; the rows
   * come from the store (which reads the ones it lacks).
   */
  searchTasks?(input: {
    workspaceId: string;
    query: string;
    limit?: number;
  }): Promise<TaskSearchResult>;
  /**
   * Create a task under the id it carries (`tasks_op_create`, idempotent on
   * a resent id), so a capture sent again after a lost answer, or from the
   * offline queue, never makes two. Optional: `upsertTask` does the same.
   */
  createTask?(task: Task): Promise<Task>;
  seedInbox(workspaceId: string): Promise<Bucket>;
  /** The pre-TV-D10 project save (raw), kept as the "bucket" alias. New
   *  projects and edits go through `createProject` / `updateProject`;
   *  deleting, Recently deleted and access are in the structure part
   *  (`deleteProject`, `listTrash`, `restoreTrash`, `purgeTrash`, TV-U6). */
  upsertBucket(bucket: Bucket): Promise<Bucket>;
  /**
   * Create a task. The server records the creator; an assignee of "" means
   * the creator. Re-saving a task that exists writes its editable fields only.
   */
  upsertTask(task: Task): Promise<Task>;
  /**
   * Edit a task: sends only the fields in `patch` (TV-D1), so a save can't put
   * back what a teammate changed meanwhile in another field.
   */
  updateTask(input: { workspaceId: string; taskId: string; patch: TaskFieldPatch }): Promise<Task>;
  /**
   * The edit op itself (TV-D8, `tasks_op_update`): the task first, then any
   * subtasks the change carried along (a move takes them, a delete promotes
   * them). `updateTask` is this, first row only.
   */
  opUpdateTask(input: {
    workspaceId: string;
    taskId: string;
    patch: TaskFieldPatch;
  }): Promise<Task[]>;
  /** Soft-deletes through the edit op; its live subtasks move to the top level. */
  deleteTask(input: { workspaceId: string; taskId: string }): Promise<Task>;
  /**
   * Every completion in the workspace you can see (TV-D8), for the export;
   * `truncated` says when the read hit its cap.
   */
  listCompletions(
    workspaceId: string,
  ): Promise<{ completions: TaskCompletion[]; truncated: Truncation[] }>;
  /**
   * Statuses (TV-D9): every status the reader can see (the workspace default
   * set and each visible project's). Empty before the migration.
   */
  listStatuses(workspaceId: string): Promise<ProjectStatus[]>;
  /**
   * Status ops (`project_statuses_op_*`): add a status at the end of its
   * category in a project (null = the workspace default set); rename, hide
   * or show, and reorder inside the category (`after`: the status to follow,
   * null for first). Each answers with the whole set, in order.
   */
  createStatus(input: {
    workspaceId: string;
    projectId: string | null;
    category: TaskStatusCategory;
    name: string;
  }): Promise<ProjectStatus[]>;
  updateStatus(input: {
    workspaceId: string;
    statusId: string;
    patch: { name?: string; hidden?: boolean; after?: string | null };
  }): Promise<ProjectStatus[]>;
  /**
   * Delete a status: its tasks move to the first other status of its
   * category (`movedToName`); the last status of a category can't go.
   */
  deleteStatus(input: {
    workspaceId: string;
    statusId: string;
  }): Promise<{ moved: number; movedTo: string | null; movedToName: string | null }>;
  upsertTag(tag: Tag): Promise<Tag>;
  deleteTag(input: { workspaceId: string; tagId: string }): Promise<void>;
  attachTag(input: {
    workspaceId: string;
    tagId: string;
    entityType: string;
    entityId: string;
  }): Promise<TagLink>;
  detachTag(input: {
    workspaceId: string;
    tagId: string;
    entityType: string;
    entityId: string;
  }): Promise<void>;
  /**
   * All live workspace tags + the tag links attached to one entity. A light
   * read for non-task surfaces (contact/company hubs) that shouldn't pull
   * the whole tasks bundle just to render a tag row (fix pack FX-2).
   */
  listEntityTags(input: {
    workspaceId: string;
    entityType: string;
    entityId: string;
  }): Promise<{ tags: Tag[]; links: TagLink[] }>;
  /**
   * All live workspace tags + every tag link for the given entity types —
   * the directory's tag-filter read (fix pack FX-3). One indexed query pair;
   * omit `entityTypes` for all links.
   */
  listTagLinks(input: {
    workspaceId: string;
    entityTypes?: string[];
  }): Promise<{ tags: Tag[]; links: TagLink[]; truncated: Truncation[] }>;
  /** Blocked-by dependency edge (blocker → blocked, spec §5c). Idempotent. */
  createTaskRelation(input: {
    workspaceId: string;
    blockerTaskId: string;
    blockedTaskId: string;
  }): Promise<TaskRelation>;
  deleteTaskRelation(input: { workspaceId: string; relationId: string }): Promise<void>;
  /** Your time-of-day slot → project map in a workspace (yours alone since TV-D10). */
  getTimeBlocks(workspaceId: string): Promise<TimeBlockMap>;
  setTimeBlocks(input: { workspaceId: string; blocks: TimeBlockMap }): Promise<TimeBlockMap>;

  /**
   * Intent ops (docs/moduo-module-contract.md): named, invariant-keeping
   * mutations via `tasks_op_*` RPCs — server-side permission check,
   * invariants, write, and an attributed activity row in one transaction.
   * Each returns the updated row(s) for optimistic reconciliation.
   */
  /**
   * The day's commit queue, kept for builds from before TV-D4: since TV-D2
   * these also add the task to (commit) or take it out of (uncommit, skip)
   * the caller's personal queue, and skip no longer counts as a reschedule.
   * Removed in TV-D7.
   */
  opCommit(input: { workspaceId: string; taskId: string; forDate: string }): Promise<Task>;
  opUncommit(input: { workspaceId: string; taskId: string }): Promise<Task>;
  opSkipToday(input: { workspaceId: string; taskId: string }): Promise<Task>;
  /**
   * Personal queues (TV-D2): every queue row the caller can see in the
   * workspace — their own line-up and other people's claims on tasks they
   * can see — sorted by person, then position. Empty until the migration
   * reaches the database.
   */
  listQueue(workspaceId: string): Promise<TaskQueueEntry[]>;
  /**
   * Queue ops (TV-D2). Each acts on the caller's own queue (an API key on
   * its creator's) and returns that queue in order. Adding puts a task at
   * the end (or the top) and leaves an already-queued task where it is
   * unless asked for the top; reorder places it right after `afterTaskId`,
   * or first when that is null; move-to-end is Skip in a run. Adding and
   * removing are logged; moves are not, and none counts as a reschedule.
   */
  opQueueAdd(input: {
    workspaceId: string;
    taskId: string;
    at?: QueuePlacement;
  }): Promise<TaskQueueEntry[]>;
  opQueueRemove(input: { workspaceId: string; taskId: string }): Promise<TaskQueueEntry[]>;
  opQueueReorder(input: {
    workspaceId: string;
    taskId: string;
    afterTaskId: string | null;
  }): Promise<TaskQueueEntry[]>;
  opQueueMoveToEnd(input: { workspaceId: string; taskId: string }): Promise<TaskQueueEntry[]>;
  /**
   * Tracked time (TV-D3), through `tasks_op_track_time`: append a finished
   * focus or waiting stretch, an adjustment, or the one that makes the total
   * a typed value, or undo your own adjustment. It changes only the task's
   * time total, never the rest of the row. A save resent with the same `key`
   * counts once (`duplicate`); a task deleted for good or no longer shared
   * answers `gone`. Until the migration reaches the database it writes the
   * old total column instead.
   */
  trackTime(input: TrackTimeInput): Promise<TaskTimeResult>;
  /**
   * Each visible task's time in the workspace: the total, your share, your
   * waiting time and, with `since`, your share since then. Empty until the
   * migration reaches the database.
   */
  listTimeTotals(workspaceId: string, since?: string | null): Promise<TaskTimeTotals[]>;
  /**
   * Your own time entries on a task (TV-D14), newest first: what "Add time…"
   * logged, Focus stretches, adjustments and give-backs. Only on a task you
   * can see. Empty until the migration reaches the database.
   */
  listMyTimeEntries(workspaceId: string, taskId: string): Promise<TaskTimeEntry[]>;
  /**
   * The time report's rows (TV-D14, `tasks_time_report`): one per entry, on
   * tasks the reader can see, dated in `query.zone`; yours, and for the
   * workspace owner the time of people who share theirs. Paged past
   * PostgREST's row cap; `truncated` when it held more than it reads.
   */
  timeReport(query: TimeReportQuery): Promise<TimeReportResult>;
  /** Your own time entries in a workspace, on tasks you can see, for the data export (TV-D14). */
  exportTimeEntries(
    workspaceId: string,
  ): Promise<{ entries: TaskTimeEntry[]; truncated: Truncation[] }>;
  /**
   * Assign (or, with null, unassign) through `tasks_op_assign`: the person
   * has to be a member who can work on tasks. Assigning someone else
   * notifies them once.
   */
  opAssign(input: {
    workspaceId: string;
    taskId: string;
    assigneeId: string | null;
  }): Promise<Task>;
  /**
   * Take an unclaimed task of a team you're in (TV-D13, `tasks_op_claim`):
   * it becomes yours and keeps its team. Needs Edit on the task; one someone
   * else took first is refused ("Someone already took this task.").
   */
  opClaim(input: { workspaceId: string; taskId: string }): Promise<Task>;
  opSetStatus(input: {
    workspaceId: string;
    taskId: string;
    /**
     * A legacy status, a category word (`backlog`, `wont_do`, …), one of the
     * project's status ids or one of its status names (TV-D9). The server
     * keeps a status already in a category it's given.
     */
    status: TaskStatus | TaskStatusCategory | (string & {});
    recurrence?: RecurrenceRule | null;
    position?: string;
  }): Promise<Task>;
  opReschedule(input: {
    workspaceId: string;
    taskId: string;
    scheduledAt: string;
    days?: number;
  }): Promise<Task>;
  opUnschedule(input: { workspaceId: string; taskId: string }): Promise<Task>;
  opSkipOccurrence(input: {
    workspaceId: string;
    taskId: string;
    scheduledAt: string;
    recurrence: RecurrenceRule;
    releaseCommit: boolean;
  }): Promise<Task>;
  /**
   * "Move just this one" (TV-D12): move this cycle's due date or its work
   * session's start; the other date moves by the same days and the rule
   * stays (the next cycle is back on the pattern). One of the two.
   */
  opMoveOccurrence(input: {
    workspaceId: string;
    taskId: string;
    dueOn?: string | null;
    startsAt?: string | null;
  }): Promise<Task>;
  /** A repeat's cycles, done and skipped, with your own tracked time (TV-D12). */
  taskHistory(input: { workspaceId: string; taskId: string }): Promise<TaskCycle[]>;
  /**
   * Which of these tasks an API key made, with the trail's label for it
   * ("Alex · via Claude Desktop"; TV-U13b, the Inbox's agent chip). Read from
   * the tasks' `tasks.create` trail rows, so only tasks the caller can see
   * answer. Batched; tasks no key made are left out.
   */
  listAgentCaptures(input: {
    workspaceId: string;
    taskIds: readonly string[];
  }): Promise<Array<{ taskId: string; label: string }>>;
  /** Notify the people picked by `@` in a task's description (TV-D12). */
  mentionInTask(input: { workspaceId: string; taskId: string; userIds: string[] }): Promise<number>;
  /**
   * Ask the server to roll this workspace's repeats over now (TV-D8): it
   * answers with what changed, plus the tasks named in `items`, as it has
   * them. Builds since TV-D8 send no items; the server's engine decides.
   */
  opCatchUp(input: { workspaceId: string; items: TasksCatchUpItem[] }): Promise<Task[]>;
  /** Read the entity's quiet activity trail (newest first). */
  listActivity(input: {
    workspaceId: string;
    entityType: string;
    entityId: string;
    limit?: number;
    /** Scope to one module (e.g. "tasks"). Omit to read across all modules —
     * what a spine entity (contact/company) needs, since its activity is logged
     * under module='contacts', not 'tasks'. */
    module?: string;
  }): Promise<ActivityEntry[]>;
} & TasksStructureRuntime &
  TasksTemplatesRuntime &
  TasksViewsRuntime &
  TasksAgentsRuntime;
