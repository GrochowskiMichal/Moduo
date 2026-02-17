export const DASHBOARD_VIEW_CHANGE_EVENT = "moduo:dashboard:view-change";

export type DashboardViewChangeDetail = {
  viewId: string;
  viewName: string;
};

export function dispatchDashboardViewChange(viewId: string, viewName: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DashboardViewChangeDetail>(DASHBOARD_VIEW_CHANGE_EVENT, {
      detail: { viewId, viewName },
    })
  );
}
