// The Timeline's rows (Tasks v3 TV-TL1, spec §6, REPLAN 67, 68, 68a): what
// each row is and what is drawn on it, in day numbers (timeline-scale.ts), so
// the view only turns days into pixels. Pure: no React, no IO.
//
// Rows follow the scope (67):
//   - All: projects without an area first, then area headers, one row per
//     project (its bar, its ranged sections as segments, a progress line);
//     ▸ expands a project into its sections and tasks.
//   - One project: the project row, then its sections (a range is a band on
//     the section's row and behind its tasks; an end date only is a diamond
//     on the section's row, 68a), each followed by its tasks.
//   - Everything else (My tasks, Upcoming, the Inbox, views): tasks grouped
//     by project, or by assignee.
//
// Each date is drawn as what it is (68): a task is a point on its due day, a
// hollow point on its next session when it has only sessions, muted when it
// is late, hidden when done unless Display shows done; projects and sections
// are spans. Nothing makes up a task's start date.

import { isClosedTask, isOpenTask, taskCategoryOf } from "@contracts/vocabularies";

import type { Area, Bucket, Section, Task, TaskSession } from "./model";
import { isLate, PRIVATE_PROJECT_LABEL } from "./model";
import { dayNumOfInstant, dayNumOfKey, keyOfDay } from "./timeline-scale";

/** How rows are grouped (Display → Group by), per scope. */
export type TimelineGroup = "area" | "section" | "project" | "assignee" | "none";
/** Subtasks: hidden by default (67); nested under their parent when shown. */
export type TimelineSubtasks = "hidden" | "nested";

/** Which shape of rows a scope gets. */
export type TimelineScope =
  | { kind: "workspace" }
  | { kind: "project"; projectId: string }
  | { kind: "tasks" };

/** The Group by choices a scope offers, its default first. */
export function timelineGroupsFor(scope: TimelineScope["kind"]): TimelineGroup[] {
  if (scope === "workspace") return ["area", "none"];
  if (scope === "project") return ["section", "assignee", "none"];
  return ["project", "assignee", "none"];
}

/** A day span, both ends included. */
export type DaySpan = { start: number; end: number };

/** A task's mark. */
export type TimelinePoint = {
  day: number;
  /** "due": a filled point; "session": a hollow one (no due date, only sessions). */
  kind: "due" | "session";
  late: boolean;
  /** Done or Won't do (shown only when Display shows done). */
  closed: boolean;
  /** A repeat: its current occurrence, with the repeat mark. */
  repeat: boolean;
};

/** A project's bar (68, 68a). */
export type ProjectBar = DaySpan & {
  /** Both dates were set by a person: a solid bar. Otherwise an outline worked out from its work. */
  solid: boolean;
  /** Sections with a range: segments on the bar. */
  segments: Array<DaySpan & { sectionId: string; name: string }>;
  /** Sections with only an end date: diamonds on the bar (while the project is folded). */
  milestones: Array<{ sectionId: string; name: string; day: number }>;
};

export type TimelineRow =
  | { kind: "area"; key: string; label: string }
  | {
      kind: "group";
      key: string;
      label: string;
      /** The project's hue for a project group. */
      color: string | null;
      count: number;
    }
  | {
      kind: "project";
      key: string;
      project: Bucket;
      depth: number;
      bar: ProjectBar | null;
      /** Done / all of its tasks here (the progress line, "5 of 12 done"). */
      progress: { done: number; total: number };
      /** ▸ expands it (All); inside the project its row is the header. */
      expandable: boolean;
      expanded: boolean;
      /** On hold or Done: drawn quieter (never hidden, 16). */
      muted: boolean;
    }
  | {
      kind: "section";
      key: string;
      projectId: string;
      /** Null: the project's tasks with no section. */
      section: Section | null;
      depth: number;
      done: number;
      total: number;
      /** A range: a band on its row and behind its tasks. */
      band: DaySpan | null;
      /** Only an end date: the diamond (the milestone). */
      milestone: number | null;
      folded: boolean;
    }
  | {
      kind: "task";
      key: string;
      task: Task;
      depth: number;
      point: TimelinePoint | null;
      /** Its section's range, drawn faintly behind it. */
      band: DaySpan | null;
      /** Show sessions: the days of its other work sessions. */
      sessionDays: readonly number[];
    };

