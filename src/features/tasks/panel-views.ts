// Tasks' right-panel views (lib/panel-registry.ts). Details today; Project
// (TV-U13), In flight (TV-F8) and the Timeline's No date (TV-TL2) join here.

import { Info } from "lucide-react";

import type { PanelViewDef } from "../../lib/panel-registry";

export const tasksPanelViews: readonly PanelViewDef[] = [
  { id: "details", label: "Details", group: "about", icon: Info },
];
