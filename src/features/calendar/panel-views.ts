// Calendar's right-panel views (lib/panel-registry.ts), registered unchanged
// from its old tabs until the module is rebuilt: the selected event or task and
// its linked notes are about it; the Tasks list sits alongside the week.

import { CheckSquare, FileText, Info } from "lucide-react";

import type { PanelViewDef } from "../../lib/panel-registry";

export const calendarPanelViews: readonly PanelViewDef[] = [
  { id: "detail", label: "Detail", group: "about", icon: Info },
  { id: "notes", label: "Notes", group: "about", icon: FileText },
  { id: "tasks", label: "Tasks", group: "alongside", icon: CheckSquare },
];
