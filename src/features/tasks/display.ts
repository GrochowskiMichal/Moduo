// Tasks' Display menu (tasks-v2 §7), remembered per workspace and scope on
// this device through the view-prefs helper (DS-4). TV-U1 shipped Completed
// and "Show on rows"; TV-U2 adds layout, Group by, order, subtasks and the
// Rows preset (Standard · Detailed), and moves grouping out of the toolbar.
// The same stored object also holds the scope's filters (see
// `TasksViewPrefs`), so one key remembers how a scope is set up.

import { ChartGantt, Columns3, List } from "lucide-react";
import { type DisplayControl, sanitizeDisplayValue } from "../../components/ui/display-menu";
import type { FilterCondition } from "../../components/ui/filter-model";
import { viewPrefsKey } from "../../lib/view-prefs";
import type { CompletedMode } from "./completed";
import { sanitizeTaskFilters } from "./filters";
import {
  GROUP_BYS,
  type GroupBy,
  groupsByBucket,
  isProjectScope,
  LEVEL_ORDER,
  STATUS_ORDER,
} from "./helpers";
import type { Task } from "./model";
import { DEFAULT_ROW_PROPERTIES, type RowPreset, type RowProperty } from "./row-layout";
import { statusKeyOf } from "./statuses";
import {
  type TimelineGroup,
  type TimelineScope,
  type TimelineSubtasks,
  timelineGroupsFor,
} from "./timeline-rows";
import { isTimelineZoom, type TimelineZoom } from "./timeline-scale";

export type TaskLayout = "list" | "board" | "timeline";
/** The Board's Group by (TV-U11, call 22): a drop on a column sets its
 *  field. Section only inside one project; Project and Area only across
 *  projects; Team once the workspace has teams. "bucket" is Project. */
export type BoardGroupBy =
  | "status"
  | "section"
  | "assignee"
  | "team"
  | "priority"
  | "bucket"
  | "area"
  /** Who or what each task waits on (TV-U12; a drop adds a Waiting on). */
  | "waiting";
/** The Board's lanes (call 85): one level, off by default. */
export type BoardLanes = "none" | "assignee" | "priority" | "bucket" | "team";
/** Display → Description on cards (AC7.4): hidden, or a two-line preview. */
export type CardDescription = "hidden" | "preview";
export type TaskOrder =
  | "manual"
  | "due"
  | "scheduled"
  | "priority"
  | "created"
  | "updated"
  | "title"
  | "status";
/** Which way a sort runs (a Detailed header clicked twice, TV-U10). */
export type OrderDirection = "asc" | "desc";
export type SubtaskMode = "nested" | "flat";
/** Display → Rows (tasks-v3 §4): which facts a row carries. Height is Density's. */
export type { RowPreset };
/** The Timeline's Colour by (REPLAN 71): points take the project's hue, or their status's. */
export type TimelineColorBy = "none" | "project" | "status";
/** What the Timeline adds when asked (REPLAN 71): undated rows, session ticks,
 *  repeat ghosts, the Due per week counts. Dependencies join with TV-TL2. */
export type TimelineShow = "undated" | "sessions" | "repeats" | "duePerWeek";

export type TasksDisplay = {
  layout: TaskLayout;
  /** The List's Group by. */
  group: GroupBy;
  /** The Board's Group by (it always opens by status, call 86). */
  boardGroup: BoardGroupBy;
  /** The Board's lanes (call 85). */
  boardLanes: BoardLanes;
  /** The Board's description preview (AC7.4). */
  cardDescription: CardDescription;
  order: TaskOrder;
  /** The sort's direction; "asc" is each order's natural one (dates
   *  earliest first, Created/Updated newest first). Manual ignores it. */
  orderDir: OrderDirection;
  completed: CompletedMode;
  subtasks: SubtaskMode;
  rows: RowPreset;
  properties: RowProperty[];
  /** The Timeline (TV-TL1): its zoom, Group by, Colour by, extras and subtasks. */
  timelineZoom: TimelineZoom;
  timelineGroup: TimelineGroup;
  colorBy: TimelineColorBy;
  timelineShow: TimelineShow[];
  timelineSubtasks: TimelineSubtasks;
};

