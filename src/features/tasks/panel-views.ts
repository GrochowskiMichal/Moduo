// Tasks' right-panel views (lib/panel-registry.ts): Details and Project
// (TV-U13) about this; In flight (TV-F8) and the Timeline's No date (TV-TL2)
// join alongside.

import { CalendarOff, FolderKanban, Info } from "lucide-react";

import type { PanelViewDef } from "../../lib/panel-registry";

/** The Timeline's No date view (TV-TL2): listed only while the Timeline shows. */
export const NO_DATE_PANEL_VIEW = "nodate";

export const tasksPanelViews: readonly PanelViewDef[] = [
  { id: "details", label: "Details", group: "about", icon: Info },
  { id: "project", label: "Project", group: "about", icon: FolderKanban },
  { id: NO_DATE_PANEL_VIEW, label: "No date", group: "alongside", icon: CalendarOff },
];
