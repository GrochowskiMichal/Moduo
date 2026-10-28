// Narrow windows, Calendar only (CALR-13, AC14). Pure: which side panels show
// at a window width. Below 1600 px the calendars panel folds; below 1360 px
// one side panel shows at a time (Plan, unless you open the calendars panel).
// The full-width choice is what a wide window gives back; the shell itself
// doesn't change (`ui/use-calendar-narrow-panels.ts` drives it).

export const FOLD_CALENDARS_BELOW = 1600;
export const ONE_PANEL_BELOW = 1360;

export type PanelPair = { left: boolean; right: boolean };
export type PanelBand = "wide" | "fold-calendars" | "one-panel";

export function panelBand(width: number): PanelBand {
  if (width >= FOLD_CALENDARS_BELOW) return "wide";
  return width >= ONE_PANEL_BELOW ? "fold-calendars" : "one-panel";
}

/** The panels on entering a band (a load, or a resize across a line). */
export function panelsOnEnter(band: PanelBand, wide: PanelPair): PanelPair {
  if (band === "wide") return { ...wide };
  return { left: false, right: wide.right };
}

/** A toggle inside a band: below 1360 px the panel just opened folds the other. */
export function panelsOnToggle(band: PanelBand, prev: PanelPair, next: PanelPair): PanelPair {
  if (band !== "one-panel" || !(next.left && next.right)) return { ...next };
  if (!prev.left) return { left: true, right: false };
  return { left: false, right: true };
}