export type TimelineRowsInput = {
  scope: TimelineScope;
  /** The scope's tasks after Filter and search; done ones included (they count). */
  tasks: readonly Task[];
  /**
   * Every task of the workspace: a project's progress line is the project's,
   * whatever Filter and search show (absent: `tasks`).
   */
  allTasks?: readonly Task[];
  /** Projects in the sidebar's order. */
  projects: readonly Bucket[];
  areas: readonly Area[];
  sections: readonly Section[];
  sessions: readonly TaskSession[];
  group: TimelineGroup;
  subtasks: TimelineSubtasks;
  /** Undated open tasks get rows of their own (no mark). */
  showUndated: boolean;
  /** Each task's other work sessions show as small ticks. */
  showSessions: boolean;
  /** Display hides this (finished) task. */
  isHidden: (task: Task) => boolean;
  /** Projects expanded at All (by id). */
  expanded: ReadonlySet<string>;
  /** Section rows folded (by row key). */
  folded: ReadonlySet<string>;
  /** Today's day number. */
  today: number;
  /** Now, in ms (which session is "next"). */
  now: number;
  /** Filter or search narrows the scope: All lists only projects with a match. */
  filtering: boolean;
  inboxId: string | null;
  /** A person's name for an assignee group. */
  personName: (userId: string) => string;
};

export type TimelineRowsResult = {
  rows: TimelineRow[];
  /** The earliest and latest day anything is drawn on (the first range). */
  extent: { min: number; max: number } | null;
  /** Due days of the scope's open tasks, folded away or not (the Due per week counts). */
  dueDays: number[];
  /** Open tasks with no date and no session (the "No date · n" count). */
  undated: number;
  /** Something is drawn on the canvas (else the empty state's sentence). */
  hasMarks: boolean;
};

// ── Keys ─────────────────────────────────────────────────────────────────────

export const areaRowKey = (areaId: string) => `area:${areaId}`;
export const projectRowKey = (projectId: string) => `project:${projectId}`;
export const sectionRowKey = (projectId: string, sectionId: string | null) =>
  `section:${projectId}:${sectionId ?? "none"}`;
export const taskRowKey = (taskId: string) => `task:${taskId}`;

// ── Dates of one task ────────────────────────────────────────────────────────

/** A task's due day (its date key first; the instant for an older row). */
export function dueDayOf(task: Pick<Task, "dueOn" | "dueDate">): number | null {
  return dayNumOfKey(task.dueOn ?? null) ?? dayNumOfInstant(task.dueDate);
}

/** The session a row shows: the next one not ended, else the latest. */
function shownSessionStart(sessions: readonly TaskSession[], now: number): string | null {
  let next: TaskSession | null = null;
  let latest: TaskSession | null = null;
  for (const s of sessions) {
    const start = Date.parse(s.startsAt);
    if (Date.parse(s.endsAt) > now && (!next || start < Date.parse(next.startsAt))) next = s;
    if (!latest || start > Date.parse(latest.startsAt)) latest = s;
  }
  return (next ?? latest)?.startsAt ?? null;
}

/**
 * A task's point: its due day, else its next session (hollow), else none.
 * `sessions` are its own work sessions; without any, the mirrored
 * `scheduledAt` stands in (rows read before TV-D10).
 */
export function pointOf(
  task: Task,
  sessions: readonly TaskSession[],
  today: number,
  now: number,
): TimelinePoint | null {
  const due = dueDayOf(task);
  const closed = isClosedTask(task);
  const repeat = !!task.recurrence;
  if (due !== null) {
    return {
      day: due,
      kind: "due",
      late: isLate(task, keyOfDay(today)),
      closed,
      repeat,
    };
  }
  const start = sessions.length > 0 ? shownSessionStart(sessions, now) : task.scheduledAt;
  const day = dayNumOfInstant(start);
  if (day === null) return null;
  return { day, kind: "session", late: false, closed, repeat };
}

// ── Building ─────────────────────────────────────────────────────────────────