/** What one scope remembers: its Display, plus its filters. */
export type TasksViewPrefs = TasksDisplay & { filters: FilterCondition[] };

export const TASKS_DISPLAY_DEFAULTS: TasksDisplay = {
  layout: "list",
  group: "none",
  boardGroup: "status",
  boardLanes: "none",
  cardDescription: "hidden",
  order: "manual",
  orderDir: "asc",
  completed: "hidden",
  subtasks: "nested",
  rows: "standard",
  properties: [...DEFAULT_ROW_PROPERTIES],
  timelineZoom: "month",
  timelineGroup: "project",
  colorBy: "none",
  timelineShow: [],
  timelineSubtasks: "hidden",
};

/** Which shape of Timeline rows a scope gets (REPLAN 67). */
export function timelineScopeOf(scope: string): TimelineScope {
  if (scope === "all") return { kind: "workspace" };
  if (isProjectScope(scope)) return { kind: "project", projectId: scope };
  return { kind: "tasks" };
}

/** What a person's role changes in the Timeline's defaults (TV-U17's roles). */
export type TimelineRoleDefaults = { duePerWeek: boolean };
const NO_ROLE_DEFAULTS: TimelineRoleDefaults = { duePerWeek: false };

/**
 * A scope's Timeline defaults (REPLAN 67, 69): All opens at Quarter, by area;
 * a project at Month, by section; the rest at Month, by project. The student
 * role turns Due per week on (call 34: roles change defaults only).
 */
function timelineDefaults(
  scope: string,
  role: TimelineRoleDefaults,
): Pick<TasksDisplay, "timelineZoom" | "timelineGroup" | "timelineShow"> {
  const kind = timelineScopeOf(scope).kind;
  return {
    timelineZoom: kind === "workspace" ? "quarter" : "month",
    timelineGroup: timelineGroupsFor(kind)[0] ?? "none",
    timelineShow: role.duePerWeek ? ["duePerWeek"] : [],
  };
}

/**
 * A scope's defaults:
 * - My tasks groups by status, In progress first (call 84);
 * - All groups by project (its tasks come from every project);
 * - a project groups by Section (TV-U10): a plain list until it has
 *   sections, then a group per section;
 * - the Inbox and the Queue don't group.
 *
 * `rows` is the row preset a view starts with: the person's role's (TV-U17;
 * developers start on Detailed), Standard otherwise.
 */
export function tasksDisplayDefaults(
  scope: string,
  rows: RowPreset = "standard",
  role: TimelineRoleDefaults = NO_ROLE_DEFAULTS,
): TasksDisplay {
  const base = { ...TASKS_DISPLAY_DEFAULTS, rows, ...timelineDefaults(scope, role) };
  if (scope === "mine") return { ...base, group: "status" };
  // Upcoming (TV-U15) groups by its days and orders its own rows; dated
  // subtasks show flat, with "↳ Parent" (research §6).
  if (scope === "upcoming") {
    return { ...base, group: "date", order: "manual", subtasks: "flat" };
  }
  if (groupsByBucket(scope)) return { ...base, group: "bucket" };
  if (isProjectScope(scope)) return { ...base, group: "section" };
  return base;
}

export function tasksViewDefaults(
  scope: string,
  layout?: TaskLayout,
  rows?: RowPreset,
  role?: TimelineRoleDefaults,
): TasksViewPrefs {
  const display = tasksDisplayDefaults(scope, rows, role);
  return { ...display, layout: layout ?? display.layout, filters: [] };
}

