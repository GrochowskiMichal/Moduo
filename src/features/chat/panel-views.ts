// Chat's right-panel views (lib/panel-registry.ts, spec #10): Details, Reply
// chains and Files, all *about this* conversation, ⌥1–3 in that order.
// Registered together (CV-8b); the screen lists only the views it can render
// (`RightPanel` drops a view without a render function), so Reply chains and
// Files appear with CV-12 and CV-9. A person, a message in context or any
// other reference opened in the panel is an item ("← item"), not a view.

import { FileText, Info, MessagesSquare } from "lucide-react";

import type { PanelViewDef } from "../../lib/panel-registry";

export const chatPanelViews: readonly PanelViewDef[] = [
  { id: "details", label: "Details", group: "about", icon: Info },
  { id: "chains", label: "Reply chains", group: "about", icon: MessagesSquare },
  { id: "files", label: "Files", group: "about", icon: FileText },
];
