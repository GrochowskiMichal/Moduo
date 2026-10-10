// Email's right-panel views (lib/panel-registry.ts), registered unchanged from
// its old tabs until the module is rebuilt. All four are about the open thread.

import { CheckSquare, Contact, Info, Mail } from "lucide-react";

import type { PanelViewDef } from "../../lib/panel-registry";

export const emailPanelViews: readonly PanelViewDef[] = [
  { id: "reader", label: "Reader", group: "about", icon: Mail },
  { id: "contact", label: "Contact", group: "about", icon: Contact },
  { id: "detail", label: "Detail", group: "about", icon: Info },
  { id: "task", label: "Task", group: "about", icon: CheckSquare },
];