const LAYOUT_CONTROL: DisplayControl<TasksDisplay> = {
  type: "segmented",
  id: "layout",
  label: "Layout",
  iconOnly: true,
  options: [
    { value: "list", label: "List", icon: List },
    { value: "board", label: "Board", icon: Columns3 },
    { value: "timeline", label: "Timeline", icon: ChartGantt },
  ],
};

/** Group by's choices, in the menu's order (default l; never Tag or Energy). */
export const GROUP_LABELS: Record<GroupBy, string> = {
  section: "Section",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  team: "Team",
  date: "Date",
  bucket: "Project",
  none: "None",
};

/** What a scope's Group by can offer beyond the scope itself. */
export type GroupChoices = {
  /** The workspace has teams: Team is offered. */
  teams: boolean;
  /** The workspace has areas: the Board across projects offers Area. */
  areas?: boolean;
};

/** The sanitiser keeps every grouping a scope could offer (teams may load late). */
const ALL_CHOICES: GroupChoices = { teams: true, areas: true };

function groupControl(
  scope: string,
  choices: GroupChoices = ALL_CHOICES,
): DisplayControl<TasksDisplay> {
  // Grouping by project only means something across projects (All, My
  // tasks); by section only inside one project; by team once teams exist.
  const groups = GROUP_BYS.filter(
    (g) =>
      (g !== "bucket" || groupsByBucket(scope)) &&
      (g !== "section" || isProjectScope(scope)) &&
      (g !== "team" || choices.teams),
  );
  return {
    type: "select",
    id: "group",
    label: "Group by",
    options: groups.map((g) => ({ value: g, label: GROUP_LABELS[g] })),
  };
}

/** The Board's Group by choices, in the menu's order. */
export const BOARD_GROUP_LABELS: Record<BoardGroupBy, string> = {
  status: "Status",
  section: "Section",
  assignee: "Assignee",
  team: "Team",
  priority: "Priority",
  bucket: "Project",
  area: "Area",
  waiting: "Waiting on",
};

/** What the Board can be grouped by in a scope (TV-U11, call 22). */
export function boardGroupsFor(scope: string, choices: GroupChoices = ALL_CHOICES): BoardGroupBy[] {
  const across = groupsByBucket(scope);
  return (Object.keys(BOARD_GROUP_LABELS) as BoardGroupBy[]).filter(
    (g) =>
      (g !== "section" || isProjectScope(scope)) &&
      (g !== "team" || choices.teams) &&
      (g !== "bucket" || across) &&
      (g !== "area" || (across && choices.areas !== false)),
  );
}

/** The Board's Group by: "Group by" too, never "Columns" (call 22a). */
function boardGroupControl(
  scope: string,
  choices: GroupChoices = ALL_CHOICES,
): DisplayControl<TasksDisplay> {
  return {
    type: "select",
    id: "boardGroup",
    label: "Group by",
    options: boardGroupsFor(scope, choices).map((g) => ({
      value: g,
      label: BOARD_GROUP_LABELS[g],
    })),
  };
}

/** The lanes' choices, in the menu's order (call 85). */
export const BOARD_LANE_LABELS: Record<BoardLanes, string> = {
  none: "None",
  assignee: "Assignee",
  priority: "Priority",
  bucket: "Project",
  team: "Team",
};

/** Display → Lanes: one level, off by default; Project only across projects. */
function boardLanesControl(
  scope: string,
  choices: GroupChoices = ALL_CHOICES,
): DisplayControl<TasksDisplay> {
  const lanes = (Object.keys(BOARD_LANE_LABELS) as BoardLanes[]).filter(
    (l) => (l !== "bucket" || groupsByBucket(scope)) && (l !== "team" || choices.teams),
  );
  return {
    type: "select",
    id: "boardLanes",
    label: "Lanes",
    options: lanes.map((l) => ({ value: l, label: BOARD_LANE_LABELS[l] })),
  };
}

/** Display → Description: the card's two-line preview (AC7.4), off by default. */
const DESCRIPTION_CONTROL: DisplayControl<TasksDisplay> = {
  type: "segmented",
  id: "cardDescription",
  label: "Description",
  options: [
    { value: "hidden", label: "Hidden" },
    { value: "preview", label: "Preview" },
  ],
};

