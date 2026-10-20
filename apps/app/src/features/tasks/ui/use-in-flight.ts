// What's in flight for me (Tasks v3 TV-F8), read the same way by Focus (its
// "2 in flight" line, and Up next leaving waiting tasks out) and by the
// panel's In flight view. Check-backs come due by the clock, so it looks
// again each minute while anything is in flight.

import { useMemo } from "react";

import { type InFlightItem, inFlightItems, waitingTaskIds } from "../focus-screen";
import { useTasksSelector, useTasksUserId } from "../tasks-context";
import { useMinuteTick } from "../use-today";

const NO_ITEMS: readonly never[] = [];

export type InFlight = {
  items: InFlightItem[];
  /** Tasks that wait on anything: lined up, they sit in In flight, not Up next. */
  waitingIds: ReadonlySet<string>;
  /** Cards that need me now (a check-back due, my agent needs me or is done). */
  attention: number;
};

export function useInFlight(): InFlight {
  const tasks = useTasksSelector((d) => d.liveTasks);
  const queuedTaskIds = useTasksSelector((d) => d.queuedTaskIds);
  const me = useTasksUserId();
  const waiting = useTasksSelector((_, snap) => snap.waiting) ?? NO_ITEMS;
  const reminders = useTasksSelector((_, snap) => snap.reminders) ?? NO_ITEMS;
  const agentSessions = useTasksSelector((_, snap) => snap.agentSessions) ?? NO_ITEMS;
  const waitingIds = useMemo(() => waitingTaskIds(waiting), [waiting]);
  const active = waiting.length > 0 || agentSessions.length > 0;
  const tick = useMinuteTick(active);
  const items = useMemo(() => {
    void tick;
    if (!active) return [];
    return inFlightItems({
      tasks,
      waiting,
      reminders,
      agentSessions,
      lineup: queuedTaskIds,
      me,
      nowMs: Date.now(),
    });
  }, [active, tasks, waiting, reminders, agentSessions, queuedTaskIds, me, tick]);
  const attention = useMemo(() => items.filter((i) => i.attention).length, [items]);
  return { items, waitingIds, attention };
}
