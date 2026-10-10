// The strip (CAL-4, AC9) — "N unfinished from earlier". Open task blocks whose
// scheduled time passed within the look-back window (earlier today + the
// previous 7 days). This is the SAME drift the Tasks module surfaces (spec
// assumption 1: the strip = the existing drift computation), shown here as one
// quiet line above the grid. Older-than-window items quietly drop off — the
// task always survives in Tasks. Events are never candidates (only tasks pass).

import { isOpenTaskStatus } from "@contracts/vocabularies";
import { addDays, DEFAULT_BLOCK_MINUTES, type LensTask } from "./lens";

/** How far back the strip looks (today + the previous 7 days). */
export const STRIP_LOOKBACK_DAYS = 7;

/** One row of the strip / its Review sub-state. */
export type StripItem = {
  taskId: string;
  title: string;
  /** Original scheduled instant (ms) — the roll-forward's "from". */
  scheduledAtMs: number;
  durationMinutes: number;
};

function blockDuration(t: LensTask): number {
  return t.durationMinutes && t.durationMinutes > 0 ? t.durationMinutes : DEFAULT_BLOCK_MINUTES;
}

function isOpen(t: LensTask): boolean {
  return !t.deletedAt && isOpenTaskStatus(t.status);
}

/**
 * The strip rows: open tasks whose block END passed and whose scheduled day is
 * within the look-back window, in original (scheduled-ascending) order.
 * `excludeIds` drops session-acknowledged blocks (e.g. a "took longer" chip)
 * so a triaged block doesn't re-count while the page is open.
 */
export function stripItems(
  tasks: LensTask[],
  nowMs: number,
  excludeIds?: ReadonlySet<string>,
): StripItem[] {
  // Local midnight `STRIP_LOOKBACK_DAYS` ago — anything scheduled before it
  // silently drops off the strip (DST-safe day math).
  const floorMs = addDays(new Date(nowMs), -STRIP_LOOKBACK_DAYS).getTime();
  const out: StripItem[] = [];
  for (const t of tasks) {
    if (!isOpen(t)) continue;
    if (!t.scheduledAt) continue;
    if (excludeIds?.has(t.id)) continue;
    const startMs = new Date(t.scheduledAt).getTime();
    if (Number.isNaN(startMs)) continue;
    if (startMs < floorMs) continue;
    const durationMinutes = blockDuration(t);
    const endMs = startMs + durationMinutes * 60_000;
    if (endMs > nowMs) continue; // not yet elapsed — not unfinished-from-earlier
    out.push({ taskId: t.id, title: t.title, scheduledAtMs: startMs, durationMinutes });
  }
  return out.sort((a, b) => a.scheduledAtMs - b.scheduledAtMs || a.taskId.localeCompare(b.taskId));
}