type Ctx = {
  input: TimelineRowsInput;
  sessionsByTask: Map<string, TaskSession[]>;
  sectionById: Map<string, Section>;
  sectionsByProject: Map<string, Section[]>;
  tasksByProject: Map<string, Task[]>;
  /** Every task per project (the progress line). */
  allByProject: Map<string, Task[]>;
  scopeIds: Set<string>;
  points: Map<string, TimelinePoint | null>;
  extent: { min: number; max: number } | null;
  dueDays: number[];
  hasMarks: boolean;
};

function widen(ctx: Ctx, day: number) {
  ctx.hasMarks = true;
  if (!ctx.extent) ctx.extent = { min: day, max: day };
  else {
    if (day < ctx.extent.min) ctx.extent.min = day;
    if (day > ctx.extent.max) ctx.extent.max = day;
  }
}

function pointFor(ctx: Ctx, task: Task): TimelinePoint | null {
  if (ctx.points.has(task.id)) return ctx.points.get(task.id) ?? null;
  const point = pointOf(
    task,
    ctx.sessionsByTask.get(task.id) ?? [],
    ctx.input.today,
    ctx.input.now,
  );
  ctx.points.set(task.id, point);
  return point;
}

const byPosition = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

const bySectionPosition = (a: Section, b: Section) =>
  a.position - b.position || (a.createdAt < b.createdAt ? -1 : 1);

/** Is this subtask shown under its parent, or not at all, rather than on its own? */
function parentInScope(ctx: Ctx, task: Task): boolean {
  return !!task.parentId && task.parentId !== task.id && ctx.scopeIds.has(task.parentId);
}

/** Does this task get a row (its mark, or Show undated for open work)? */
function shows(ctx: Ctx, task: Task): boolean {
  if (ctx.input.isHidden(task)) return false;
  const point = pointFor(ctx, task);
  if (point) return true;
  return ctx.input.showUndated && !isClosedTask(task);
}

/** The ordered task rows of one group: top-level tasks, each with its subtasks when nested. */
function taskRows(
  ctx: Ctx,
  tasks: readonly Task[],
  depth: number,
  band: DaySpan | null,
  order: "manual" | "date",
): TimelineRow[] {
  const { subtasks } = ctx.input;
  const inGroup = new Set(tasks.map((t) => t.id));
  const tops: Task[] = [];
  const childrenOf = new Map<string, Task[]>();
  for (const task of tasks) {
    const nestedHere = !!task.parentId && inGroup.has(task.parentId) && task.parentId !== task.id;
    if (nestedHere && task.parentId) {
      const list = childrenOf.get(task.parentId);
      if (list) list.push(task);
      else childrenOf.set(task.parentId, [task]);
      continue;
    }
    // A subtask whose parent is in the scope but elsewhere (another group)
    // is that parent's business: hidden unless nested is on.
    if (subtasks === "hidden" && parentInScope(ctx, task)) continue;
    tops.push(task);
  }
  const sorted = sortTasks(ctx, tops, order);
  const rows: TimelineRow[] = [];
  for (const task of sorted) {
    const shown = shows(ctx, task);
    if (shown) rows.push(taskRow(ctx, task, depth, band));
    if (subtasks !== "nested") continue;
    const kids = childrenOf.get(task.id);
    if (!kids) continue;
    // Under their parent; at its level when it has no row (undated, done).
    for (const kid of [...kids].sort(byPosition)) {
      if (shows(ctx, kid)) rows.push(taskRow(ctx, kid, shown ? depth + 1 : depth, band));
    }
  }
  return rows;
}

function sortTasks(ctx: Ctx, tasks: Task[], order: "manual" | "date"): Task[] {
  if (order === "manual") return [...tasks].sort(byPosition);
  return [...tasks].sort((a, b) => {
    const x = pointFor(ctx, a)?.day ?? null;
    const y = pointFor(ctx, b)?.day ?? null;
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y;
    }
    return byPosition(a, b);
  });
}

