// "Break down" (REPLAN 23, TV-U10): a late task's third fix. The List selects
// the task and asks the detail panel to open its subtask line, so the big
// late thing becomes small next steps. The List needn't know the panel: the
// ask waits here until the panel showing that task takes it (it may not show
// it yet when the ask is made), and an event wakes a panel already showing it.

export const BREAK_DOWN_EVENT = "moduo:tasks:break-down";

let waiting: string | null = null;

/** Ask the panel showing `taskId` to start adding a subtask. */
export function requestBreakDown(taskId: string): void {
  waiting = taskId;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(BREAK_DOWN_EVENT, { detail: taskId }));
}

/** Whether an ask waits for this task; taking it clears it. */
export function takeBreakDown(taskId: string): boolean {
  if (waiting !== taskId) return false;
  waiting = null;
  return true;
}

/** Wake a panel when an ask arrives; returns the unsubscribe. */
export function onBreakDown(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(BREAK_DOWN_EVENT, handler);
  return () => window.removeEventListener(BREAK_DOWN_EVENT, handler);
}
