import type { ModuoRuntime } from "../../../lib/runtime";
import type { DashboardLayout } from "../types";

export type GridSceneOption = { id: string; name: string };

export const DEFAULT_GRID_SCENE: GridSceneOption = { id: "main", name: "Main Scene" };

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

function normalizeScenes(raw: unknown): GridSceneOption[] {
  const source = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const valid: GridSceneOption[] = [];
  for (const entry of source) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as any).id;
    const name = (entry as any).name;
    if (typeof id !== "string" || typeof name !== "string") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    valid.push({ id, name });
  }
  return valid.length ? valid : [DEFAULT_GRID_SCENE];
}

function readLegacyViews(workspaceId: string): GridSceneOption[] | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(legacyViewsStorageKey(workspaceId));
  if (!raw) return null;
  try {
    return normalizeScenes(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listGridScenes(runtime: ModuoRuntime, workspaceId: string): Promise<GridSceneOption[]> {
  const storeKey = viewsStoreKey(workspaceId);
  const raw = await runtime.localStore.get(VIEWS_NAMESPACE, storeKey);
  if (raw != null) return normalizeScenes(raw);

  const legacy = readLegacyViews(workspaceId);
  if (legacy) {
    await runtime.localStore.set(VIEWS_NAMESPACE, storeKey, legacy);
    if (typeof window !== "undefined") window.localStorage.removeItem(legacyViewsStorageKey(workspaceId));
    return legacy;
  }

  const seed = [DEFAULT_GRID_SCENE];
  await runtime.localStore.set(VIEWS_NAMESPACE, storeKey, seed);
  return seed;
}

export async function saveGridScenes(runtime: ModuoRuntime, workspaceId: string, scenes: GridSceneOption[]) {
  await runtime.localStore.set(VIEWS_NAMESPACE, viewsStoreKey(workspaceId), normalizeScenes(scenes));
}

export async function readPersistedGridActiveScene(runtime: ModuoRuntime, workspaceId: string): Promise<string | null> {
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

export async function writePersistedGridActiveScene(runtime: ModuoRuntime, workspaceId: string, sceneId: string) {
  await runtime.localStore.set(VIEWS_NAMESPACE, activeViewStoreKey(workspaceId), sceneId);
}

export async function ensureGridSceneLayout(
  runtime: ModuoRuntime,
  workspaceId: string,
  sceneId: string,
  fallback: DashboardLayout = { isLocked: false, widgets: [] }
) {
  const key = layoutStoreKey(workspaceId, sceneId);
  const existing = await runtime.localStore.get(LAYOUT_NAMESPACE, key);
  if (existing == null) {
    await runtime.localStore.set(LAYOUT_NAMESPACE, key, fallback);
  }
}

export async function deleteGridSceneLayout(runtime: ModuoRuntime, workspaceId: string, sceneId: string) {
  await runtime.localStore.remove(LAYOUT_NAMESPACE, layoutStoreKey(workspaceId, sceneId));
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(legacyLayoutStorageKey(workspaceId, sceneId));
  }
}
