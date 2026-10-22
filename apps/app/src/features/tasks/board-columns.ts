// The Board's columns and lanes (TV-U11; tasks-v3 §5, calls 22, 22a, 53a,
// 53b, 85, 86, default o): which columns a board shows and in what order,
// what each holds, what a drop into one writes, and what its "+" adds. Pure:
// no React, no IO.
//
//   • One project's board grouped by status shows the project's own statuses
//     (53a), each with its category's icon; the Inbox uses the workspace
//     default set. Boards across projects show the five categories, or the
//     shared names when every project in view uses the same ones.
//   • Statuses, sections and priorities always show (they're the project's
//     shape and its drop targets); assignee, team, project and area columns
//     hide when empty (default o).
//   • Backlog and Won't do start folded (53b); Won't do shows only while a
//     card needs it or Filter → Status asks for it (U2-4).
//   • The UI says "section", never "column" (22a): these are the Board's own
//     words for its layout, never shown.

import {
  type PriorityLevel,
  type TaskStatusCategory,
  type TaskWaitingKind,
  taskCategoryOf,
} from "@contracts/vocabularies";
import type { BoardGroupBy, BoardLanes } from "./display";
import type { StatusFilter } from "./filters";
import { type GroupBy, groupKeyFor, groupTasks, isProjectScope, PRIORITY_LABELS } from "./helpers";
import { type GroupAddState, groupAddState } from "./list-group-add";
import type { Bucket, ProjectStatus, Task, TaskWaitingEntry } from "./model";
import {
  categoryKey,
  firstStatusOf,
  STATUS_KEY_LABELS,
  type StatusKey,
  sortStatuses,
  statusKeyCategory,
  statusKeyOf,
  statusSetFor,
} from "./statuses";

/** What a drop into a column (or a lane) writes. */
export type BoardTarget =
  /** A status: by id (one project's), by name (shared names across
   *  projects: each task takes its own project's status of that name), or
   *  by category (the project's first of it). */
  | { field: "status"; key: StatusKey; statusId: string | null; name: string | null }
  | { field: "priority"; value: PriorityLevel | null }
  | { field: "assignee"; value: string | null }
  | { field: "section"; value: string | null }
  | { field: "team"; value: string | null }
  | { field: "project"; value: string }
  /** Waiting on someone or something (TV-U12): a drop adds the entry, it
   *  writes no field. */
  | { field: "waiting"; kind: TaskWaitingKind; ref: string | null; label: string | null };

/** What a column or lane leads with. */
export type BoardMark =
  | { kind: "status"; category: TaskStatusCategory }
  /** The List's group mark for the same grouping (priority, project, person, team). */
  | { kind: "group"; groupBy: GroupBy; key: string }
  /** An area's dot. */
  | { kind: "dot"; color: string | null }
  | null;

export type BoardColumn = {
  /** The droppable's id: `col:<dim>:<key>`. */
  id: string;
  key: string;
  label: string;
  mark: BoardMark;
  /** What a drop writes; null: it takes no drops (an area, a former member). */
  target: BoardTarget | null;
  /** Shown even when empty (statuses, sections, priorities). */
  persistent: boolean;
  /** Folded until unfolded (Backlog, Won't do). */
  startsFolded: boolean;
  /** The header's "+" (default n). */
  add: GroupAddState;
  /** Every task in it, in the board's order (completed ones included). */
  tasks: Task[];
  /** A status column's category: a card names its own status when it differs. */
  category?: TaskStatusCategory;
  /** One project's own status (its ⋯ edits the project's statuses). */
  statusId?: string;
  /** A section of the project (its ⋯: Rename, Delete). */
  sectionId?: string;
};

export type BoardLane = {
  key: string;
  label: string;
  mark: BoardMark;
  /** What a drop into another lane writes; null: lanes here take no moves
   *  (Project lanes: a move to another project stays a deliberate Move). */
  target: BoardTarget | null;
  /** Every task in it, in the board's order. */
  tasks: Task[];
};