const ROWS_CONTROL: DisplayControl<TasksDisplay> = {
  type: "segmented",
  id: "rows",
  label: "Rows",
  options: [
    { value: "standard", label: "Standard" },
    { value: "detailed", label: "Detailed" },
  ],
};

const ORDER_CONTROL: DisplayControl<TasksDisplay> = {
  type: "select",
  id: "order",
  label: "Order by",
  options: [
    { value: "manual", label: "Manual" },
    { value: "due", label: "Due date" },
    { value: "scheduled", label: "Scheduled" },
    { value: "priority", label: "Priority" },
    { value: "created", label: "Created" },
    { value: "updated", label: "Updated" },
    { value: "title", label: "Title" },
    { value: "status", label: "Status" },
  ],
};

const COMPLETED_CONTROL: DisplayControl<TasksDisplay> = {
  type: "segmented",
  id: "completed",
  label: "Completed",
  options: [
    { value: "hidden", label: "Hidden" },
    { value: "week", label: "7 days" },
    { value: "all", label: "All" },
  ],
};

const SUBTASKS_CONTROL: DisplayControl<TasksDisplay> = {
  type: "segmented",
  id: "subtasks",
  label: "Subtasks",
  options: [
    { value: "nested", label: "Nested" },
    { value: "flat", label: "Flat" },
  ],
};

const PROPERTIES_CONTROL: DisplayControl<TasksDisplay> = {
  type: "toggles",
  id: "properties",
  label: "Show on rows",
  options: [
    { value: "priority", label: "Priority" },
    { value: "energy", label: "Energy" },
    { value: "date", label: "Date" },
    { value: "assignee", label: "Assignee" },
  ],
};

/** The same choices on the Board, named for what it shows. */
const CARD_PROPERTIES_CONTROL: DisplayControl<TasksDisplay> = {
  ...PROPERTIES_CONTROL,
  label: "Show on cards",
};

// ── The Timeline's Display (TV-TL1, REPLAN 71) ────────────────────────────────

export const TIMELINE_GROUP_LABELS: Record<TimelineGroup, string> = {
  area: "Area",
  section: "Section",
  project: "Project",
  assignee: "Assignee",
  none: "None",
};

function timelineGroupControl(scope: string): DisplayControl<TasksDisplay> {
  return {
    type: "select",
    id: "timelineGroup",
    label: "Group by",
    options: timelineGroupsFor(timelineScopeOf(scope).kind).map((g) => ({
      value: g,
      label: TIMELINE_GROUP_LABELS[g],
    })),
  };
}

/** Show done: the List's Completed, named for the Timeline (Hidden · 7 days · All). */
const SHOW_DONE_CONTROL: DisplayControl<TasksDisplay> = {
  type: "segmented",
  id: "completed",
  label: "Show done",
  options: [
    { value: "hidden", label: "Hidden" },
    { value: "week", label: "7 days" },
    { value: "all", label: "All" },
  ],
};

/** Colour by: Project only across projects (inside one, every point shares its hue). */
function colorByControl(scope: string): DisplayControl<TasksDisplay> {
  const across = timelineScopeOf(scope).kind !== "project";
  return {
    type: "segmented",
    id: "colorBy",
    label: "Colour by",
    options: [
      { value: "none", label: "None" },
      ...(across ? [{ value: "project", label: "Project" }] : []),
      { value: "status", label: "Status" },
    ],
  };
}

const TIMELINE_SHOW_CONTROL: DisplayControl<TasksDisplay> = {
  type: "toggles",
  id: "timelineShow",
  label: "Show",
  options: [
    { value: "undated", label: "No date" },
    { value: "sessions", label: "Sessions" },
    { value: "repeats", label: "Repeats" },
    { value: "duePerWeek", label: "Due per week" },
  ],
};

