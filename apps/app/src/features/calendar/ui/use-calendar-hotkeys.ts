// Keyboard nav (AC1): T today · ←/→ period · D/W views · Delete on the selected
// native chip. Registry bindings in the "calendar" scope (lib/hotkeys); handlers
// route through a ref so the one listener never captures stale state.

import { useEffect, useRef } from "react";

import { useAppHotkeys } from "../../../lib/hotkeys";
import type { CalendarView } from "../lens";

type Input = {
  setView: (view: CalendarView) => void;
  goToday: () => void;
  step: (dir: 1 | -1) => void;
  selectedOccurrenceKey: string | null;
  requestDelete: (occKey: string | null) => void;
};

/**
 * A key pressed inside an open overlay (menus typeahead on plain character
 * keys without preventDefault; dialogs own their focus) is never the page's.
 */
export function inCalendarOverlay(e: KeyboardEvent): boolean {
  return (
    e.target instanceof Element &&
    !!e.target.closest("[role='dialog'], [role='menu'], [role='listbox'], [role='combobox']")
  );
}

export function useCalendarHotkeys(input: Input): void {
  const keysRef = useRef(input);
  useEffect(() => {
    keysRef.current = input;
  });
  // Never from a field. Don't steal keys from open overlays either (menus typeahead on
  // plain character keys without preventDefault; dialogs own their focus).
  const inOverlay = inCalendarOverlay;
  const calendarKey = (run: () => void) => (e: KeyboardEvent) => {
    if (inOverlay(e)) return false;
    run();
  };
  useAppHotkeys({
    "calendar.today": calendarKey(() => keysRef.current.goToday()),
    "calendar.day": calendarKey(() => keysRef.current.setView("day")),
    "calendar.week": calendarKey(() => keysRef.current.setView("week")),
    "calendar.prev": calendarKey(() => keysRef.current.step(-1)),
    "calendar.next": calendarKey(() => keysRef.current.step(1)),
    // Destructive keys act only from a neutral focus (the grid/body) — never
    // while an interactive element (a panel row, a toolbar button) holds focus
    // with a stale chip selection lingering.
    "calendar.delete": (e) => {
      if (inOverlay(e)) return false;
      if (
        e.target instanceof Element &&
        e.target.closest("button, [role='button'], a, [tabindex]")
      ) {
        return false;
      }
      const k = keysRef.current;
      k.requestDelete(k.selectedOccurrenceKey);
    },
  });
}