export type BoardContext = {
  /** The page's selection: "all" | "mine" | "today" | "upcoming" | "inbox" | a project id. */
  scope: string;
  groupBy: BoardGroupBy;
  inboxId: string | null;
  canEdit: boolean;
  /** Today's date key (the "+" of date-like groups counts from it). */
  today: string;
  /** Every status this reader can see (the default set and each project's). */
  statuses: readonly ProjectStatus[];
  /** The projects in rail order (the Inbox may be among them). */
  buckets: readonly Pick<Bucket, "id" | "isSystem" | "areaId">[];
  bucketName: (id: string) => string;
  sections?: ReadonlyArray<{ id: string; projectId: string; name: string; position: number }>;
  teams?: ReadonlyArray<{ id: string; name: string }>;
  /** Members in picker order (me first). */
  assignees?: ReadonlyArray<{ userId: string; name: string; canTakeTasks: boolean }>;
  areas?: ReadonlyArray<{ id: string; name: string; color: string | null; position: number }>;
  /** What Filter → Status lets through (null: no Status filter). */
  statusFilter?: StatusFilter | null;
  /** Waiting on entries of the tasks in view (Group by Waiting on). */
  waiting?: ReadonlyArray<Pick<TaskWaitingEntry, "taskId" | "kind" | "ref" | "label" | "since">>;
};

/** The no-value key of the assignee, section and team groupings. */
const NONE = "none";

/** The project a board is one of (a project, or the Inbox), else null. */
export function boardProject(
  ctx: Pick<BoardContext, "scope" | "inboxId" | "buckets">,
): Pick<Bucket, "id" | "isSystem" | "areaId"> | null {
  const id = ctx.scope === "inbox" ? ctx.inboxId : isProjectScope(ctx.scope) ? ctx.scope : null;
  return id ? (ctx.buckets.find((b) => b.id === id) ?? null) : null;
}

/** The Group by a board really uses: Section only inside a project with a
 *  place for sections, Project and Area only across projects. */
export function effectiveBoardGroup(
  ctx: Pick<BoardContext, "scope" | "inboxId" | "buckets" | "groupBy">,
): BoardGroupBy {
  const project = boardProject(ctx);
  const across = ctx.scope === "all" || ctx.scope === "mine";
  switch (ctx.groupBy) {
    case "section":
      return project && !project.isSystem ? "section" : "status";
    case "bucket":
    case "area":
      return across ? ctx.groupBy : "status";
    default:
      return ctx.groupBy;
  }
}

/**
 * The board's columns, in order, each with its tasks (`tasks` already in the
 * board's order). Every task is in exactly one column.
 */
export function buildBoardColumns(tasks: readonly Task[], ctx: BoardContext): BoardColumn[] {
  switch (effectiveBoardGroup(ctx)) {
    case "section":
      return sectionColumns(tasks, ctx);
    case "assignee":
      return assigneeColumns(tasks, ctx);
    case "team":
      return teamColumns(tasks, ctx);
    case "priority":
      return priorityColumns(tasks, ctx);
    case "bucket":
      return projectColumns(tasks, ctx);
    case "area":
      return areaColumns(tasks, ctx);
    case "waiting":
      return waitingColumns(tasks, ctx);
    default:
      return statusColumns(tasks, ctx);
  }
}

// ── status ──────────────────────────────────────────────────────────────────

/** The cross-project order: Backlog first (folded), Won't do last. */
const CATEGORY_KEYS: StatusKey[] = ["backlog", "todo", "in_progress", "done", "archived"];

function statusColumns(tasks: readonly Task[], ctx: BoardContext): BoardColumn[] {
  const project = boardProject(ctx);
  const set = project ? statusSetFor(ctx.statuses, project) : [];
  if (set.length > 0) return projectStatusColumns(tasks, set, ctx);
  const shared = project ? null : sharedStatusNames(tasks, ctx);
  if (shared) return namedStatusColumns(tasks, shared, ctx);
  return categoryColumns(tasks, ctx);
}

/** Whether a status column shows: always, except Won't do (only while a card
 *  needs it) and hidden statuses (only while in use); a Status filter shows
 *  what it lets through, plus any column a kept card needs (U2-4). */
