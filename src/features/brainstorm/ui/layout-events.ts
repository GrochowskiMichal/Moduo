export const BRAINSTORM_SELECT_VIEW_EVENT = "moduo:brainstorm:select-view";

export type BrainstormSelectViewDetail = {
  viewId: string | null;
  viewName?: string;
};

export function dispatchBrainstormSelectView(viewId: string | null, viewName?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BrainstormSelectViewDetail>(BRAINSTORM_SELECT_VIEW_EVENT, {
      detail: { viewId, viewName },
    })
  );
}
