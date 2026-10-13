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

export type TaskLayout = "list" | "board" | "timeline";
/** The Board's Group by: a drop on a group sets its field. Assignee,
 *  priority and the rest join with the Board rebuild (TV-U11), on the drop
 *  writes TV-U4 built; "bucket" is Project. */
export type BoardGroupBy = "status" | "bucket";
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

export type TasksDisplay = {
  layout: TaskLayout;
  /** The List's Group by. */
  group: GroupBy;
  /** The Board's Group by (it always opens by status, call 86). */
  boardGroup: BoardGroupBy;
  order: TaskOrder;
  /** The sort's direction; "asc" is each order's natural one (dates
   *  earliest first, Created/Updated newest first). Manual ignores it. */
  orderDir: OrderDirection;
  completed: CompletedMode;
  subtasks: SubtaskMode;
  rows: RowPreset;
  properties: RowProperty[];
};

/** What one scope remembers: its Display, plus its filters. */
export type TasksViewPrefs = TasksDisplay & { filters: FilterCondition[] };

export const TASKS_DISPLAY_DEFAULTS: TasksDisplay = {
  layout: "list",
  group: "none",
  boardGroup: "status",
  order: "manual",
  orderDir: "asc",
  completed: "hidden",
  subtasks: "nested",
  rows: "standard",
  properties: [...DEFAULT_ROW_PROPERTIES],
};

/**
 * A scope's defaults:
 * - My tasks groups by status, In progress first (call 84);
 * - All groups by project (its tasks come from every project);
 * - a project groups by Section (TV-U10): a plain list until it has
 *   sections, then a group per section;
 * - the Inbox and the Queue don't group.
 */
export function tasksDisplayDefaults(scope: string): TasksDisplay {
  if (scope === "mine") return { ...TASKS_DISPLAY_DEFAULTS, group: "status" };
  // Upcoming (TV-U6's interim until TV-U15): by date, Earlier · Today · …
  if (scope === "upcoming") return { ...TASKS_DISPLAY_DEFAULTS, group: "date", order: "due" };
  if (groupsByBucket(scope)) return { ...TASKS_DISPLAY_DEFAULTS, group: "bucket" };
  if (isProjectScope(scope)) return { ...TASKS_DISPLAY_DEFAULTS, group: "section" };
  return { ...TASKS_DISPLAY_DEFAULTS };
}

export function tasksViewDefaults(scope: string, layout?: TaskLayout): TasksViewPrefs {
  const display = tasksDisplayDefaults(scope);
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
};

/** The sanitiser keeps every grouping a scope could offer (teams may load late). */
const ALL_CHOICES: GroupChoices = { teams: true };

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

/** The Board's Group by: "Group by" too, never "Columns" (call 22a). */
function boardGroupControl(scope: string): DisplayControl<TasksDisplay> {
  const options = [{ value: "status", label: "Status" }];
  if (groupsByBucket(scope)) options.push({ value: "bucket", label: "Project" });
  return { type: "select", id: "boardGroup", label: "Group by", options };
}

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

/**
 * The controls a scope offers for a layout.
 * - The Queue is one ordered line-up: no grouping, order, Completed choice
 *   (done tasks leave every queue; one you check off there stays until the
 *   next load, TV-D4) or subtask nesting.
 * - The Timeline keeps its own rules: only the layout switch.
 * - The Board has its own Group by (Project only across projects) and no
 *   Rows preset: cards get theirs with the Board rebuild (TV-U11).
 */
export function tasksDisplayControls(
  scope: string,
  layout: TaskLayout = "list",
  choices: GroupChoices = ALL_CHOICES,
): DisplayControl<TasksDisplay>[] {
  if (layout === "timeline") return [LAYOUT_CONTROL];
  if (scope === "today") {
    return layout === "board"
      ? [LAYOUT_CONTROL, PROPERTIES_CONTROL]
      : [LAYOUT_CONTROL, ROWS_CONTROL, PROPERTIES_CONTROL];
  }
  if (layout === "board") {
    const grouping = groupsByBucket(scope) ? [boardGroupControl(scope)] : [];
    return [
      LAYOUT_CONTROL,
      ...grouping,
      ORDER_CONTROL,
      COMPLETED_CONTROL,
      SUBTASKS_CONTROL,
      PROPERTIES_CONTROL,
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
    ORDER_CONTROL,
    COMPLETED_CONTROL,
    SUBTASKS_CONTROL,
    ROWS_CONTROL,
    PROPERTIES_CONTROL,
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
