// The Home page owns its state (edit mode + the pager), but its chrome controls
// live in the app-chrome bottom bar — the slots the panel toggles occupy on other
// routes, empty on Home: the page DOTS on the left, the Edit/Done control on the
// right. These window events bridge the two (mirroring the email-unread-badge
// pattern), so DashboardPage stays self-contained (owns the state, works
// standalone in stories) and the chrome controls are thin remotes.

/** Home → chrome: current edit-mode state (dispatched on mount + on change). */
export const DASHBOARD_EDIT_CHANGED_EVENT = "moduo:dashboard:edit-changed";
/** Home → chrome: current pager shape, so the bottom-bar dots can render. */
export const DASHBOARD_PAGER_EVENT = "moduo:dashboard:pager";
/** Chrome → Home: toggle edit mode (the Edit/Done control was pressed). */
export const DASHBOARD_TOGGLE_EDIT_EVENT = "moduo:dashboard:toggle-edit";
/** Chrome → Home: a page action from the bottom-bar dots (switch / add / remove). */
export const DASHBOARD_PAGE_ACTION_EVENT = "moduo:dashboard:page-action";

export interface DashboardPagerInfo {
  count: number;
  activeIndex: number;
}

export type DashboardPageAction =
  | { type: "goto"; index: number }
  | { type: "add" }
  | { type: "remove" };

export function dispatchDashboardEditChanged(editing: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_EDIT_CHANGED_EVENT, { detail: { editing } }));
}

export function dispatchDashboardPager(info: DashboardPagerInfo): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_PAGER_EVENT, { detail: info }));
}

export function dispatchDashboardToggleEdit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DASHBOARD_TOGGLE_EDIT_EVENT));
}

export function dispatchDashboardPageAction(action: DashboardPageAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_PAGE_ACTION_EVENT, { detail: action }));
}
