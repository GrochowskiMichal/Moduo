// Calendar's keys (AC1, CALR-4 AC22): T today · D/W/M views · ⌘←/⌘→ period ·
// the grid cursor (arrows, a busy slot picks its event) · J/K · Space · ↵ ·
// ⌥ moves and resizes · ⌫ · ⌘C/⌘V/⌘D · ⌘Z. Registry bindings in the
// "calendar" scope (lib/hotkeys); handlers read the latest state through a
// ref, so the listeners never capture a stale week. The pure moves are in
// ../grid-keys.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { dispatchCreateNew } from "../../../components/app/create-events";
import { useAppHotkeys } from "../../../lib/hotkeys";
import { readFeaturePanelState } from "../../layout/panel-events";
import { clearUndo, undoLast } from "../commands/undo";
import type { CalendarEventModel, EventChip } from "../events";
import { findNextGap } from "../gap-finder";
import {
  adjacentChip,
  chipAtCursor,
  copyDraft,
  cursorAfterPeriod,
  cursorBox,
  type CursorDir,
  cursorForChip,
  duplicateStartMs,
  type GridCursor,
  type KeyedChange,
  keyedChange,
  type MoveEventDeltas,
  slotSpan,
  stepCursor,
} from "../grid-keys";
import { type CalendarView, localDayKey } from "../lens";
import type { QuickCreateDraft } from "../new-event-create";
import type { CalendarPrefs, PanelVariantId } from "../prefs";

type Input = {
  view: CalendarView;
  days: Date[];
  chips: { timed: Map<string, EventChip[]>; allDay: Map<string, EventChip[]> };
  eventsById: Map<string, CalendarEventModel>;
  canEdit: boolean;
  isWritable: (event: CalendarEventModel) => boolean;
  prefs: CalendarPrefs;
  workspaceId: string;
  panelVariant: PanelVariantId;
  selectedOccurrenceKey: string | null;
  select: (key: string | null) => void;
  setView: (view: CalendarView) => void;
  goToday: () => void;
  step: (dir: 1 | -1) => void;
  occurrence: {
    requestEventDelete: (eventId: string, occurrenceStartMs?: number) => void;
    occurrenceStartOf: (event: CalendarEventModel, occKey?: string | null) => number;
  };
  onMoveEvent: (
    eventId: string,
    deltas: MoveEventDeltas,
    occurrence?: { startMs: number; endMs: number },
  ) => void;
  createEvent: (draft: QuickCreateDraft & { description?: string }) => void;
  onEventClick: (chip: EventChip, rect: DOMRect) => void;
  openDetail: (target: { type: "event"; id: string }) => void;
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

const GRID = "[data-calendar-grid]";

/** Month has no time grid: the cursor, its moves and its slot keys stand down there. */
function noTimeGrid(view: CalendarView): boolean {
  return view === "month";
}

/** The grid itself, an event chip, or nothing focused: where the grid keys act. */
function onTheGrid(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof Element) || t === document.body || t === document.documentElement) return true;
  if (inCalendarOverlay(e)) return false;
  return !!t.closest(`${GRID}, [data-chip='event']`);
}

/** ↵ and Space activate a focused button themselves: act only from the grid or the page. */
function onTheGridItself(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof Element) || t === document.body || t === document.documentElement) return true;
  return t.matches(GRID);
}

const flat = (map: Map<string, EventChip[]>) => [...map.values()].flat();

