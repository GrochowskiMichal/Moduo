export const TASKS_FOCUS_SEARCH_EVENT = "moduo:tasks:focus-search";
export const TASKS_CREATE_ENTITY_EVENT = "moduo:tasks:create-entity";
export const TASKS_TOGGLE_LEFT_PANEL_EVENT = "moduo:tasks:toggle-left-panel";
export const TASKS_TOGGLE_RIGHT_PANEL_EVENT = "moduo:tasks:toggle-right-panel";
export const TASKS_SELECT_PROJECT_EVENT = "moduo:tasks:select-project";

export type TasksCreateEntityDetail = {
  entity: "task" | "project";
};

export type TasksSelectProjectDetail = {
  projectId: string | null;
};

export function dispatchTasksFocusSearch() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TASKS_FOCUS_SEARCH_EVENT));
}

export function dispatchTasksCreateEntity(entity: TasksCreateEntityDetail["entity"]) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TasksCreateEntityDetail>(TASKS_CREATE_ENTITY_EVENT, {
      detail: { entity },
    })
  );
}

export function dispatchTasksToggleLeftPanel() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TASKS_TOGGLE_LEFT_PANEL_EVENT));
}

export function dispatchTasksToggleRightPanel() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TASKS_TOGGLE_RIGHT_PANEL_EVENT));
}

export function dispatchTasksSelectProject(projectId: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TasksSelectProjectDetail>(TASKS_SELECT_PROJECT_EVENT, {
      detail: { projectId },
    })
  );
}
