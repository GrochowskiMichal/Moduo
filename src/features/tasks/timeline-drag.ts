// Pure drop-resolution for the Timeline view's drags (specs/tasks-timeline.md
// TL-2, AC5/AC6). The pointer engines in the view translate gestures into a
// (mode, deltaDays, pointerDay) triple; this module maps that to the exact
// `patchTask` args — or `null` for a no-op — so the write path is unit-testable
// without a DOM. All date math delegates to the tested timeline-geometry
// helpers (whole-day snapping, clock-time preservation, 1-day clamps).

import { wouldCreateCycle } from "./helpers";
import type { Task, TaskRelation } from "./model";
import { setBarEdge, shiftTaskDates } from "./timeline-geometry";

/** What part of a bar a pointer drag grabbed. */
export type BarDragMode = "move" | "start" | "end";

export type TimelineDatePatch = Partial<Pick<Task, "scheduledAt" | "dueDate">>;

function isNoop(task: Pick<Task, "scheduledAt" | "dueDate">, patch: TimelineDatePatch): boolean {
  return (
    (patch.scheduledAt === undefined || patch.scheduledAt === task.scheduledAt) &&
    (patch.dueDate === undefined || patch.dueDate === task.dueDate)
  );
}

/**
 * Resolve a bar drag to its mutation args, or null when nothing would change.
 * - `move` shifts every known date by whole days, preserving clock time.
 * - `start`/`end` put that edge on the pointer's day — adjusting a solid edge,
 *   or *setting* a faded one (the bar solidifies). Spans clamp at 1 day and
 *   never invert (the moved edge yields).
 */
export function resolveBarDrag(
  task: Pick<Task, "scheduledAt" | "dueDate">,
  mode: BarDragMode,
  gesture: { deltaDays: number; pointerDay: Date },
): TimelineDatePatch | null {
  const patch =
    mode === "move"
      ? gesture.deltaDays === 0
        ? {}
        : shiftTaskDates(task, gesture.deltaDays)
      : setBarEdge(task, mode, gesture.pointerDay);
  if (Object.keys(patch).length === 0 || isNoop(task, patch)) return null;
  return patch;
}

/**
 * Resolve a tray-chip drop onto a day: sets `scheduledAt` on that day (09:00
 * local — scheduling implies a morning anchor). A due date is deliberately NOT
 * set: schedule ≠ deadline (the designer's call, spec §Assumptions).
 */
export function resolveTrayDrop(
  task: Pick<Task, "scheduledAt" | "dueDate">,
  day: Date,
): TimelineDatePatch | null {
  const patch = setBarEdge(task, "start", day);
  return isNoop(task, patch) ? null : patch;
}

/**
 * Resolve a connector-dot drop (AC8): the dot on the BLOCKER bar's end
 * dragged onto the bar of the task it blocks. Self, existing-edge, and
 * would-be-cycle targets resolve to null — all silent no-ops (mid-gesture is
 * no place for an error modal), and the same nulls drive the "is this a valid
 * target" highlight while the drag is in flight.
 */
export function resolveConnectorDrop(
  blockerId: string,
  targetId: string | null,
  relations: TaskRelation[],
): { blockedTaskId: string; blockerTaskId: string } | null {
  if (!targetId || targetId === blockerId) return null;
  const exists = relations.some(
    (r) => r.blockerTaskId === blockerId && r.blockedTaskId === targetId,
  );
  if (exists) return null;
  if (wouldCreateCycle(blockerId, targetId, relations)) return null;
  return { blockerTaskId: blockerId, blockedTaskId: targetId };
}