function taskRow(ctx: Ctx, task: Task, depth: number, band: DaySpan | null): TimelineRow {
  const point = pointFor(ctx, task);
  if (point) {
    widen(ctx, point.day);
  }
  let sessionDays: number[] = [];
  if (ctx.input.showSessions) {
    const days = new Set<number>();
    for (const s of ctx.sessionsByTask.get(task.id) ?? []) {
      const day = dayNumOfInstant(s.startsAt);
      if (day !== null && day !== point?.day) days.add(day);
    }
    sessionDays = [...days].sort((a, b) => a - b);
    for (const day of sessionDays) widen(ctx, day);
  }
  return { kind: "task", key: taskRowKey(task.id), task, depth, point, band, sessionDays };
}

/** A project's own tasks, without the subtasks of its tasks. */
function topLevel(tasks: readonly Task[]): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.filter((t) => !t.parentId || t.parentId === t.id || !ids.has(t.parentId));
}

/** Done / all, counting each task once (Won't do sits out). */
function progressOf(tasks: readonly Task[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const task of tasks) {
    const category = taskCategoryOf(task);
    if (category === "wont_do") continue;
    total += 1;
    if (category === "done") done += 1;
  }
  return { done, total };
}

function sectionSpan(section: Section): { band: DaySpan | null; milestone: number | null } {
  const end = dayNumOfKey(section.endsOn);
  const start = dayNumOfKey(section.startsOn);
  if (end === null) return { band: null, milestone: null };
  if (start === null) return { band: null, milestone: end };
  return { band: { start: Math.min(start, end), end: Math.max(start, end) }, milestone: null };
}

/**
 * A project's bar: start → target, solid when both are set (68). Otherwise
 * an outline over what's dated inside it (its sections and open tasks), so
 * it fills in as you date them (68a); none when nothing is dated.
 */
export function projectBarOf(
  project: Pick<Bucket, "startsOn" | "targetOn">,
  sections: readonly Section[],
  openTaskDays: readonly number[],
): ProjectBar | null {
  const segments: ProjectBar["segments"] = [];
  const milestones: ProjectBar["milestones"] = [];
  let min: number | null = null;
  let max: number | null = null;
  const take = (day: number) => {
    if (min === null || day < min) min = day;
    if (max === null || day > max) max = day;
  };
  for (const section of sections) {
    const { band, milestone } = sectionSpan(section);
    if (band) {
      segments.push({ ...band, sectionId: section.id, name: section.name });
      take(band.start);
      take(band.end);
    } else if (milestone !== null) {
      milestones.push({ sectionId: section.id, name: section.name, day: milestone });
      take(milestone);
    }
  }
  for (const day of openTaskDays) take(day);
  const start = dayNumOfKey(project.startsOn ?? null);
  const target = dayNumOfKey(project.targetOn ?? null);
  if (start !== null && target !== null) {
    return {
      start: Math.min(start, target),
      end: Math.max(start, target),
      solid: true,
      segments,
      milestones,
    };
  }
  if (start !== null) take(start);
  if (target !== null) take(target);
  if (min === null || max === null) return null;
  return { start: min, end: max, solid: false, segments, milestones };
}

/** The rows inside one project: its sections and tasks (or its tasks by assignee, or flat). */
function projectBody(
  ctx: Ctx,
  projectId: string,
  depth: number,
  group: TimelineGroup,
): TimelineRow[] {
  const tasks = ctx.tasksByProject.get(projectId) ?? [];
  const sections = ctx.sectionsByProject.get(projectId) ?? [];
  if (group === "assignee") return assigneeGroups(ctx, tasks, depth, `${projectId}:`);
  if (group !== "section" || sections.length === 0) {
    return taskRows(ctx, tasks, depth, null, "manual");
  }
  const rows: TimelineRow[] = [];
  const bySection = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const id = task.sectionId && ctx.sectionById.has(task.sectionId) ? task.sectionId : null;
    const list = bySection.get(id);
    if (list) list.push(task);
    else bySection.set(id, [task]);
  }
  // "No section" first: the top of the project, as in the List and the Board.
  const loose = bySection.get(null) ?? [];
  if (loose.length > 0) {
    const key = sectionRowKey(projectId, null);
    const folded = ctx.input.folded.has(key);
    const counts = progressOf(loose);
    rows.push({
      kind: "section",
      key,
      projectId,
      section: null,
      depth,
      done: counts.done,
      total: counts.total,
      band: null,
      milestone: null,
      folded,
    });
    if (!folded) rows.push(...taskRows(ctx, loose, depth + 1, null, "manual"));
  }
  for (const section of sections) {
    const key = sectionRowKey(projectId, section.id);
    const folded = ctx.input.folded.has(key);
    const own = bySection.get(section.id) ?? [];
    // A filter or a search lists only the sections with a match.
    if (ctx.input.filtering && own.length === 0) continue;
    const counts = progressOf(own);
    const { band, milestone } = sectionSpan(section);
    if (band) {
      widen(ctx, band.start);
      widen(ctx, band.end);
    }
    if (milestone !== null) widen(ctx, milestone);
    rows.push({
      kind: "section",
      key,
      projectId,
      section,
      depth,
      done: counts.done,
      total: counts.total,
      band,
      milestone,
      folded,
    });
    if (!folded) rows.push(...taskRows(ctx, own, depth + 1, band, "manual"));
  }
  return rows;
}

