// Notes' right-panel views (lib/panel-registry.ts), registered unchanged from
// its old tabs until the module is rebuilt. All three are about the open note;
// a task opened from the note shows as an item ("← title"), not a view.

import { Info, ListTree, MessageSquare } from "lucide-react";

import type { PanelViewDef } from "../../lib/panel-registry";

export const notesPanelViews: readonly PanelViewDef[] = [
  { id: "detail", label: "Detail", group: "about", icon: Info },
  { id: "comments", label: "Comments", group: "about", icon: MessageSquare },
  { id: "outline", label: "Outline", group: "about", icon: ListTree },
];
