// The Tasks page's Display state (TV-U1, TV-U2): the per-scope Display value
// and filters (one view-prefs object per workspace and scope), the Display
// menu, and the tasks just checked off in this scope. One hook so the List,
// the Board and the page's selection backstop read the same rules.

import { type ReactNode, useCallback, useMemo } from "react";
import { DisplayMenu } from "../../../components/ui/display-menu";
import type { FilterCondition } from "../../../components/ui/filter-model";
import { useViewPrefs } from "../../../lib/view-prefs";
import { isCompletedHidden, useJustCompleted, useOpenedHere } from "../completed";
import {
  displayOf,
  sanitizeTasksView,
  type TaskLayout,
  type TasksDisplay,
  type TasksViewPrefs,
  tasksDisplayControls,
  tasksDisplayDefaults,
  tasksDisplayKey,
  tasksViewDefaults,
} from "../display";
import { showsDone } from "../filters";
import type { Task } from "../model";

/** What List and Board take from Display. */
export type TasksDisplayProps = {
  completed: TasksDisplay["completed"];
  properties: TasksDisplay["properties"];
  rows: TasksDisplay["rows"];
  order: TasksDisplay["order"];
  subtasks: TasksDisplay["subtasks"];
  stayingIds: ReadonlySet<string>;
};

/**
 * `tasks` is every task of the workspace. Two kinds of task stay listed
 * whatever Display says, until the scope changes (`stayingIds`): one checked
 * off here, and one deep-linked here (`linkedTaskId`, with its parent), so a
 * link to finished work lands on a row and moving on doesn't pull it out from
 * under the cursor. Browsing doesn't count: a completed task you only pass
 * through hides again with "hide". `isHidden` tells the page's selection
 * backstop which tasks the List and Board won't show, so it never picks one.
 *
 * `fallbackLayout` is the layout a scope starts with before it remembers one
 * (the workspace-wide view from before layouts were per scope).
 */
export function useTasksDisplay(
  workspaceId: string,
  scope: string,
  tasks: readonly Task[],
  linkedTaskId: string | null = null,
  fallbackLayout?: TaskLayout,
): {
  display: TasksDisplay;
  setDisplay: (next: TasksDisplay) => void;
  filters: FilterCondition[];
  setFilters: (next: FilterCondition[]) => void;
  displayControl: ReactNode;
  viewProps: TasksDisplayProps;
  isHidden: (task: Task) => boolean;
} {
  const [prefs, setPrefs] = useViewPrefs<TasksViewPrefs>(
    tasksDisplayKey(workspaceId, scope),
    () => tasksViewDefaults(scope, fallbackLayout),
    (raw, defaults) => sanitizeTasksView(raw, defaults, scope),
  );
  const display = useMemo(() => displayOf(prefs), [prefs]);
  const filters = prefs.filters;
  const setDisplay = useCallback(
    (next: TasksDisplay) => setPrefs((prev) => ({ ...next, filters: prev.filters })),
    [setPrefs],
  );
  const setFilters = useCallback(
    (next: FilterCondition[]) => setPrefs((prev) => ({ ...prev, filters: next })),
    [setPrefs],
  );
  // "Status is Done" shows done tasks whatever Completed says.
  const completed = showsDone(filters) ? "all" : display.completed;

  const scopeKey = `${workspaceId}:${scope}`;
  const justCompleted = useJustCompleted(tasks, scopeKey);
  const linkedParentId = linkedTaskId
    ? (tasks.find((t) => t.id === linkedTaskId)?.parentId ?? null)
    : null;
  const opened = useOpenedHere(
    scopeKey,
    linkedTaskId ? { id: linkedTaskId, parentId: linkedParentId } : null,
  );
  const stayingIds = useMemo<ReadonlySet<string>>(
    () => (opened.size === 0 ? justCompleted : new Set([...justCompleted, ...opened])),
    [justCompleted, opened],
  );
  const isHidden = useCallback(
    (task: Task) =>
      scope !== "today" &&
      isCompletedHidden(task, {
        mode: completed,
        now: new Date(),
        keep: (t) => stayingIds.has(t.id),
      }),
    [scope, completed, stayingIds],
  );
  return {
    display,
    setDisplay,
    filters,
    setFilters,
    isHidden,
    displayControl: (
      <DisplayMenu
        controls={tasksDisplayControls(scope, display.layout)}
        value={display}
        onValueChange={setDisplay}
        defaultValue={tasksDisplayDefaults(scope)}
      />
    ),
    viewProps: {
      completed,
      properties: display.properties,
      rows: display.rows,
      order: display.order,
      subtasks: display.subtasks,
      stayingIds,
    },
  };
}
