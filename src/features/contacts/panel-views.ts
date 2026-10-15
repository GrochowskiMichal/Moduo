// Contacts' right-panel views (lib/panel-registry.ts), registered unchanged
// until the module is rebuilt: the selected contact's or company's linked notes.

import { FileText } from "lucide-react";

import type { PanelViewDef } from "../../lib/panel-registry";

export const contactsPanelViews: readonly PanelViewDef[] = [
  { id: "notes", label: "Notes", group: "about", icon: FileText },
];
