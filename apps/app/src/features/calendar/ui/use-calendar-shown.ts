import { useCallback, useMemo } from "react";

import { resolveAccountHues, visibleEvents } from "../accounts";
import type { CalendarEventModel } from "../events";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import type { useCalendarPrefs } from "../hooks/use-calendar-prefs";
import { localDayKey } from "../lens";

type Prefs = ReturnType<typeof useCalendarPrefs>;
type DatedTask = { scheduledAt?: string | null; status: string };

/** Mini-month density dots cover every scheduled task and event day the
 *  bundles know: the dots inform navigation to days you can't see. */
export function busyDayKeysOf(
  tasks: readonly DatedTask[],
  events: readonly CalendarEventModel[],
): Set<string> {
  const keys = new Set<string>();
  const add = (iso: string) => {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) keys.add(localDayKey(d));
  };
  for (const t of tasks) if (t.scheduledAt && t.status !== "archived") add(t.scheduledAt);
  for (const e of events) add(e.startsAt);
  return keys;
}

/** Attribution: each account's bounded hue + the visibility filter (§3a). */
export function useCalendarShown(
  calendar: Pick<CalendarModuleApi, "accounts" | "events">,
  { prefs, updatePrefs }: Prefs,
  tasks: readonly DatedTask[],
) {
  const accountHues = useMemo(
    () => resolveAccountHues(calendar.accounts, prefs.accountColors),
    [calendar.accounts, prefs.accountColors],
  );
  const shownEvents = useMemo(
    () => visibleEvents(calendar.events, prefs.hiddenAccountIds),
    [calendar.events, prefs.hiddenAccountIds],
  );
  const toggleAccountVisibility = useCallback(
    (accountId: string) => {
      updatePrefs((prev) => {
        const hidden = new Set(prev.hiddenAccountIds);
        if (hidden.has(accountId)) hidden.delete(accountId);
        else hidden.add(accountId);
        return { hiddenAccountIds: [...hidden] };
      });
    },
    [updatePrefs],
  );
  const busyDayKeys = useMemo(() => busyDayKeysOf(tasks, shownEvents), [tasks, shownEvents]);
  return { accountHues, shownEvents, toggleAccountVisibility, busyDayKeys };
}