function statusShows(
  key: StatusKey,
  has: boolean,
  ctx: BoardContext,
  opts: { hidden?: boolean; backlogWhenEmpty: boolean; statusId?: string },
): boolean {
  if (has) return true;
  if (ctx.statusFilter) return ctx.statusFilter.has(key, opts.statusId);
  if (opts.hidden) return false;
  if (key === "archived") return false;
  if (key === "backlog") return opts.backlogWhenEmpty;
  return true;
}

/** A status column's "+": its category, and its own status when it isn't
 *  the category's first where the new task files (the capture files there
 *  by id). `own` picks it from the set of where the "+" files: the board's
 *  project, or (with no project) your Inbox's, the workspace default. */
function statusAdd(
  ctx: BoardContext,
  key: StatusKey,
  own: (set: readonly ProjectStatus[]) => ProjectStatus | null,
): GroupAddState {
  const add = addFor(ctx, "status", key);
  if (add.kind !== "add") return add;
  const files = add.add.projectId
    ? ctx.buckets.find((b) => b.id === add.add.projectId)
    : ctx.buckets.find((b) => b.id === ctx.inboxId);
  const set = statusSetFor(ctx.statuses, files);
  const status = own(set);
  // The category's first is what the capture picks anyway: no chip for it.
  if (!status || firstStatusOf(set, status.category)?.id === status.id) return add;
  return {
    kind: "add",
    add: {
      ...add.add,
      seed: { ...add.add.seed, statusId: status.id, statusName: status.name },
    },
  };
}

/** No status of its own: the category's first. */
const NO_OWN = () => null;

function projectStatusColumns(
  tasks: readonly Task[],
  set: readonly ProjectStatus[],
  ctx: BoardContext,
): BoardColumn[] {
  const known = new Set(set.map((s) => s.id));
  const byStatus = new Map<string, Task[]>();
  const orphans: Task[] = [];
  for (const task of tasks) {
    // Its own status, else its category's first (a status not read yet).
    const home =
      task.statusId && known.has(task.statusId)
        ? task.statusId
        : (firstStatusOf(set, taskCategoryOf(task))?.id ?? null);
    if (!home) {
      orphans.push(task);
      continue;
    }
    const list = byStatus.get(home);
    if (list) list.push(task);
    else byStatus.set(home, [task]);
  }
  const columns = sortStatuses(set)
    .filter((s) => {
      const key = categoryKey(s.category);
      return statusShows(key, (byStatus.get(s.id)?.length ?? 0) > 0, ctx, {
        hidden: s.hidden,
        // A project's Backlog is part of its shape (the folded button).
        backlogWhenEmpty: true,
        statusId: s.id,
      });
    })
    .map<BoardColumn>((s) => {
      const key = categoryKey(s.category);
      return {
        id: `col:status:${s.id}`,
        key: s.id,
        label: s.name,
        mark: { kind: "status", category: s.category },
        target: { field: "status", key, statusId: s.id, name: null },
        persistent: true,
        startsFolded: s.category === "backlog" || s.category === "wont_do",
        add: statusAdd(ctx, key, (into) => into.find((x) => x.id === s.id) ?? null),
        tasks: byStatus.get(s.id) ?? [],
        category: s.category,
        statusId: s.id,
      };
    });
  // A card is never lost: one whose category the set lacks goes first.
  if (orphans.length > 0 && columns[0]) columns[0].tasks = [...orphans, ...columns[0].tasks];
  return columns;
}

function categoryColumns(tasks: readonly Task[], ctx: BoardContext): BoardColumn[] {
  const byKey = new Map<StatusKey, Task[]>();
  for (const task of tasks) {
    const key = statusKeyOf(task);
    const list = byKey.get(key);
    if (list) list.push(task);
    else byKey.set(key, [task]);
  }
  return CATEGORY_KEYS.filter((key) =>
    statusShows(key, (byKey.get(key)?.length ?? 0) > 0, ctx, { backlogWhenEmpty: false }),
  ).map((key) => ({
    id: `col:status:${key}`,
    key,
    label: STATUS_KEY_LABELS[key],
    mark: { kind: "status", category: statusKeyCategory(key) },
    target: { field: "status", key, statusId: null, name: null },
    persistent: true,
    startsFolded: key === "backlog" || key === "archived",
    add: statusAdd(ctx, key, NO_OWN),
    tasks: byKey.get(key) ?? [],
    category: statusKeyCategory(key),
  }));
}

