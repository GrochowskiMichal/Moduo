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
import { GROUP_BYS, type GroupBy, groupsByBucket, LEVEL_ORDER } from "./helpers";
import type { Task } from "./model";
import { DEFAULT_ROW_PROPERTIES, type RowPreset, type RowProperty } from "./row-layout";

export type TaskLayout = "list" | "board" | "timeline";
/** The Board's Group by: a drop on a group sets its field. Assignee and
 *  priority join with the drop rewrite (TV-U4); "bucket" is Project. */
export type BoardGroupBy = "status" | "bucket";
export type TaskOrder = "manual" | "due" | "scheduled" | "priority" | "created" | "updated";
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
  completed: "hidden",
  subtasks: "nested",
  rows: "standard",
  properties: [...DEFAULT_ROW_PROPERTIES],
};

/**
 * A scope's defaults:
 * - My tasks groups by status, In progress first (call 84);
 * - All groups by project (its tasks come from every project);
 * - a project, the Inbox and the Queue don't group (a project's default
 *   becomes Section once sections exist, TV-D10).
 */
export function tasksDisplayDefaults(scope: string): TasksDisplay {
  if (scope === "mine") return { ...TASKS_DISPLAY_DEFAULTS, group: "status" };
  if (groupsByBucket(scope)) return { ...TASKS_DISPLAY_DEFAULTS, group: "bucket" };
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
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  date: "Date",
  bucket: "Project",
  none: "None",
};

function groupControl(scope: string): DisplayControl<TasksDisplay> {
  // Grouping by project only means something across projects (All, My tasks).
  const groups = GROUP_BYS.filter((g) => g !== "bucket" || groupsByBucket(scope));
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
    groupControl(scope),
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

/** Earliest first, no date last. */
function byDate(a: string | null, b: string | null): number {
  const x = time(a);
  const y = time(b);
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  return x - y;
}

/** Newest first. */
function byNewest(a: string, b: string): number {
  return (time(b) ?? 0) - (time(a) ?? 0);
}

const COMPARATORS: Record<Exclude<TaskOrder, "manual">, (a: Task, b: Task) => number> = {
  due: (a, b) => byDate(a.dueDate, b.dueDate),
  scheduled: (a, b) => byDate(a.scheduledAt, b.scheduledAt),
  priority: (a, b) =>
    (a.priority ? PRIORITY_RANK[a.priority] : LEVEL_ORDER.length) -
    (b.priority ? PRIORITY_RANK[b.priority] : LEVEL_ORDER.length),
  created: (a, b) => byNewest(a.createdAt, b.createdAt),
  updated: (a, b) => byNewest(a.updatedAt, b.updatedAt),
};

/**
 * Orders tasks for Display → Order by. Manual keeps the incoming (position)
 * order; every other order is stable, so ties keep the manual order. Dates
 * run earliest first with no date last, priority high to none, and Created /
 * Updated newest first.
 */
export function orderTasks<T extends Task>(tasks: readonly T[], order: TaskOrder): T[] {
  if (order === "manual") return [...tasks];
  const compare = COMPARATORS[order];
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => compare(a.task, b.task) || a.index - b.index)
    .map(({ task }) => task);
}
