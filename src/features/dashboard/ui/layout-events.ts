export const GRID_SCENE_CHANGE_EVENT = "moduo:dashboard:view-change";

export type GridSceneChangeDetail = {
  sceneId: string;
  sceneName?: string;
};

function activeSceneStorageKey(workspaceId: string | null): string {
  return `moduo:dashboard-active-view:v1:${workspaceId ?? "global"}`;
}

export function readStoredGridActiveScene(workspaceId: string | null): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(activeSceneStorageKey(workspaceId));
}

export function writeStoredGridActiveScene(workspaceId: string | null, sceneId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(activeSceneStorageKey(workspaceId), sceneId);
}

export function dispatchGridSceneChange(sceneId: string, sceneName?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<GridSceneChangeDetail>(GRID_SCENE_CHANGE_EVENT, {
      detail: { sceneId, sceneName },
    })
  );
}
