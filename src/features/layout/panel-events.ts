export type FeatureLayoutKey =
  | "grid"
  | "notes"
  | "tasks"
  | "ground"
  | "mindmap"
  | "templates"
  | "email"
  | "calendar"
  | "crm"
  | "forms"
  | "activity"
  | "feed"
  | "files"
  | "brainstorm"
  | "expanses"
  | "revenue"
  | "kpi-okr"
  | "stats"
  | "analytics"
  | "recordings"
  | "timetracking"
  | "roadmap"
  | "settings";

export type FeaturePanelState = {
  left: boolean;
  right: boolean;
};

export type FeaturePanelsMap = Record<FeatureLayoutKey, FeaturePanelState>;

export const LAYOUT_PANELS_APPLY_EVENT = "moduo:layout:panels-apply";
export const LAYOUT_PANELS_SET_EVENT = "moduo:layout:panels-set";
const LAYOUT_PANELS_STORAGE_KEY = "moduo:layout:panels-v2";

const defaultState: FeaturePanelState = { left: true, right: true };

function cloneDefaultMap(): FeaturePanelsMap {
  return {
    grid: { ...defaultState },
    notes: { ...defaultState },
    tasks: { ...defaultState },
    ground: { left: false, right: false },
    mindmap: { ...defaultState },
    templates: { ...defaultState },
    email: { ...defaultState },
    calendar: { ...defaultState },
    crm: { ...defaultState },
    forms: { ...defaultState },
    activity: { ...defaultState },
    feed: { ...defaultState },
    files: { ...defaultState },
    brainstorm: { ...defaultState },
    expanses: { ...defaultState },
    revenue: { ...defaultState },
    "kpi-okr": { ...defaultState },
    stats: { ...defaultState },
    analytics: { ...defaultState },
    recordings: { ...defaultState },
    timetracking: { ...defaultState },
    roadmap: { ...defaultState },
    settings: { left: true, right: false },
  };
}

export function routeToFeatureLayout(pathname: string): FeatureLayoutKey {
  if (pathname === "/grid" || pathname === "/") return "grid";
  if (pathname === "/tasks") return "ground";
  if (pathname === "/ground") return "ground";
  if (pathname === "/mindmap") return "mindmap";
  if (pathname === "/templates") return "templates";
  if (pathname === "/email") return "email";
  if (pathname === "/calendar") return "ground";
  if (pathname === "/crm") return "crm";
  if (pathname === "/forms") return "forms";
  if (pathname === "/activity") return "activity";
  if (pathname === "/feed") return "feed";
  if (pathname === "/files") return "files";
  if (pathname === "/brainstorm") return "brainstorm";
  if (pathname === "/expanses") return "expanses";
  if (pathname === "/revenue") return "revenue";
  if (pathname === "/kpi-okr") return "kpi-okr";
  if (pathname === "/stats") return "stats";
  if (pathname === "/analytics") return "analytics";
  if (pathname === "/recordings") return "recordings";
  if (pathname === "/timetracking") return "timetracking";
  if (pathname === "/roadmap") return "roadmap";
  if (pathname === "/settings") return "settings";
  return "notes";
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
  return readPanelsMap()[feature] ?? { ...defaultState };
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

export function dispatchLayoutPanelsSet(detail: LayoutPanelsApplyDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LayoutPanelsApplyDetail>(LAYOUT_PANELS_SET_EVENT, { detail }));
}
