// The inbound `?event=` deep link (DF-2): a widget row / linked chip /
// notification opens a specific event — navigate to its series-anchor day,
// select + highlight the first occurrence there, and open its detail.

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { takeEntityOpenIntent } from "../../../lib/entity-open";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import { startOfLocalDay } from "../lens";
import { expandEventOccurrences } from "../recurrence-expand";
import { resolveCalendarDeepLink } from "../search";

type Input = {
  urlEventId: string | null;
  /** Called once the deep link has been applied (or found stale) so the page can clear the URL param. */
  onConsumeEventDeepLink?: () => void;
  calendar: CalendarModuleApi;
  goToDate: (day: Date) => void;
  openDetail: (target: { type: "event" | "task"; id: string }) => void;
  setSelectedOccurrenceKey: (key: string | null) => void;
};

export function useCalendarEventDeepLink({
  urlEventId,
  onConsumeEventDeepLink,
  calendar,
  goToDate,
  openDetail,
  setSelectedOccurrenceKey,
}: Input): void {
  const processedEventIdRef = useRef<string | null>(null);
  /** Which id we've already dropped the date window for (SCALE-1), once each. */
  const widenedForEventIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!urlEventId) {
      processedEventIdRef.current = null;
      widenedForEventIdRef.current = null;
      return;
    }
    if (processedEventIdRef.current === urlEventId) return;
    if (calendar.loading) return; // wait for events before ruling stale
    const target = resolveCalendarDeepLink(urlEventId, { events: calendar.events });
    if (target.kind === "none") {
      // The events read is windowed (SCALE-1), so "not in memory" does NOT
      // mean "deleted" — a link to a 2023 event simply hasn't been fetched.
      // Drop the window once and let the reload re-run this effect before
      // ruling the id stale; otherwise every pre-window deep link lies.
      // Only wait for a reload if dropping the window will ACTUALLY cause one.
      // `ensureAllTime` is a no-op once the window is already all-time (an
      // earlier deep link in this session), and returning here on that path
      // would strand the link: no toast, no consume, `?event=` stuck in the URL.
      if (!calendar.isAllTimeWindow && widenedForEventIdRef.current !== urlEventId) {
        widenedForEventIdRef.current = urlEventId;
        calendar.ensureAllTime();
        return;
      }
      processedEventIdRef.current = urlEventId;
      takeEntityOpenIntent(urlEventId); // spend the "take me there" mark
      toast("Couldn't find that event", {
        description: "It may have been deleted or isn't on this calendar.",
      });
      onConsumeEventDeepLink?.();
      return;
    }
    processedEventIdRef.current = urlEventId;
    takeEntityOpenIntent(urlEventId); // spend the "take me there" mark
    // For a recurring event, land on the nearest UPCOMING occurrence (a weekly
    // standup created months ago shouldn't teleport the user months back); a
    // one-off / ended series falls back to the series start. Using the same
    // expander the chips use means the occurrence key below matches a real chip.
    const event = calendar.events.find((e) => e.id === target.eventId);
    let occurrenceMs = new Date(target.startsAt).getTime();
    if (event?.rrule) {
      const todayMs = startOfLocalDay(new Date()).getTime();
      const yearAheadMs = todayMs + 366 * 24 * 60 * 60 * 1000;
      const next = expandEventOccurrences(event, todayMs, yearAheadMs)[0];
      if (next) occurrenceMs = next.startMs;
    }
    goToDate(new Date(occurrenceMs));
    setSelectedOccurrenceKey(`${target.eventId}:${occurrenceMs}`);
    openDetail({ type: "event", id: target.eventId });
    onConsumeEventDeepLink?.();
  }, [
    urlEventId,
    calendar.loading,
    calendar.events,
    calendar.ensureAllTime,
    calendar.isAllTimeWindow,
    goToDate,
    openDetail,
    onConsumeEventDeepLink,
  ]);
}
