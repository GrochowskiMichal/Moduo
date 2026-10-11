// Today's local date as a key ("2026-10-10") that changes at local midnight,
// so anything worked out against "now" (the Date grouping, Filter → Due date
// "Today" / "This week") rolls over without a reload (TV-U2).

import { useEffect, useState } from "react";
import { todayStr } from "./helpers";

export function useToday(): string {
  const [today, setToday] = useState(() => todayStr());
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // A second past midnight, so the new day is certainly here; a timer that
    // fires late (a sleeping laptop) still lands on the right day.
    const id = window.setTimeout(
      () => setToday(todayStr()),
      midnight.getTime() - now.getTime() + 1000,
    );
    return () => window.clearTimeout(id);
  }, [today]);
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
