// The Tasks page's Display state (TV-U1): the per-scope Display value, its
// menu, and the tasks just checked off in this scope. One hook so the List,
// the Board and the page's selection backstop read the same rules.

import { type ReactNode, useCallback, useMemo } from "react";
import { DisplayMenu } from "../../../components/ui/display-menu";
import { useViewPrefs } from "../../../lib/view-prefs";
import { isCompletedHidden, useJustCompleted, useOpenedHere } from "../completed";
import {
  sanitizeTasksDisplay,
  TASKS_DISPLAY_DEFAULTS,
  type TasksDisplay,
  tasksDisplayControls,
  tasksDisplayKey,
} from "../display";
import type { Task } from "../model";

export type TasksDisplayProps = {
  displayControl: ReactNode;
  completed: TasksDisplay["completed"];
  properties: TasksDisplay["properties"];
  stayingIds: ReadonlySet<string>;
};

/**
 * `tasks` is every task of the workspace. Two kinds of task stay listed
 * whatever Display says, until the scope changes (`stayingIds`): one checked
 * off here, and one opened here (selected or deep-linked, with its parent), so
 * a link to finished work lands on a row and moving on doesn't pull it out
 * from under the cursor. `isHidden` tells the page's selection backstop which
 * tasks the List and Board won't show, so it never picks one.
 */
export function useTasksDisplay(
  workspaceId: string,
  scope: string,
  tasks: readonly Task[],
  selectedTaskId: string | null = null,
): {
  display: TasksDisplay;
  setDisplay: (next: TasksDisplay) => void;
  viewProps: TasksDisplayProps;
  isHidden: (task: Task) => boolean;
} {
  const [display, setDisplay] = useViewPrefs(
    tasksDisplayKey(workspaceId, scope),
    TASKS_DISPLAY_DEFAULTS,
    sanitizeTasksDisplay,
  );
  const scopeKey = `${workspaceId}:${scope}`;
  const justCompleted = useJustCompleted(tasks, scopeKey);
  const selectedParentId = selectedTaskId
    ? (tasks.find((t) => t.id === selectedTaskId)?.parentId ?? null)
    : null;
  const opened = useOpenedHere(
    scopeKey,
    selectedTaskId ? { id: selectedTaskId, parentId: selectedParentId } : null,
  );
  const stayingIds = useMemo<ReadonlySet<string>>(
    () => (opened.size === 0 ? justCompleted : new Set([...justCompleted, ...opened])),
    [justCompleted, opened],
  );
  const isHidden = useCallback(
    (task: Task) =>
      scope !== "today" &&
      isCompletedHidden(task, {
        mode: display.completed,
        now: new Date(),
        keep: (t) => stayingIds.has(t.id),
      }),
    [scope, display.completed, stayingIds],
  );
  return {
    display,
    setDisplay,
    isHidden,
    viewProps: {
      displayControl: (
        <DisplayMenu
          controls={tasksDisplayControls(scope)}
          value={display}
          onValueChange={setDisplay}
          defaultValue={TASKS_DISPLAY_DEFAULTS}
        />
      ),
      completed: display.completed,
      properties: display.properties,
      stayingIds,
    },
  };
}
