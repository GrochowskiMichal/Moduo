import type { ModuoRuntime } from "../../../lib/runtime";
import type { DashboardLayout } from "../types";

export type DashboardViewOption = { id: string; name: string };

export const DEFAULT_DASHBOARD_VIEW: DashboardViewOption = { id: "main", name: "Main Dashboard" };

const VIEWS_NAMESPACE = "dashboard-views";
const LAYOUT_NAMESPACE = "dashboard-layout";

function viewsStoreKey(workspaceId: string): string {
  return `views:${workspaceId}`;
}

function activeViewStoreKey(workspaceId: string): string {
  return `active-view:${workspaceId}`;
}

function layoutStoreKey(workspaceId: string, viewId: string | null): string {
  return `${workspaceId}:${viewId ?? "main"}`;
}

function legacyViewsStorageKey(workspaceId: string): string {
  return `moduo:dashboard-views:v1:${workspaceId}`;
}

function legacyActiveViewStorageKey(workspaceId: string): string {
  return `moduo:dashboard-active-view:v1:${workspaceId}`;
}

function legacyLayoutStorageKey(workspaceId: string, viewId: string | null): string {
  return `moduo:dashboard-layout:v1:${workspaceId}:${viewId ?? "main"}`;
}

function normalizeViews(raw: unknown): DashboardViewOption[] {
  const source = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const valid: DashboardViewOption[] = [];
  for (const entry of source) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as any).id;
    const name = (entry as any).name;
    if (typeof id !== "string" || typeof name !== "string") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    valid.push({ id, name });
  }
  return valid.length ? valid : [DEFAULT_DASHBOARD_VIEW];
}

function readLegacyViews(workspaceId: string): DashboardViewOption[] | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(legacyViewsStorageKey(workspaceId));
  if (!raw) return null;
  try {
    return normalizeViews(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listDashboardViews(runtime: ModuoRuntime, workspaceId: string): Promise<DashboardViewOption[]> {
  const storeKey = viewsStoreKey(workspaceId);
  const raw = await runtime.localStore.get(VIEWS_NAMESPACE, storeKey);
  if (raw != null) return normalizeViews(raw);

  const legacy = readLegacyViews(workspaceId);
  if (legacy) {
    await runtime.localStore.set(VIEWS_NAMESPACE, storeKey, legacy);
    if (typeof window !== "undefined") window.localStorage.removeItem(legacyViewsStorageKey(workspaceId));
    return legacy;
  }

  const seed = [DEFAULT_DASHBOARD_VIEW];
  await runtime.localStore.set(VIEWS_NAMESPACE, storeKey, seed);
  return seed;
}

export async function saveDashboardViews(runtime: ModuoRuntime, workspaceId: string, views: DashboardViewOption[]) {
  await runtime.localStore.set(VIEWS_NAMESPACE, viewsStoreKey(workspaceId), normalizeViews(views));
}

export async function readPersistedDashboardActiveView(runtime: ModuoRuntime, workspaceId: string): Promise<string | null> {
  const raw = await runtime.localStore.get(VIEWS_NAMESPACE, activeViewStoreKey(workspaceId));
  if (typeof raw === "string" && raw.trim()) return raw;
  if (typeof window === "undefined") return null;
  const legacy = window.localStorage.getItem(legacyActiveViewStorageKey(workspaceId));
  if (legacy?.trim()) {
    await runtime.localStore.set(VIEWS_NAMESPACE, activeViewStoreKey(workspaceId), legacy);
    return legacy;
  }
  return null;
}

export async function writePersistedDashboardActiveView(runtime: ModuoRuntime, workspaceId: string, viewId: string) {
  await runtime.localStore.set(VIEWS_NAMESPACE, activeViewStoreKey(workspaceId), viewId);
}

export async function ensureDashboardLayout(
  runtime: ModuoRuntime,
  workspaceId: string,
  viewId: string,
  fallback: DashboardLayout = { isLocked: false, widgets: [] }
) {
  const key = layoutStoreKey(workspaceId, viewId);
  const existing = await runtime.localStore.get(LAYOUT_NAMESPACE, key);
  if (existing == null) {
    await runtime.localStore.set(LAYOUT_NAMESPACE, key, fallback);
  }
}

export async function deleteDashboardLayout(runtime: ModuoRuntime, workspaceId: string, viewId: string) {
  await runtime.localStore.remove(LAYOUT_NAMESPACE, layoutStoreKey(workspaceId, viewId));
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(legacyLayoutStorageKey(workspaceId, viewId));
  }
}
