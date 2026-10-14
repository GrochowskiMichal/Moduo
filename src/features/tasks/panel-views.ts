// Tasks' right-panel views (lib/panel-registry.ts): Details and Project
// (TV-U13) about this; In flight (TV-F8) and the Timeline's No date (TV-TL2)
// alongside, in that order, so the keymap's ⌥3 In flight · ⌥4 No date holds.

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