/** A status name compared: case, spaces and the apostrophe's shape don't count. */
export function statusNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ");
}

type SharedStatus = {
  name: string;
  nameKey: string;
  category: TaskStatusCategory;
  hidden: boolean;
};

/**
 * The status names every project in view shares (53a: "if every project in
 * view uses the same names, they group by name"), or null. Null too when the
 * shared set is just the five categories by their usual names: the category
 * columns are the same board.
 */
export function sharedStatusNames(
  tasks: readonly Task[],
  ctx: Pick<BoardContext, "statuses" | "buckets">,
): SharedStatus[] | null {
  const projectIds = [...new Set(tasks.map((t) => t.bucketId))];
  if (projectIds.length === 0) return null;
  let shared: SharedStatus[] | null = null;
  let signature: string | null = null;
  for (const id of projectIds) {
    const bucket = ctx.buckets.find((b) => b.id === id);
    const set = statusSetFor(ctx.statuses, bucket);
    if (set.length === 0) return null;
    const list = set.map((s) => ({
      name: s.name,
      nameKey: statusNameKey(s.name),
      hidden: s.hidden,
      category: s.category,
    }));
    const sig = list.map((s) => `${s.category}:${s.nameKey}`).join("|");
    if (signature === null) {
      signature = sig;
      shared = list;
    } else if (sig !== signature) return null;
  }
  if (!shared) return null;
  const plain =
    shared.length === CATEGORY_KEYS.length &&
    shared.every((s) => s.nameKey === statusNameKey(STATUS_KEY_LABELS[categoryKey(s.category)]));
  return plain ? null : shared;
}

function namedStatusColumns(
  tasks: readonly Task[],
  shared: readonly SharedStatus[],
  ctx: BoardContext,
): BoardColumn[] {
  const byId = new Map(ctx.statuses.map((s) => [s.id, s]));
  const byName = new Map<string, Task[]>();
  for (const task of tasks) {
    const own = task.statusId ? byId.get(task.statusId) : undefined;
    const category = taskCategoryOf(task);
    const nameKey =
      own && own.category === category
        ? statusNameKey(own.name)
        : (shared.find((s) => s.category === category)?.nameKey ?? null);
    const key = nameKey ?? shared[0]?.nameKey ?? "";
    const list = byName.get(key);
    if (list) list.push(task);
    else byName.set(key, [task]);
  }
  return shared
    .filter((s) =>
      statusShows(categoryKey(s.category), (byName.get(s.nameKey)?.length ?? 0) > 0, ctx, {
        hidden: s.hidden,
        backlogWhenEmpty: false,
      }),
    )
    .map((s) => {
      const key = categoryKey(s.category);
      return {
        id: `col:status:name:${s.nameKey}`,
        key: s.nameKey,
        label: s.name,
        mark: { kind: "status", category: s.category },
        target: { field: "status", key, statusId: null, name: s.nameKey },
        persistent: true,
        startsFolded: s.category === "backlog" || s.category === "wont_do",
        // Where the "+" files (your Inbox, from My tasks): its status of this name.
        add: statusAdd(
          ctx,
          key,
          (into) =>
            into.find((x) => x.category === s.category && statusNameKey(x.name) === s.nameKey) ??
            null,
        ),
        tasks: byName.get(s.nameKey) ?? [],
        category: s.category,
      };
    });
}

// ── section ─────────────────────────────────────────────────────────────────

