// The calendar's centre by view (CALR-12): Month draws the six-week month,
// Day and Week the time grid, and in Day each meeting gets its prep (people,
// notes, a follow-up, where) in the free width beside it. Kept out of the page
// so the page only names the view.

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { Task } from "../../tasks/model";
import { dayPrep } from "../day-prep";
import type { CalendarEventModel, EventChip } from "../events";
import { localDayKey } from "../lens";
import { CalendarGrid, type CalendarGridProps } from "./calendar-grid";
import { CalendarMonth } from "./calendar-month";
import { DayPrepAside } from "./day-prep";
import { useDayPrepLinks } from "./use-day-prep";

type Props = CalendarGridProps & {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  eventsById: ReadonlyMap<string, CalendarEventModel>;
  tasks: readonly Pick<Task, "id" | "status">[];
  /** Month's date or "N more": show that day. */
  onOpenDay: (day: Date) => void;
};

const NO_IDS: string[] = [];
const NO_DUE: ReadonlyMap<string, never[]> = new Map();

/** Now, a minute at a time (Month dims what has passed). */
function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function CalendarViews({
  runtime,
  workspaceId,
  eventsById,
  tasks,
  onOpenDay,
  ...grid
}: Props) {
  const now = useMinuteNow();
  // The page hands a fresh opener each render; the month's days keep one.
  const openDayRef = useRef(onOpenDay);
  useEffect(() => {
    openDayRef.current = onOpenDay;
  });
  const openDay = useCallback((day: Date) => openDayRef.current(day), []);
  const dayKey = grid.view === "day" && grid.days[0] ? localDayKey(grid.days[0]) : null;
  const dayChips = dayKey ? grid.eventsByDay.get(dayKey) : undefined;
  // Meetings, not focus time or holds.
  const meetingIds = useMemo(
    () =>
      dayChips
        ? dayChips
            .filter((c) => (eventsById.get(c.eventId)?.kind ?? "event") === "event")
            .map((c) => c.eventId)
        : NO_IDS,
    [dayChips, eventsById],
  );
  const doneIds = useMemo(
    () => new Set(tasks.filter((t) => t.status === "done").map((t) => t.id)),
    [tasks],
  );
  const isDone = useCallback((id: string) => doneIds.has(id), [doneIds]);
  const links = useDayPrepLinks(runtime, workspaceId, meetingIds, isDone);
  const prepFor = useCallback(
    (chip: EventChip): ReactNode => {
      const event = eventsById.get(chip.eventId);
      if (!event || (event.kind ?? "event") !== "event") return null;
      return <DayPrepAside prep={dayPrep(event, links.get(chip.eventId) ?? null)} />;
    },
    [eventsById, links],
  );

  if (grid.view === "month") {
    return (
      <CalendarMonth
        days={grid.days}
        now={now}
        eventsByDay={grid.eventsByDay}
        allDayByDay={grid.allDayByDay}
        blocksByDay={grid.blocksByDay}
        dueByDay={grid.dueByDay ?? NO_DUE}
        accountHues={grid.accountHues}
        selectedOccurrenceKey={grid.selectedOccurrenceKey}
        onSelectOccurrence={grid.onSelectOccurrence}
        onEventClick={grid.onEventClick}
        onTaskClick={grid.onTaskClick}
        onOpenDay={openDay}
        onDueClick={grid.onDueClick}
        onScheduleDue={grid.onScheduleDue}
        staleAccountIds={grid.staleAccountIds}
      />
    );
  }
  return <CalendarGrid {...grid} prepFor={grid.view === "day" ? prepFor : undefined} />;
}
