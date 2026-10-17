// What's in flight for me (Tasks v3 TV-F8), read the same way by Focus (its
// "2 in flight" line, and Up next leaving waiting tasks out) and by the
// panel's In flight view. Check-backs come due by the clock, so it looks
// again each minute while anything is in flight.

import { useMemo } from "react";

import { type InFlightItem, inFlightItems, waitingTaskIds } from "../focus-screen";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { useMinuteTick } from "../use-today";

const NO_ITEMS: readonly never[] = [];

export type InFlight = {
  items: InFlightItem[];
  /** Tasks that wait on anything: lined up, they sit in In flight, not Up next. */
  waitingIds: ReadonlySet<string>;
  /** Cards that need me now (a check-back due, my agent needs me or is done). */
  attention: number;
};

type InFlightApi = Pick<
  TasksModuleApi,
  "tasks" | "waiting" | "reminders" | "agentSessions" | "queuedTaskIds" | "currentUserId"
>;

export function useInFlight(api: InFlightApi): InFlight {
  const waiting = api.waiting ?? NO_ITEMS;
  const reminders = api.reminders ?? NO_ITEMS;
  const agentSessions = api.agentSessions ?? NO_ITEMS;
  const waitingIds = useMemo(() => waitingTaskIds(waiting), [waiting]);
  const active = waiting.length > 0 || agentSessions.length > 0;
  const tick = useMinuteTick(active);
  const items = useMemo(() => {
    void tick;
    if (!active) return [];
    return inFlightItems({
      tasks: api.tasks,
      waiting,
      reminders,
      agentSessions,
      lineup: api.queuedTaskIds,
      me: api.currentUserId,
      nowMs: Date.now(),
    });
  }, [
    active,
    api.tasks,
    waiting,
    reminders,
    agentSessions,
    api.queuedTaskIds,
    api.currentUserId,
    tick,
  ]);
  const attention = useMemo(() => items.filter((i) => i.attention).length, [items]);
  return { items, waitingIds, attention };
}
