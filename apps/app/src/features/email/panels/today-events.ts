// Today's calendar events for the mail Today panel (MR-14): the Calendar
// module's events, recurring series expanded, cut to the local day.

import { expandEventOccurrences } from "../../calendar/recurrence-expand";

export type TodayEvent = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
};

type SourceEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  rrule: string | null;
  exdates?: string[];
};

/** The local day containing `nowMs`, as `[start, end)`. */
export function localDayRange(nowMs: number): { startMs: number; endMs: number } {
  const d = new Date(nowMs);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return { startMs: start, endMs: end };
}

export function todayEvents(events: readonly SourceEvent[], nowMs: number): TodayEvent[] {
  const { startMs, endMs } = localDayRange(nowMs);
  return events
    .flatMap((e) =>
      expandEventOccurrences(e, startMs, endMs).map((o) => ({
        id: `${e.id}:${o.startMs}`,
        title: e.title || "(no title)",
        startMs: o.startMs,
        endMs: o.endMs,
        allDay: e.allDay,
      })),
    )
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs);
}
