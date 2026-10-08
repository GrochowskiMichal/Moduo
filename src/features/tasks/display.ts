// Tasks' Display menu (tasks-v2 §7), remembered per workspace and scope on
// this device through the view-prefs helper (DS-4). TV-U1 ships Completed and
// "Show on rows"; TV-U2 adds layout, group, order and subtasks to this object.

import { type DisplayControl, sanitizeDisplayValue } from "../../components/ui/display-menu";
import { viewPrefsKey } from "../../lib/view-prefs";
import type { CompletedMode } from "./completed";
import { DEFAULT_ROW_PROPERTIES, type RowProperty } from "./row-layout";

export type TasksDisplay = {
  completed: CompletedMode;
  properties: RowProperty[];
};

export const TASKS_DISPLAY_DEFAULTS: TasksDisplay = {
  completed: "hidden",
  properties: [...DEFAULT_ROW_PROPERTIES],
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
 * The controls a scope offers. The Queue has no Completed choice: done tasks
 * leave every queue, and one you check off there stays until the next load
 * (TV-D4).
 */
export function tasksDisplayControls(scope: string): DisplayControl<TasksDisplay>[] {
  return scope === "today" ? [PROPERTIES_CONTROL] : [COMPLETED_CONTROL, PROPERTIES_CONTROL];
}

/** Every control, for reading a stored value back whatever the scope. */
const ALL_CONTROLS = [COMPLETED_CONTROL, PROPERTIES_CONTROL];

/** The view-prefs sanitiser: unknown choices fall back to the defaults. */
export function sanitizeTasksDisplay(raw: unknown, defaults: TasksDisplay): TasksDisplay {
  return sanitizeDisplayValue(raw, ALL_CONTROLS, defaults);
}

/** Where a scope's Display value lives: `moduo:tasks:view:<workspace>:<scope>`. */
export function tasksDisplayKey(workspaceId: string, scope: string): string | null {
  return viewPrefsKey("tasks", workspaceId, scope);
}
