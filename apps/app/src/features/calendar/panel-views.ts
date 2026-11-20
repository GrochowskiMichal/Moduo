// Calendar's right-panel views (lib/panel-registry.ts): the selected event or
// task (its linked notes, people and tasks show inside it, as a task's do) is
// about it; the Tasks list sits alongside the week.

import { CheckSquare, Info } from "lucide-react";

import type { PanelViewDef } from "../../lib/panel-registry";

export const calendarPanelViews: readonly PanelViewDef[] = [
  { id: "detail", label: "Detail", group: "about", icon: Info },
  // "Tasks" became Plan (CALR-5); the id stays, so remembered panels still open it.
  { id: "tasks", label: "Plan", group: "alongside", icon: CheckSquare },
];
