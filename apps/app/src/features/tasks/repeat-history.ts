// A repeat's cycle history in the detail panel (TV-D12's `tasks_op_history`,
// TV-U13b): the Repeat row's quiet "4 done · last Oct 10", and one line per
// cycle, newest first. Each person sees only their own time in a cycle. Pure.

import { formatDay } from "../../lib/time-format";
import type { TaskCompletion, TaskCycle } from "./model";
import { formatTracked } from "./time-format";

/** "4 done · last Oct 10" from the store's completions; "History" with none yet. */
export function historySummary(
  completions: readonly Pick<TaskCompletion, "taskId" | "completedAt" | "deletedAt">[],
  taskId: string,
  now: Date = new Date(),
): string {
  let count = 0;
  let last: string | null = null;
  for (const c of completions) {
    if (c.taskId !== taskId || c.deletedAt) continue;
    count += 1;
    if (last === null || c.completedAt > last) last = c.completedAt;
  }
  if (count === 0 || !last) return "History";
  return `${count} done · last ${formatDay(last, now)}`;
}

/** The day a cycle was for: its occurrence when the key is one, else when it closed. */
function cycleDay(cycle: Pick<TaskCycle, "cycle" | "at">): string {
  const key = cycle.cycle;
  if (key && key !== "once" && !Number.isNaN(Date.parse(key))) return key;
  return cycle.at;
}

/**
 * One cycle as its line reads: "Oct 6 · Done by Mike · your time 25m",
 * "Oct 13 · Skipped by you". `nameOf` gives a member's first name, or null.
 */
export function cycleLine(
  cycle: TaskCycle,
  me: string | null,
  nameOf: (userId: string) => string | null,
  now: Date = new Date(),
): { day: string; what: string; mine: string | null } {
  const verb = cycle.kind === "done" ? "Done" : "Skipped";
  const who = !cycle.by ? null : cycle.by === me ? "you" : nameOf(cycle.by);
  return {
    day: formatDay(cycleDay(cycle), now),
    what: who ? `${verb} by ${who}` : verb,
    mine: cycle.mySeconds > 0 ? `your time ${formatTracked(cycle.mySeconds)}` : null,
  };
}