function assigneeGroups(
  ctx: Ctx,
  tasks: readonly Task[],
  depth: number,
  keyPrefix: string,
): TimelineRow[] {
  const byPerson = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const id = task.assigneeId ?? null;
    const list = byPerson.get(id);
    if (list) list.push(task);
    else byPerson.set(id, [task]);
  }
  const people = [...byPerson.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return ctx.input.personName(a).localeCompare(ctx.input.personName(b));
  });
  const rows: TimelineRow[] = [];
  for (const person of people) {
    const own = taskRows(ctx, byPerson.get(person) ?? [], depth, null, "date");
    if (own.length === 0) continue;
    rows.push({
      kind: "group",
      key: `group:${keyPrefix}person:${person ?? "none"}`,
      label: person ? ctx.input.personName(person) : "Unassigned",
      color: null,
      count: own.filter((r) => r.kind === "task").length,
    });
    rows.push(...own);
  }
  return rows;
}

function projectRow(ctx: Ctx, project: Bucket, depth: number, expandable: boolean): TimelineRow {
  // The bar and the progress line are the project's own: all its work,
  // whatever Filter and search list below it.
  const all = ctx.allByProject.get(project.id) ?? [];
  const sections = ctx.sectionsByProject.get(project.id) ?? [];
  const openDays: number[] = [];
  for (const task of all) {
    if (isClosedTask(task)) continue;
    const point = pointFor(ctx, task);
    if (point) openDays.push(point.day);
  }
  const bar = projectBarOf(project, sections, openDays);
  if (bar) {
    widen(ctx, bar.start);
    widen(ctx, bar.end);
  }
  const expanded = expandable && ctx.input.expanded.has(project.id);
  return {
    kind: "project",
    key: projectRowKey(project.id),
    project,
    depth,
    bar,
    progress: progressOf(topLevel(all)),
    expandable,
    expanded,
    muted: project.status === "on_hold" || project.status === "done",
  };
}

/** Every row a scope shows, in order, plus what the header and toolbar need. */
export function buildTimelineRows(input: TimelineRowsInput): TimelineRowsResult {
  const sessionsByTask = new Map<string, TaskSession[]>();
  for (const s of input.sessions) {
    const list = sessionsByTask.get(s.taskId);
    if (list) list.push(s);
    else sessionsByTask.set(s.taskId, [s]);
  }
  const sectionById = new Map<string, Section>();
  const sectionsByProject = new Map<string, Section[]>();
  for (const section of input.sections) {
    sectionById.set(section.id, section);
    const list = sectionsByProject.get(section.projectId);
    if (list) list.push(section);
    else sectionsByProject.set(section.projectId, [section]);
  }
  for (const list of sectionsByProject.values()) list.sort(bySectionPosition);
  const tasksByProject = new Map<string, Task[]>();
  for (const task of input.tasks) {
    const list = tasksByProject.get(task.bucketId);
    if (list) list.push(task);
    else tasksByProject.set(task.bucketId, [task]);
  }
  const allByProject = new Map<string, Task[]>();
  for (const task of input.allTasks ?? input.tasks) {
    if (task.deletedAt) continue;
    const list = allByProject.get(task.bucketId);
    if (list) list.push(task);
    else allByProject.set(task.bucketId, [task]);
  }
  const ctx: Ctx = {
    input,
    sessionsByTask,
    sectionById,
    sectionsByProject,
    tasksByProject,
    allByProject,
    scopeIds: new Set(input.tasks.map((t) => t.id)),
    points: new Map(),
    extent: null,
    dueDays: [],
    hasMarks: false,
  };

  const rows: TimelineRow[] = [];
  const { scope } = input;
  if (scope.kind === "workspace") {
    rows.push(...workspaceRows(ctx));
  } else if (scope.kind === "project") {
    const project = input.projects.find((p) => p.id === scope.projectId);
    if (project) rows.push(projectRow(ctx, project, 0, false));
    const group = input.group === "assignee" || input.group === "none" ? input.group : "section";
    rows.push(...projectBody(ctx, scope.projectId, 0, group));
  } else {
    rows.push(...taskScopeRows(ctx));
  }

  // The open work of the whole scope, drawn or folded away: "No date · n"
  // and the Due per week counts (which weeks are crowded).
  let undated = 0;
  for (const task of input.tasks) {
    if (!isOpenTask(task)) continue;
    const point = pointFor(ctx, task);
    if (point?.kind === "due") ctx.dueDays.push(point.day);
    if (!point && !parentInScope(ctx, task)) undated += 1;
  }
  return { rows, extent: ctx.extent, dueDays: ctx.dueDays, undated, hasMarks: ctx.hasMarks };
}

