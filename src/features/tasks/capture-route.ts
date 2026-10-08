// Where a capture lands (TV-F2, F2-5): during a run, and from the Queue,
// "Add to my queue" starts on, and a capture with it on joins my queue.

import type { NewTaskFields } from "./helpers";
import type { TasksModuleApi } from "./hooks/use-tasks-module";

/** "Add to my queue" starts on during a run here, and in the Queue. */
export function captureQueuesByDefault(runHere: boolean, selection: string): boolean {
  return runHere || selection === "today";
}

/** Create the captured task, into my queue when the switch was on. */
export function routeCapture(
  api: Pick<TasksModuleApi, "captureToQueue" | "createTask">,
  fields: Omit<NewTaskFields, "workspaceId" | "position">,
  opts: { queue: boolean },
): void {
  if (opts.queue) api.captureToQueue(fields);
  else void api.createTask(fields);
}
