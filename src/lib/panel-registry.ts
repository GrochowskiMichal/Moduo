// The right-panel view registry (tasks-v3 calls 72/72a, spec §Assumptions #21).
//
// The right panel's title row names the open view and switches it ("Details ▾").
// Each module lists its hand-picked views here, in a fixed order, split into
// two groups by a hairline in the menu: *about this* (the selected item's own
// views) on top, *alongside* (views that sit beside the work) below. A view's
// shortcut is ⌥ + its position in the menu. References opened in the panel are
// items, not views (the "← item" stack in components/app/right-panel.tsx), so
// nothing here grows with what a person opens.
//
// Only metadata lives here; each page still renders its views (they close over
// page state). Adding a view = an entry in the module's `panel-views.ts`.

import type { LucideIcon } from "lucide-react";

import { calendarPanelViews } from "../features/calendar/panel-views";
import { contactsPanelViews } from "../features/contacts/panel-views";
import { emailPanelViews } from "../features/email/panel-views";
import { notesPanelViews } from "../features/notes/panel-views";
import { tasksPanelViews } from "../features/tasks/panel-views";

export type PanelViewGroup = "about" | "alongside";

/** One view a module offers in its right panel. */
export type PanelViewDef = {
  /** Stable id the page keys its render function by. */
  id: string;
  /** Sentence case, as the title row and the menu show it. */
  label: string;
  group: PanelViewGroup;
  icon: LucideIcon;
};

export type PanelModule = "tasks" | "calendar" | "email" | "notes" | "contacts";

/** At most this many views per module (72a: "about 6 per module at most"). */
export const MAX_PANEL_VIEWS = 6;

export const PANEL_VIEWS: Record<PanelModule, readonly PanelViewDef[]> = {
  tasks: tasksPanelViews,
  calendar: calendarPanelViews,
  email: emailPanelViews,
  notes: notesPanelViews,
  contacts: contactsPanelViews,
};

const GROUP_ORDER: readonly PanelViewGroup[] = ["about", "alongside"];

/** The views in menu order: *about this* first, then *alongside*; each group
 *  keeps its registration order. Positions in this list are the ⌥ shortcuts. */
export function orderedPanelViews(views: readonly PanelViewDef[]): PanelViewDef[] {
  return GROUP_ORDER.flatMap((group) => views.filter((v) => v.group === group));
}

/** A module's views in menu order, narrowed to the ones the page can render. */
export function panelViewsFor(
  module: PanelModule,
  available?: (id: string) => boolean,
): PanelViewDef[] {
  const views = orderedPanelViews(PANEL_VIEWS[module]);
  return available ? views.filter((v) => available(v.id)) : views;
}

/**
 * The view number (1–9) a keydown asks for, or null. ⌥ + digit, no other
 * modifier. Matched on `event.code` because macOS turns ⌥1 into "¡" in
 * `event.key` (keymap rule 4). ⌘1–7 stay the module keys.
 */
export function panelShortcutNumber(event: KeyboardEvent): number | null {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null;
  const match = /^Digit([1-9])$/.exec(event.code);
  return match ? Number(match[1]) : null;
}

/** The shortcut hint for the view at `index` (0-based) in the menu. */
export function panelShortcutLabel(index: number, isMac: boolean): string {
  return isMac ? `⌥${index + 1}` : `Alt ${index + 1}`;
}