export function useCalendarHotkeys(input: Input) {
  const [cursor, setCursor] = useState<GridCursor | null>(null);
  const pendingPeriod = useRef<{ period: -1 | 1; minute: number } | null>(null);
  const copied = useRef<string | null>(null);
  const dayKeys = useMemo(() => input.days.map(localDayKey), [input.days]);
  const timed = useMemo(() => flat(input.chips.timed), [input.chips.timed]);
  const all = useMemo(() => [...timed, ...flat(input.chips.allDay)], [timed, input.chips.allDay]);

  const keysRef = useRef({ ...input, cursor, dayKeys, timed, all });
  useEffect(() => {
    keysRef.current = { ...input, cursor, dayKeys, timed, all };
  });

  // A new workspace, or leaving Calendar: ⌘Z can't reach the old steps.
  useEffect(() => () => clearUndo(), [input.workspaceId]);

  // After ← / → stepped the period, the cursor lands on the near edge.
  useEffect(() => {
    const pending = pendingPeriod.current;
    if (!pending) return;
    pendingPeriod.current = null;
    setCursor(cursorAfterPeriod(dayKeys, pending.period, pending.minute));
  }, [dayKeys]);

  // A click selects an event: the cursor follows it, unless it's already on it.
  const { selectedOccurrenceKey } = input;
  useEffect(() => {
    const chip = all.find((c) => c.occurrenceKey === selectedOccurrenceKey);
    if (!chip) {
      // A one-off event moved (a key, an undo, a drag elsewhere): its key is its
      // start, so the selection follows it to the new one.
      const id = selectedOccurrenceKey?.split(":")[0];
      const moved = id ? all.find((c) => c.eventId === id && !c.recurring) : undefined;
      if (moved) keysRef.current.select(moved.occurrenceKey);
      return;
    }
    setCursor((cur) =>
      cur && chipAtCursor(cur, [chip])?.occurrenceKey === chip.occurrenceKey
        ? cur
        : cursorForChip(chip),
    );
  }, [selectedOccurrenceKey, all]);

  const startCursor = useCallback((): GridCursor => {
    const k = keysRef.current;
    const selected = k.all.find((c) => c.occurrenceKey === k.selectedOccurrenceKey);
    if (k.cursor && k.dayKeys.includes(k.cursor.dayKey)) return k.cursor;
    if (selected) return cursorForChip(selected);
    const now = new Date();
    const today = localDayKey(now);
    if (k.dayKeys.includes(today)) return cursorForChip({ dayKey: today, startMs: now.getTime() });
    return {
      dayKey: k.dayKeys[0] ?? today,
      minute: Math.floor(k.prefs.workStartMinute / 30) * 30,
    };
  }, []);

  // Tabbing into the grid puts the cursor down (now, the selection, or the working day).
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.matches(GRID)) {
        setCursor((cur) => cur ?? startCursor());
      }
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, [startCursor]);

  // Space and ↵ open a card or a new event without a trigger: when it closes
  // and focus falls to the page, it goes back to the grid (rules: ui-radix).
  const backToGrid = useRef(false);
  useEffect(() => {
    const onFocusOut = (e: FocusEvent) => {
      if (!backToGrid.current || e.relatedTarget) return;
      window.setTimeout(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        backToGrid.current = false;
        document.querySelector<HTMLElement>(GRID)?.focus({ preventScroll: true });
      }, 0);
    };
    document.addEventListener("focusout", onFocusOut);
    return () => document.removeEventListener("focusout", onFocusOut);
  }, []);

  const selectedChip = useCallback((): EventChip | null => {
    const k = keysRef.current;
    return k.all.find((c) => c.occurrenceKey === k.selectedOccurrenceKey) ?? null;
  }, []);

  /** The selected event, when you may change it. */
  const editable = useCallback((): { chip: EventChip; event: CalendarEventModel } | null => {
    const k = keysRef.current;
    const chip = selectedChip();
    const event = chip ? k.eventsById.get(chip.eventId) : undefined;
    if (!chip || !event || chip.readOnly || !k.canEdit || !k.isWritable(event)) return null;
    return { chip, event };
  }, [selectedChip]);

  const moveCursor = (dir: CursorDir) => (e: KeyboardEvent) => {
    const k = keysRef.current;
    if (noTimeGrid(k.view) || !onTheGrid(e)) return false;
    if (!(e.target instanceof Element) || !e.target.closest(GRID)) {
      document.querySelector<HTMLElement>(GRID)?.focus();
    }
    const { cursor: next, period } = stepCursor(startCursor(), dir, k.dayKeys);
    if (period !== 0) {
      pendingPeriod.current = { period, minute: next.minute };
      k.step(period);
      k.select(null);
      return;
    }
    setCursor(next);
    k.select(chipAtCursor(next, k.timed)?.occurrenceKey ?? null);
  };

  const jump = (dir: 1 | -1) => (e: KeyboardEvent) => {
    const k = keysRef.current;
    if (noTimeGrid(k.view) || !onTheGrid(e)) return false;
    const chip = adjacentChip(
      k.all,
      { selectedKey: k.selectedOccurrenceKey, cursor: k.cursor },
      dir,
    );
    if (!chip) return;
    setCursor(cursorForChip(chip));
    k.select(chip.occurrenceKey);
  };

  const change = (what: KeyedChange) => (e: KeyboardEvent) => {
    if (noTimeGrid(keysRef.current.view) || !onTheGrid(e)) return false;
    const target = editable();
    if (!target) return;
    const { chip } = target;
    const deltas = keyedChange(chip, what);
    if (!deltas) return;
    const k = keysRef.current;
    k.onMoveEvent(chip.eventId, deltas, { startMs: chip.startMs, endMs: chip.endMs });
    // The moved occurrence keeps the selection (its key is its start).
    const startMs = chip.startMs + deltas.startDeltaMs;
    k.select(`${chip.eventId}:${startMs}`);
    if (deltas.startDeltaMs !== 0) {
      setCursor(cursorForChip({ dayKey: localDayKey(new Date(startMs)), startMs }));
    }
  };

  /** ⌘V's slot when no cursor is down: the next free time today. */
  const nextFree = (lengthMs: number): number => {
    const k = keysRef.current;
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const gap = findNextGap({
      nowMs: now.getTime(),
      dayStartMs: dayStart,
      workStartMinute: k.prefs.workStartMinute,
      workEndMinute: k.prefs.workEndMinute,
      durationMinutes: Math.max(15, Math.round(lengthMs / 60_000)),
      busy: k.timed.map((c) => ({ startMs: c.startMs, endMs: c.endMs })),
    });
    const step = 15 * 60_000;
    return gap ?? Math.ceil(now.getTime() / step) * step;
  };

  const create = (source: CalendarEventModel, startMs: number) => {
    const k = keysRef.current;
    const draft = copyDraft(source, startMs);
    // A copy of something you can't write to lands on Your calendar.
    k.createEvent({ ...draft, calendarId: k.isWritable(source) ? draft.calendarId : "moduo" });
  };

  // ⌘C and ⌘D on one occurrence; the event menus run these too (CALR-4b).
  const copyChip = (chip: EventChip) => {
    if (chip.eventId.startsWith("busy")) return;
    copied.current = chip.eventId;
    toast("Event copied", { description: chip.title || undefined });
  };
  const duplicateChip = (chip: EventChip) => {
    const k = keysRef.current;
    const source = k.eventsById.get(chip.eventId);
    if (source && k.canEdit) create(source, duplicateStartMs(chip));
  };

  useAppHotkeys({
    "calendar.today": (e) => (inCalendarOverlay(e) ? false : keysRef.current.goToday()),
    "calendar.day": (e) => (inCalendarOverlay(e) ? false : keysRef.current.setView("day")),
    "calendar.week": (e) => (inCalendarOverlay(e) ? false : keysRef.current.setView("week")),
    "calendar.month": (e) => (inCalendarOverlay(e) ? false : keysRef.current.setView("month")),
    "calendar.prev": (e) => (inCalendarOverlay(e) ? false : keysRef.current.step(-1)),
    "calendar.next": (e) => (inCalendarOverlay(e) ? false : keysRef.current.step(1)),
    "calendar.cursor-up": moveCursor("up"),
    "calendar.cursor-down": moveCursor("down"),
    "calendar.cursor-left": moveCursor("left"),
    "calendar.cursor-right": moveCursor("right"),
    "calendar.next-event": jump(1),
    "calendar.prev-event": jump(-1),
    "calendar.card": (e) => {
      if (noTimeGrid(keysRef.current.view) || !onTheGridItself(e)) return false;
      const chip = selectedChip();
      if (!chip) return false;
      const k = keysRef.current;
      // The Event panel already shows it: Space moves into the panel.
      if (k.panelVariant === "detail" && readFeaturePanelState("calendar").right) {
        const panel = document.querySelector('[data-panel-module="calendar"]');
        const first = panel?.querySelector<HTMLElement>(
          "input, button, a[href], [tabindex]:not([tabindex='-1'])",
        );
        if (first) {
          first.focus();
          return;
        }
      }
      const el = document.querySelector(
        `[data-occurrence-key="${CSS.escape(chip.occurrenceKey)}"]`,
      );
      if (!el) return false;
      backToGrid.current = true;
      k.onEventClick(chip, el.getBoundingClientRect());
    },
    "calendar.open": (e) => {
      if (noTimeGrid(keysRef.current.view) || !onTheGridItself(e)) return false;
      const k = keysRef.current;
      const chip = selectedChip();
      if (chip) {
        k.openDetail({ type: "event", id: chip.eventId });
        return;
      }
      if (!k.canEdit) return false;
      if (!k.cursor) setCursor(startCursor());
      backToGrid.current = true;
      dispatchCreateNew();
    },
    // CALR-9: N opens the composer, like ⌘N (at the cursor, else the next free time).
    "calendar.new": (e) => {
      if (inCalendarOverlay(e) || !keysRef.current.canEdit) return false;
      dispatchCreateNew();
    },
    "calendar.earlier": change("earlier"),
    "calendar.later": change("later"),
    "calendar.prev-day": change("prev-day"),
    "calendar.next-day": change("next-day"),
    "calendar.shorter": change("shorter"),
    "calendar.longer": change("longer"),
    // Destructive: never from a toolbar button or a panel row with a stale selection.
    "calendar.delete": (e) => {
      if (!onTheGrid(e)) return false;
      const target = editable();
      if (!target) return false;
      const k = keysRef.current;
      k.occurrence.requestEventDelete(
        target.event.id,
        k.occurrence.occurrenceStartOf(target.event, target.chip.occurrenceKey),
      );
    },
    "calendar.copy": (e) => {
      // Selected text copies as text.
      if (!onTheGrid(e) || window.getSelection()?.toString()) return false;
      const chip = selectedChip();
      if (!chip || chip.eventId.startsWith("busy")) return false;
      copyChip(chip);
    },
    "calendar.paste": (e) => {
      const k = keysRef.current;
      if (noTimeGrid(k.view) || !onTheGrid(e) || !copied.current || !k.canEdit) return false;
      const source = k.eventsById.get(copied.current);
      if (!source) {
        copied.current = null;
        toast.error("The copied event isn't here any more.");
        return;
      }
      const lengthMs = Date.parse(source.endsAt) - Date.parse(source.startsAt);
      create(source, k.cursor ? slotSpan(k.cursor).startMs : nextFree(lengthMs));
    },
    "calendar.duplicate": (e) => {
      const k = keysRef.current;
      if (!onTheGrid(e) || !k.canEdit) return false;
      const chip = selectedChip();
      if (!chip || !k.eventsById.has(chip.eventId)) return false;
      duplicateChip(chip);
    },
    "calendar.undo": (e) => (inCalendarOverlay(e) ? false : undoLast() ? undefined : false),
  });

  // A busy slot outlines its event instead of hiding the cursor.
  const shown = useMemo(
    () => (cursor ? { ...cursor, box: cursorBox(cursor, timed, selectedOccurrenceKey) } : null),
    [cursor, timed, selectedOccurrenceKey],
  );
  return { cursor: shown, copyChip, duplicateChip };
}
