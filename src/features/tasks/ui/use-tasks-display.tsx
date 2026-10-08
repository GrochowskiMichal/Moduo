// The Tasks page's Display state (TV-U1): the per-scope Display value, its
// menu, and the tasks just checked off in this scope. One hook so the List,
// the Board and the page's selection backstop read the same rules.

import { type ReactNode, useCallback } from "react";
import { DisplayMenu } from "../../../components/ui/display-menu";
import { useViewPrefs } from "../../../lib/view-prefs";
import { isCompletedHidden, useJustCompleted } from "../completed";
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
  justCompletedIds: ReadonlySet<string>;
};

/**
 * `tasks` is every task of the workspace (a task checked off anywhere in this
 * scope stays listed until the scope changes). `isHidden` tells the page's
 * selection backstop which tasks the List and Board won't show, so it never
 * picks one (the views keep a selected task listed, so a deep link to a done
 * task still lands).
 */
export function useTasksDisplay(
  workspaceId: string,
  scope: string,
  tasks: readonly Task[],
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
  const justCompletedIds = useJustCompleted(tasks, `${workspaceId}:${scope}`);
  const isHidden = useCallback(
    (task: Task) =>
      scope !== "today" &&
      isCompletedHidden(task, {
        mode: display.completed,
        now: new Date(),
        keep: (t) => justCompletedIds.has(t.id),
      }),
    [scope, display.completed, justCompletedIds],
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
      justCompletedIds,
    },
  };
}