const TIMELINE_SUBTASKS_CONTROL: DisplayControl<TasksDisplay> = {
  type: "segmented",
  id: "timelineSubtasks",
  label: "Subtasks",
  options: [
    { value: "hidden", label: "Hidden" },
    { value: "nested", label: "Nested" },
  ],
};

function timelineControls(scope: string): DisplayControl<TasksDisplay>[] {
  return [
    timelineGroupControl(scope),
    SHOW_DONE_CONTROL,
    colorByControl(scope),
    TIMELINE_SHOW_CONTROL,
    TIMELINE_SUBTASKS_CONTROL,
  ];
}

/**
 * The controls a scope offers for a layout.
 * - The Queue is one ordered line-up: no grouping, order, Completed choice
 *   (done tasks leave every queue; one you check off there stays until the
 *   next load, TV-D4) or subtask nesting.
 * - The Timeline has its own (REPLAN 71): Group by, Show done, Colour by,
 *   Show (No date, Sessions, Repeats, Due per week) and Subtasks; its zoom
 *   sits on its own bar.
 * - The Board has its own Group by (call 22), Lanes (85), Rows (Standard or
 *   Detailed cards) and the Description preview (AC7.4) (TV-U11).
 */
export function tasksDisplayControls(
  scope: string,
  layout: TaskLayout = "list",
  choices: GroupChoices = ALL_CHOICES,
): DisplayControl<TasksDisplay>[] {
  if (layout === "timeline") return [LAYOUT_CONTROL, ...timelineControls(scope)];
  // Upcoming's List groups by its days in its own order (TV-U15): no Group
  // by, Order by or nesting to choose.
  if (scope === "upcoming" && layout === "list") {
    return [LAYOUT_CONTROL, COMPLETED_CONTROL, ROWS_CONTROL, PROPERTIES_CONTROL];
  }
  if (scope === "today") {
    return layout === "board"
      ? [LAYOUT_CONTROL, ROWS_CONTROL, CARD_PROPERTIES_CONTROL, DESCRIPTION_CONTROL]
      : [LAYOUT_CONTROL, ROWS_CONTROL, PROPERTIES_CONTROL];
  }
  if (layout === "board") {
    return [
      LAYOUT_CONTROL,
      boardGroupControl(scope, choices),
      boardLanesControl(scope, choices),
      ORDER_CONTROL,
      COMPLETED_CONTROL,
      SUBTASKS_CONTROL,
      ROWS_CONTROL,
      CARD_PROPERTIES_CONTROL,
      DESCRIPTION_CONTROL,
    ];
  }
  return [
    LAYOUT_CONTROL,
    groupControl(scope, choices),
    ORDER_CONTROL,
    COMPLETED_CONTROL,
    SUBTASKS_CONTROL,
    ROWS_CONTROL,
    PROPERTIES_CONTROL,
  ];
}

/** Every control a scope can show, whatever the layout: the sanitiser's view. */
function scopeControls(scope: string): DisplayControl<TasksDisplay>[] {
  return [
    LAYOUT_CONTROL,
    groupControl(scope),
    boardGroupControl(scope),
    boardLanesControl(scope),
    DESCRIPTION_CONTROL,
    ORDER_CONTROL,
    COMPLETED_CONTROL,
    SUBTASKS_CONTROL,
    ROWS_CONTROL,
    PROPERTIES_CONTROL,
    ...timelineControls(scope),
  ];
}

/** The view-prefs sanitiser for one scope: unknown choices (and a choice the
 *  scope doesn't offer, like bucket grouping inside one bucket) fall back to
 *  the defaults, and stored filters are cleaned (`sanitizeTaskFilters`). */
