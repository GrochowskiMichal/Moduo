// Today's local date as a key ("2026-10-10") that changes at local midnight,
// so anything worked out against "now" (the Date grouping, Filter → Due date
// "Today" / "This week") rolls over without a reload (TV-U2). Given a zone
// (Time & region's, MOD-110), it is that zone's day and changes at its
// midnight: what counts as "this month" for completions and tracked time.

import { useEffect, useState } from "react";

import { nextZonedMidnight, zonedDay } from "../../lib/zoned-time";
import { todayStr } from "./helpers";

function dayKey(zone: string | undefined): string {
  return zone ? zonedDay(new Date(), zone) : todayStr();
}

export function useToday(zone?: string): string {
  const [today, setToday] = useState(() => dayKey(zone));
  // A zone changed in Settings reads its own day at once.
  const [zoneOfToday, setZoneOfToday] = useState(zone);
  if (zoneOfToday !== zone) {
    setZoneOfToday(zone);
    setToday(dayKey(zone));
  }
  // Bumped when the timer fired before the day changed, to arm it again.
  const [rearm, setRearm] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `today` and `rearm` arm the timer for the next midnight
  useEffect(() => {
    const now = new Date();
    const midnight = zone
      ? nextZonedMidnight(now, zone)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // A second past midnight, so the new day is certainly here; a timer that
    // fires late (a sleeping laptop) still lands on the right day. One that
    // fires while it's still the same day (the clock was set back) waits for
    // the next midnight instead of stopping for good.
    const id = window.setTimeout(
      () => {
        const next = dayKey(zone);
        if (next === today) setRearm((n) => n + 1);
        else setToday(next);
      },
      midnight.getTime() - now.getTime() + 1000,
    );
    return () => window.clearTimeout(id);
  }, [today, zone, rearm]);
  return today;
}

/**
 * The current moment, read again whenever `today` changes: a memo that works
 * against "now" calls `nowOn(today)` and lists `today` as a dependency, so it
 * recomputes at midnight.
 */
export function nowOn(_today: string): Date {
  return new Date();
}

/**
 * A count that goes up once a minute while `active`, for words that age by
 * the minute ("5m", "3h": Detailed's Updated and the waiting lines). List it
 * as a dependency next to `today`; off, it stays put and costs nothing.
 */
export function useMinuteTick(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [active]);
  return tick;
}
