// Email's right-panel views (lib/panel-registry.ts, specs/mail-v3.md §10):
// Today (⌥1), Contact (⌥2) and Task (⌥3), in that order, so the ⌥ digits the
// registry derives from the menu position hold. The open one lives in the mail
// store (`panel`); `panels/side-panel.tsx` renders them.

import { CalendarDays, CheckSquare, Contact } from "lucide-react";

import type { PanelViewDef } from "../../lib/panel-registry";
import type { MailPanelView } from "./store/mail-store";

export const emailPanelViews: readonly (PanelViewDef & { id: MailPanelView })[] = [
  { id: "today", label: "Today", group: "about", icon: CalendarDays },
  { id: "contact", label: "Contact", group: "about", icon: Contact },
  { id: "task", label: "Task", group: "about", icon: CheckSquare },
];