export function sanitizeTasksView(
  raw: unknown,
  defaults: TasksViewPrefs,
  scope: string,
): TasksViewPrefs {
  const display = sanitizeDisplayValue(raw, scopeControls(scope), displayOf(defaults));
  // The direction has no control of its own (the Detailed headers set it).
  if (display.orderDir !== "asc" && display.orderDir !== "desc") display.orderDir = "asc";
  // The zoom has no control in the menu either (the Timeline's bar sets it).
  if (!isTimelineZoom(display.timelineZoom)) display.timelineZoom = defaults.timelineZoom;
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>).filters : null;
  return { ...display, filters: sanitizeTaskFilters(stored) };
}

/** The Display part of a scope's prefs (what the menu edits and resets). */
export function displayOf(prefs: TasksViewPrefs): TasksDisplay {
  const { filters: _filters, ...display } = prefs;
  return display;
}

/** Where a scope's Display value lives: `moduo:tasks:view:<workspace>:<scope>`. */
export function tasksDisplayKey(workspaceId: string, scope: string): string | null {
  return viewPrefsKey("tasks", workspaceId, scope);
}

// ── Order by ────────────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<string, number> = Object.fromEntries(
  LEVEL_ORDER.map((level, i) => [level, i]),
);

function time(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

const STATUS_RANK: Record<string, number> = Object.fromEntries(
  STATUS_ORDER.map((key, i) => [key, i]),
);

const TITLE_COLLATOR = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Each order's sort key in its natural direction (smaller first); null = no
 * value, which sorts last whichever way the sort runs.
 */
const SORT_KEYS: Record<Exclude<TaskOrder, "manual" | "title">, (t: Task) => number | null> = {
  due: (t) => time(t.dueDate),
  scheduled: (t) => time(t.scheduledAt),
  priority: (t) => (t.priority ? (PRIORITY_RANK[t.priority] ?? null) : null),
  // Newest first.
  created: (t) => {
    const x = time(t.createdAt);
    return x === null ? null : -x;
  },
  updated: (t) => {
    const x = time(t.updatedAt);
    return x === null ? null : -x;
  },
  status: (t) => STATUS_RANK[statusKeyOf(t)] ?? null,
};

function compareBy(order: Exclude<TaskOrder, "manual">, dir: OrderDirection) {
  const sign = dir === "desc" ? -1 : 1;
  if (order === "title") {
    return (a: Task, b: Task) => {
      const x = a.title.trim();
      const y = b.title.trim();
      // Untitled ones last.
      if (!x || !y) return x === y ? 0 : x ? -1 : 1;
      return sign * TITLE_COLLATOR.compare(x, y);
    };
  }
  const key = SORT_KEYS[order];
  return (a: Task, b: Task) => {
    const x = key(a);
    const y = key(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y);
  };
}

/**
 * Orders tasks for Display → Order by. Manual keeps the incoming (position)
 * order; every other order is stable, so ties keep the manual order. Dates
 * run earliest first, priority high to none, Created / Updated newest first,
 * titles A to Z, statuses in the List's order (In progress first); `desc`
 * turns each around, and a task without the value sorts last either way.
 */
export function orderTasks<T extends Task>(
  tasks: readonly T[],
  order: TaskOrder,
  dir: OrderDirection = "asc",
): T[] {
  if (order === "manual") return [...tasks];
  const compare = compareBy(order, dir);
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => compare(a.task, b.task) || a.index - b.index)
    .map(({ task }) => task);
}

/**
 * A Detailed column header clicked (research §3): sorted by another column →
 * this one, ascending; ascending → descending; descending → back to the
 * view's own order (its default, Manual in a project).
 */
export function nextHeaderSort(
  current: { order: TaskOrder; orderDir: OrderDirection },
  column: Exclude<TaskOrder, "manual">,
  viewDefault: TaskOrder,
): { order: TaskOrder; orderDir: OrderDirection } {
  if (current.order !== column) return { order: column, orderDir: "asc" };
  if (current.orderDir === "asc") return { order: column, orderDir: "desc" };
  // A view that sorts by this column anyway (Upcoming by due) just turns back.
  return { order: viewDefault, orderDir: "asc" };
}
