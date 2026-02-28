export const PLAN_SELECT_TASK_EVENT = "moduo:plan:select-task";

export type PlanSelectTaskDetail = {
  taskId: string;
  projectId: string | null;
};

export function dispatchPlanSelectTask(detail: PlanSelectTaskDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PlanSelectTaskDetail>(PLAN_SELECT_TASK_EVENT, { detail }));
}
