export const MINDMAP_SELECT_MAP_EVENT = "moduo:mindmap:select-map";

export type MindmapSelectMapDetail = {
  mindmapId: string | null;
  mindmapName?: string;
};

export function dispatchMindmapSelectMap(mindmapId: string | null, mindmapName?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<MindmapSelectMapDetail>(MINDMAP_SELECT_MAP_EVENT, {
      detail: { mindmapId, mindmapName },
    }),
  );
}