function sectionColumns(tasks: readonly Task[], ctx: BoardContext): BoardColumn[] {
  const project = boardProject(ctx);
  const sections = (ctx.sections ?? [])
    .filter((s) => s.projectId === project?.id)
    .slice()
    .sort((a, b) => a.position - b.position);
  const known = new Set(sections.map((s) => s.id));
  const bySection = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.sectionId && known.has(task.sectionId) ? task.sectionId : NONE;
    const list = bySection.get(key);
    if (list) list.push(task);
    else bySection.set(key, [task]);
  }
  const column = (key: string, label: string): BoardColumn => ({
    id: `col:section:${key}`,
    key,
    label,
    mark: null,
    target: { field: "section", value: key === NONE ? null : key },
    persistent: true,
    startsFolded: false,
    add: addFor(ctx, "section", key),
    tasks: bySection.get(key) ?? [],
    ...(key === NONE ? {} : { sectionId: key }),
  });
  // "No section" first: the top of the project, as in the List.
  return [column(NONE, "No section"), ...sections.map((s) => column(s.id, s.name))];
}

// ── people, teams, priority (the List's groups and labels) ─────────────────

/** One column per group the List would show, plus the empty ones a board keeps. */
function listGroupColumns(
  tasks: readonly Task[],
  ctx: BoardContext,
  groupBy: "assignee" | "team" | "priority",
  candidates: readonly string[],
  opts: {
    persistent: boolean;
    target: (key: string) => BoardTarget | null;
    label: (key: string) => string;
  },
): BoardColumn[] {
  const groups = groupTasks([...tasks], groupBy, {
    bucketName: ctx.bucketName,
    teams: ctx.teams,
    assignees: ctx.assignees,
  });
  const byKey = new Map(groups.map((g) => [g.key, g]));
  // The candidates in their order (empty ones too), then whatever else has
  // tasks (a former member, a team gone), with the no-value group last.
  const extra = groups.map((g) => g.key).filter((k) => !candidates.includes(k));
  const keys = [
    ...candidates.filter((k) => k !== NONE),
    ...extra,
    ...(candidates.includes(NONE) ? [NONE] : []),
  ];
  return keys.map((key) => ({
    id: `col:${groupBy}:${key}`,
    key,
    label: byKey.get(key)?.label ?? opts.label(key),
    mark: { kind: "group", groupBy, key },
    target: opts.target(key),
    persistent: opts.persistent,
    startsFolded: false,
    add: addFor(ctx, groupBy, key),
    tasks: byKey.get(key)?.tasks ?? [],
  }));
}

function assigneeColumns(tasks: readonly Task[], ctx: BoardContext): BoardColumn[] {
  const people = ctx.assignees ?? [];
  const takes = new Set(people.filter((p) => p.canTakeTasks).map((p) => p.userId));
  return listGroupColumns(tasks, ctx, "assignee", [...people.map((p) => p.userId), NONE], {
    persistent: false,
    // A former member or a viewer can't take tasks: their column takes no drops.
    target: (key) =>
      key === NONE
        ? { field: "assignee", value: null }
        : takes.has(key)
          ? { field: "assignee", value: key }
          : null,
    label: (key) =>
      key === NONE ? "Unassigned" : (people.find((p) => p.userId === key)?.name ?? "Former member"),
  });
}

