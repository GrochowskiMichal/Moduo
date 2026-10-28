// The mini-month's density dots: every day the loaded tasks and events touch
// with a scheduled task or an event start. The dots inform navigation to days
// you can't see, so they cover the whole bundle, not the visible range.

import type { Task } from "../tasks/model";
import type { CalendarEventModel } from "./events";
import { localDayKey } from "./lens";

export function busyDayKeysOf(
  tasks: readonly Pick<Task, "scheduledAt" | "status">[],
  events: readonly Pick<CalendarEventModel, "startsAt">[],
): Set<string> {
  const keys = new Set<string>();
  for (const t of tasks) {
    if (!t.scheduledAt || t.status === "archived") continue;
    const d = new Date(t.scheduledAt);
    if (!Number.isNaN(d.getTime())) keys.add(localDayKey(d));
  }
  for (const e of events) {
    const d = new Date(e.startsAt);
    if (!Number.isNaN(d.getTime())) keys.add(localDayKey(d));
  }
  return keys;
}