function workspaceRows(ctx: Ctx): TimelineRow[] {
  const { input } = ctx;
  const projects = input.projects.filter(
    (p) =>
      p.id !== input.inboxId &&
      !p.isSystem &&
      (!input.filtering || (ctx.tasksByProject.get(p.id)?.length ?? 0) > 0),
  );
  const projectRows = (list: readonly Bucket[]) =>
    list.flatMap((project) => {
      const tasks = ctx.tasksByProject.get(project.id) ?? [];
      const sections = ctx.sectionsByProject.get(project.id) ?? [];
      const row = projectRow(ctx, project, 0, tasks.length > 0 || sections.length > 0);
      if (row.kind !== "project" || !row.expanded) return [row];
      return [row, ...projectBody(ctx, project.id, 1, "section")];
    });
  if (input.group === "none") return projectRows(projects);
  // The sidebar's order: projects with no area first, under no header (14),
  // then each area under its name.
  const areaIds = new Set(input.areas.map((a) => a.id));
  const loose = projects.filter((p) => !p.areaId || !areaIds.has(p.areaId));
  const rows: TimelineRow[] = projectRows(loose);
  for (const area of input.areas) {
    const own = projects.filter((p) => p.areaId === area.id);
    if (own.length === 0) continue;
    rows.push({ kind: "area", key: areaRowKey(area.id), label: area.name });
    rows.push(...projectRows(own));
  }
  return rows;
}

function taskScopeRows(ctx: Ctx): TimelineRow[] {
  const { input } = ctx;
  if (input.group === "assignee") return assigneeGroups(ctx, input.tasks, 0, "");
  if (input.group === "none") return taskRows(ctx, input.tasks, 0, null, "date");
  // By project: the Inbox first, then the projects in the sidebar's order.
  const order = [
    ...(input.inboxId ? [input.inboxId] : []),
    ...input.projects.map((p) => p.id).filter((id) => id !== input.inboxId),
  ];
  const known = new Set(order);
  for (const id of ctx.tasksByProject.keys()) if (!known.has(id)) order.push(id);
  const nameOf = new Map(input.projects.map((p) => [p.id, p]));
  const rows: TimelineRow[] = [];
  for (const id of order) {
    const tasks = ctx.tasksByProject.get(id);
    if (!tasks || tasks.length === 0) continue;
    const own = taskRows(ctx, tasks, 0, null, "date");
    if (own.length === 0) continue;
    const project = nameOf.get(id);
    rows.push({
      kind: "group",
      key: `group:project:${id}`,
      label: id === input.inboxId ? "Inbox" : (project?.name ?? PRIVATE_PROJECT_LABEL),
      color: project && !project.isSystem ? (project.color ?? null) : null,
      count: own.filter((r) => r.kind === "task").length,
    });
    rows.push(...own);
  }
  return rows;
}
