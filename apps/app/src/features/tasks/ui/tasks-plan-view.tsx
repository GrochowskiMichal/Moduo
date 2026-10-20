// The Tasks plan view: the sidebar's places, the List / Board / Timeline /
// Focus in the centre, the right panel, one DnD context across them, and
// the dialogs. Its state and wiring are `useTasksPlanController`; what it
// draws is `TasksPlanLayout` (both in ./plan).

import type { TasksPlanViewProps } from "./plan/plan-base";
import { TasksPlanLayout } from "./plan/tasks-plan-layout";
import { useTasksPlanController } from "./plan/use-tasks-plan-controller";

export type { TasksPlanViewProps } from "./plan/plan-base";

export function TasksPlanView(props: TasksPlanViewProps) {
  const controller = useTasksPlanController(props);
  return <TasksPlanLayout c={controller} />;
}