function teamColumns(tasks: readonly Task[], ctx: BoardContext): BoardColumn[] {
  const teams = [...(ctx.teams ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const live = new Set(teams.map((t) => t.id));
  return listGroupColumns(tasks, ctx, "team", [...teams.map((t) => t.id), NONE], {
    persistent: false,
    target: (key) =>
      key === NONE
        ? { field: "team", value: null }
        : live.has(key)
          ? { field: "team", value: key }
          : null,
    label: (key) =>
      key === NONE ? "No team" : (teams.find((t) => t.id === key)?.name ?? "Former team"),
  });
}

function priorityColumns(tasks: readonly Task[], ctx: BoardContext): BoardColumn[] {
  return listGroupColumns(tasks, ctx, "priority", ["high", "medium", "low", "unset"], {
    persistent: true,
    target: (key) => ({
      field: "priority",
      value: key === "unset" ? null : (key as PriorityLevel),
    }),
    label: (key) => (key === "unset" ? "Unset" : PRIORITY_LABELS[key as PriorityLevel]),
  });
}

// ── across projects ─────────────────────────────────────────────────────────

function projectColumns(tasks: readonly Task[], ctx: BoardContext): BoardColumn[] {
  const byProject = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = byProject.get(task.bucketId);
    if (list) list.push(task);
    else byProject.set(task.bucketId, [task]);
  }
  // The Inbox first, then the rail's order; a project the rail doesn't list
  // (shared with you, archived meanwhile) after them.
  const rail = ctx.buckets.map((b) => b.id);
  const order = [
    ...(ctx.inboxId ? [ctx.inboxId] : []),
    ...rail.filter((id) => id !== ctx.inboxId),
    ...[...byProject.keys()].filter((id) => id !== ctx.inboxId && !rail.includes(id)),
  ];
  return order.map((id) => ({
    id: `col:bucket:${id}`,
    key: id,
    label: ctx.bucketName(id),
    mark: { kind: "group", groupBy: "bucket", key: id },
    target: { field: "project", value: id },
    persistent: false,
    startsFolded: false,
    add: addFor(ctx, "bucket", id),
    tasks: byProject.get(id) ?? [],
  }));
}

function areaColumns(tasks: readonly Task[], ctx: BoardContext): BoardColumn[] {
  const areaOf = new Map(ctx.buckets.map((b) => [b.id, b.areaId ?? null]));
  const areas = [...(ctx.areas ?? [])].sort((a, b) => a.position - b.position);
  const known = new Set(areas.map((a) => a.id));
  const byArea = new Map<string, Task[]>();
  for (const task of tasks) {
    const area = areaOf.get(task.bucketId) ?? null;
    const key = area && known.has(area) ? area : NONE;
    const list = byArea.get(key);
    if (list) list.push(task);
    else byArea.set(key, [task]);
  }
  // An area comes from its project: a card can't be dropped into one.
  const column = (key: string, label: string, color: string | null): BoardColumn => ({
    id: `col:area:${key}`,
    key,
    label,
    mark: key === NONE ? null : { kind: "dot", color },
    target: null,
    persistent: false,
    startsFolded: false,
    add: { kind: "none" },
    tasks: byArea.get(key) ?? [],
  });
  return [...areas.map((a) => column(a.id, a.name, a.color)), column(NONE, "No area", null)];
}

// ── waiting on (TV-U12, deferred here by TV-U11) ────────────────────────────

/** A waiting entry's column key: the person, or the words (any case). */
function waitingKeyOf(entry: Pick<TaskWaitingEntry, "kind" | "ref" | "label">): string {
  if (entry.kind === "text") return `text:${(entry.label ?? "").trim().toLowerCase()}`;
  return `${entry.kind}:${entry.ref ?? entry.label ?? ""}`;
}

/**
 * One column per someone or something a task waits on, then "Not waiting".
 * A task waiting on several sits under the newest (a drop adds a newer one,
 * so the card follows the drop). Columns hide when empty (default o); "Not
 * waiting" takes no drops: a wait ends when what it waits on arrives, or
 * from the panel.
 */
function waitingColumns(tasks: readonly Task[], ctx: BoardContext): BoardColumn[] {
  const inView = new Set(tasks.map((t) => t.id));
  const newest = new Map<string, Pick<TaskWaitingEntry, "kind" | "ref" | "label" | "since">>();
  for (const entry of ctx.waiting ?? []) {
    if (!inView.has(entry.taskId)) continue;
    const had = newest.get(entry.taskId);
    if (!had || entry.since > had.since) newest.set(entry.taskId, entry);
  }
  const byKey = new Map<
    string,
    { entry: Pick<TaskWaitingEntry, "kind" | "ref" | "label">; tasks: Task[] }
  >();
  const none: Task[] = [];
  for (const task of tasks) {
    const entry = newest.get(task.id);
    if (!entry) {
      none.push(task);
      continue;
    }
    const key = waitingKeyOf(entry);
    const col = byKey.get(key);
    if (col) col.tasks.push(task);
    else byKey.set(key, { entry, tasks: [task] });
  }
  const nameOf = (entry: Pick<TaskWaitingEntry, "kind" | "ref" | "label">) => {
    if (entry.kind === "person") {
      return (
        ctx.assignees?.find((a) => a.userId === entry.ref)?.name ?? entry.label ?? "A former member"
      );
    }
    return entry.label?.trim() || (entry.kind === "email" ? "An email" : "An agent");
  };
  const columns: BoardColumn[] = [...byKey.entries()]
    .map(([key, { entry, tasks: list }]) => ({
      id: `col:waiting:${key}`,
      key,
      label: nameOf(entry),
      mark:
        entry.kind === "person" && entry.ref
          ? ({ kind: "group", groupBy: "assignee", key: entry.ref } as const)
          : null,
      target: {
        field: "waiting" as const,
        kind: entry.kind,
        ref: entry.ref ?? null,
        label: entry.label ?? null,
      },
      persistent: false,
      startsFolded: false,
      add: { kind: "none" } as const,
      tasks: list,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  columns.push({
    id: `col:waiting:${NONE}`,
    key: NONE,
    label: "Not waiting",
    mark: null,
    target: null,
    persistent: true,
    startsFolded: false,
    add: addFor(ctx, "none", NONE),
    tasks: none,
  });
  return columns;
}

/** The "+" of a column, by the List's rule (U10-6). */
function addFor(ctx: BoardContext, groupBy: GroupBy, key: string): GroupAddState {
  return groupAddState({
    scope: ctx.scope,
    groupBy,
    key,
    canEdit: ctx.canEdit,
    today: ctx.today,
    inboxId: ctx.inboxId,
  });
}

// ── lanes (call 85) ─────────────────────────────────────────────────────────

/** The List grouping a lane kind reads. */
function laneGroupBy(lanes: Exclude<BoardLanes, "none">): GroupBy {
  return lanes;
}

/** The lane a task sits in. */
export function laneKeyOf(task: Task, lanes: Exclude<BoardLanes, "none">): string {
  return groupKeyFor(task, laneGroupBy(lanes));
}

/**
 * The board's lanes, in the List's order for the same grouping; only lanes
 * with tasks (empty lanes hide, call 85).
 */
export function buildBoardLanes(
  tasks: readonly Task[],
  lanes: Exclude<BoardLanes, "none">,
  ctx: BoardContext,
): BoardLane[] {
  const groupBy = laneGroupBy(lanes);
  const people = ctx.assignees ?? [];
  const takes = new Set(people.filter((p) => p.canTakeTasks).map((p) => p.userId));
  const live = new Set((ctx.teams ?? []).map((t) => t.id));
  const groups = groupTasks([...tasks], groupBy, {
    bucketName: ctx.bucketName,
    teams: ctx.teams,
    assignees: ctx.assignees,
    bucketOrder: [
      ...(ctx.inboxId ? [ctx.inboxId] : []),
      ...ctx.buckets.map((b) => b.id).filter((id) => id !== ctx.inboxId),
    ],
  });
  return groups.map((g) => {
    let target: BoardTarget | null = null;
    if (lanes === "assignee") {
      target =
        g.key === NONE
          ? { field: "assignee", value: null }
          : takes.has(g.key)
            ? { field: "assignee", value: g.key }
            : null;
    } else if (lanes === "team") {
      target =
        g.key === NONE
          ? { field: "team", value: null }
          : live.has(g.key)
            ? { field: "team", value: g.key }
            : null;
    } else if (lanes === "priority") {
      target = { field: "priority", value: g.key === "unset" ? null : (g.key as PriorityLevel) };
    }
    return {
      key: g.key,
      label: g.label,
      mark:
        lanes === "priority" && g.key === "unset" ? null : { kind: "group", groupBy, key: g.key },
      target,
      tasks: g.tasks,
    };
  });
}

/** The lanes a board can offer: Project only across projects. */
export function effectiveLanes(lanes: BoardLanes, scope: string): BoardLanes {
  if (lanes === "bucket" && scope !== "all" && scope !== "mine") return "none";
  return lanes;
}
