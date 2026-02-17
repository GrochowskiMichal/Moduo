export type FeatureLayoutKey =
  | "dashboard"
  | "calendar"
  | "notes"
  | "email"
  | "tasks"
  | "tags"
  | "form"
  | "timesheet"
  | "whiteboard"
  | "mindmap"
  | "files"
  | "stats"
  | "budget";

export type FeaturePanelState = {
  left: boolean;
  right: boolean;
};

export type FeaturePanelsMap = Record<FeatureLayoutKey, FeaturePanelState>;

export const LAYOUT_PANELS_APPLY_EVENT = "moduo:layout:panels-apply";
const LAYOUT_PANELS_STORAGE_KEY = "moduo:layout:panels-v1";

const defaultState: FeaturePanelState = { left: true, right: true };

function cloneDefaultMap(): FeaturePanelsMap {
  return {
    dashboard: { ...defaultState },
    calendar: { ...defaultState },
    notes: { ...defaultState },
    email: { ...defaultState },
    tasks: { ...defaultState },
    tags: { ...defaultState },
    form: { ...defaultState },
    timesheet: { ...defaultState },
    whiteboard: { ...defaultState },
    mindmap: { ...defaultState },
    files: { ...defaultState },
    stats: { ...defaultState },
    budget: { ...defaultState },
  };
}

export function routeToFeatureLayout(pathname: string): FeatureLayoutKey {
  if (pathname === "/calendar") return "calendar";
  if (pathname === "/notes") return "notes";
  if (pathname === "/email") return "email";
  if (pathname === "/tasks") return "tasks";
  if (pathname === "/tags") return "tags";
  if (pathname === "/form") return "form";
  if (pathname === "/timesheet") return "timesheet";
  if (pathname === "/whiteboard") return "whiteboard";
  if (pathname === "/mindmap") return "mindmap";
  if (pathname === "/files") return "files";
  if (pathname === "/stats") return "stats";
  if (pathname === "/budget") return "budget";
  return "dashboard";
}

export function readPanelsMap(): FeaturePanelsMap {
  if (typeof window === "undefined") return cloneDefaultMap();
  const raw = window.localStorage.getItem(LAYOUT_PANELS_STORAGE_KEY);
  if (!raw) return cloneDefaultMap();
  try {
    const parsed = JSON.parse(raw) as Partial<FeaturePanelsMap>;
    const defaults = cloneDefaultMap();
    for (const key of Object.keys(defaults) as FeatureLayoutKey[]) {
      const next = parsed?.[key];
      if (next && typeof next.left === "boolean" && typeof next.right === "boolean") {
        defaults[key] = { left: next.left, right: next.right };
      }
    }
    return defaults;
  } catch {
    return cloneDefaultMap();
  }
}

export function writePanelsMap(map: FeaturePanelsMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAYOUT_PANELS_STORAGE_KEY, JSON.stringify(map));
}

export function readFeaturePanelState(feature: FeatureLayoutKey): FeaturePanelState {
  return readPanelsMap()[feature];
}

export type LayoutPanelsApplyDetail = {
  feature: FeatureLayoutKey;
  left: boolean;
  right: boolean;
};

export function dispatchLayoutPanelsApply(detail: LayoutPanelsApplyDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LayoutPanelsApplyDetail>(LAYOUT_PANELS_APPLY_EVENT, { detail }));
}
