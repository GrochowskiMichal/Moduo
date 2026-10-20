// TaskDetailPanel for a host under `<TasksProvider>` (A4): it takes the whole
// Tasks api from context, so the host itself reads only the narrow hooks.
// Part 2 moves the panel onto the narrow hooks and retires this.

import type { ComponentProps } from "react";
import { useTasksApi } from "../tasks-context";
import { TaskDetailPanel } from "./task-detail-panel";

type Props = Omit<ComponentProps<typeof TaskDetailPanel>, "api" | "buckets" | "inbox" | "canEdit">;

export function ContextTaskDetailPanel(props: Props) {
  const api = useTasksApi();
  return (
    <TaskDetailPanel
      {...props}
      buckets={api.buckets}
      inbox={api.inbox}
      canEdit={api.canEdit}
      api={api}
    />
  );
}
