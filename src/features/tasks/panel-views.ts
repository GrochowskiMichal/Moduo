// Tasks' right-panel views (lib/panel-registry.ts): Details and Project
// (TV-U13) about this; In flight (TV-F8) and the Timeline's No date (TV-TL2)
// alongside, in that order, so the keymap's ⌥3 In flight · ⌥4 No date holds.
// And which of them shows (MOD-131), pure, for the page.

import { CalendarOff, FolderKanban, Info, PlaneTakeoff } from "lucide-react";

import type { PanelViewDef } from "../../lib/panel-registry";

/** In flight (TV-F8): hand-offs with their check-backs, and my agents' work. */
export const IN_FLIGHT_PANEL_VIEW = "inflight";

/** The Timeline's No date view (TV-TL2): listed only while the Timeline shows. */
export const NO_DATE_PANEL_VIEW = "nodate";

export const tasksPanelViews: readonly PanelViewDef[] = [
  { id: "details", label: "Details", group: "about", icon: Info },
  { id: "project", label: "Project", group: "about", icon: FolderKanban },
  { id: IN_FLIGHT_PANEL_VIEW, label: "In flight", group: "alongside", icon: PlaneTakeoff },
  { id: NO_DATE_PANEL_VIEW, label: "No date", group: "alongside", icon: CalendarOff },
];

// ── which view shows ────────────────────────────────────────────────────────

/** What a project's title in the centre asked the panel for (MOD-95). */
export type ProjectAsk = { projectId: string; taskId: string | null; place: string };

/**
 * The project the title's ask is still for: until the cursor or the place
 * moves (a click on a task, the selected one too, ends it as well, MOD-131).
 */
export function askedProjectFor(
  ask: ProjectAsk | null,
  selectedTaskId: string | null,
  place: string,
): string | null {
  return ask && ask.taskId === selectedTaskId && ask.place === place ? ask.projectId : null;
}

/**
 * The view the right panel shows. It remembers the view picked from its menu
 * (`remembered`). The title's ask is only a look (MOD-131): it shows Project
 * over everything, a multi-selection's bulk panel too, while it stands, then
 * the panel is back on the remembered view, never stuck on Project. Then: a
 * multi-selection shows Details (its bulk panel); the Timeline's No date
 * stays open while you work the canvas (TV-TL2); and with nothing selected
 * inside a project, or a task in the centre, Project shows (`projectInstead`).
 */
export function activePanelView(state: {
  asked: boolean;
  multi: boolean;
  remembered: string;
  /** The Timeline shows, and no task fills the centre. */
  noDateShown: boolean;
  projectInstead: boolean;
}): string {
  if (state.asked) return "project";
  if (state.multi) return "details";
  if (state.remembered === NO_DATE_PANEL_VIEW && state.noDateShown) return NO_DATE_PANEL_VIEW;
  if (state.projectInstead) return "project";
  return state.remembered;
}
