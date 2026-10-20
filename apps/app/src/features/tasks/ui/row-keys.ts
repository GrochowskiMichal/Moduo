// The keys the List and the Board run the same way (list-keys.ts maps them;
// board-keys.ts turns the arrows sideways): selection growth, open/edit,
// finish, the row menus, the queue, delete, and the ⌥⇧↑/↓ step. Each view
// keeps only what is its own (the List's nesting and fold, the Board's
// columns, the Queue's line-up).

import type * as React from "react";

import { positionNextTo } from "../dnd/drop-mode";
import type { Task } from "../model";
import type { BoardKeyAction } from "./board-keys";
import type { ListKeyAction } from "./list-keys";
import type { TaskRowActions } from "./row-facts";
import { activateTask, type TaskCommand } from "./task-context-menu";

type MultiSelect = {
  extend: (step: 1 | -1, order: readonly string[]) => void;
  selectAll: (order: readonly string[]) => void;
  clear: () => boolean;
};

/**
 * Whether a keydown should go to the page's own keys (a selection's bulk row,
 * Upcoming's ⌥←/→, the Inbox's triage): from the view itself, never a field
 * or a row's portaled surface (React bubbles those up too).
 */
export function isViewKeyTarget(e: React.KeyboardEvent<HTMLElement>): boolean {
  return (
    e.target instanceof Node &&
    e.currentTarget.contains(e.target) &&
    !(e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]"))
  );
}

export type SharedRowKeyContext = {
  selectedTask: Task | null;
  canEdit: boolean;
  multiSelect: MultiSelect | null | undefined;
  /** The ids in the view's walking order, for ⇧↑/↓ and ⌘A. */
  order: readonly string[];
  actions: TaskRowActions;
  /** ⏎: the task's full page; a host without one (a story) edits instead. */
  onOpenTask?: (id: string) => void;
  startEdit: (id: string) => void;
  setCommand: (command: { taskId: string; kind: TaskCommand }) => void;
  toggleQueue: (id: string) => void;
  deleteTask: (id: string) => void;
};

/**
 * Run a key both views share. Returns true when the action is one of them
 * (handled or deliberately a no-op), false when the view must run it itself.
 */
export function runSharedRowKey(
  action: ListKeyAction | BoardKeyAction,
  e: Pick<React.KeyboardEvent, "preventDefault">,
  ctx: SharedRowKeyContext,
): boolean {
  const { selectedTask: task, canEdit, multiSelect } = ctx;
  switch (action) {
    case "extend-next":
    case "extend-prev":
      if (!multiSelect) return true;
      e.preventDefault();
      multiSelect.extend(action === "extend-next" ? 1 : -1, ctx.order);
      return true;
    case "select-all":
      if (!multiSelect) return true;
      e.preventDefault();
      multiSelect.selectAll(ctx.order);
      return true;
    case "clear-selection":
      if (multiSelect?.clear()) e.preventDefault();
      return true;
    case "open":
      if (!task) return true;
      if (ctx.onOpenTask) {
        e.preventDefault();
        ctx.onOpenTask(task.id);
      } else if (canEdit) {
        e.preventDefault();
        ctx.startEdit(task.id);
      }
      return true;
    case "edit":
      if (!task || !canEdit) return true;
      e.preventDefault();
      ctx.startEdit(task.id);
      return true;
    case "toggle-done":
      // The status icon's click (default k): finish, or reopen a closed one.
      if (!task || !canEdit) return true;
      e.preventDefault();
      activateTask(task, ctx.actions);
      return true;
    case "bucket":
    case "schedule":
    case "due":
    case "status":
      if (!task || !canEdit) return true;
      e.preventDefault();
      ctx.setCommand({ taskId: task.id, kind: action });
      return true;
    case "queue":
      if (!task || !canEdit) return true;
      e.preventDefault();
      ctx.toggleQueue(task.id);
      return true;
    case "delete":
      if (!task || !canEdit) return true;
      e.preventDefault();
      ctx.deleteTask(task.id);
      return true;
    default:
      return false;
  }
}

/**
 * ⌥⇧↑/↓: the position that puts `task` one place up or down among `siblings`
 * (the cards or rows it moves among), or null when it is already at the end.
 */
export function stepPosition(
  allTasks: readonly Task[],
  siblings: readonly Task[],
  task: Task,
  step: -1 | 1,
): string | null {
  const at = siblings.findIndex((t) => t.id === task.id);
  const neighbour = at < 0 ? undefined : siblings[at + step];
  if (!neighbour) return null;
  return positionNextTo(
    allTasks,
    { id: neighbour.id, edge: step < 0 ? "before" : "after" },
    task.id,
  );
}

export const stepLabel = (step: -1 | 1) => (step < 0 ? "Moved up" : "Moved down");
