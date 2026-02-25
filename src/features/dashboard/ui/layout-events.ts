export const DASHBOARD_VIEW_CHANGE_EVENT = "moduo:dashboard:view-change";

export type DashboardViewChangeDetail = {
  viewId: string;
  viewName?: string;
};

function activeViewStorageKey(workspaceId: string | null): string {
  return `moduo:dashboard-active-view:v1:${workspaceId ?? "global"}`;
}

export function readStoredDashboardActiveView(workspaceId: string | null): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(activeViewStorageKey(workspaceId));
}

export function writeStoredDashboardActiveView(workspaceId: string | null, viewId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(activeViewStorageKey(workspaceId), viewId);
}

export function dispatchDashboardViewChange(viewId: string, viewName?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DashboardViewChangeDetail>(DASHBOARD_VIEW_CHANGE_EVENT, {
      detail: { viewId, viewName },
    })
  );
}
