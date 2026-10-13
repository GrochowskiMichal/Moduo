// A drag of several selected tasks (TV-U4's "drag of a multi-selection",
// TV-U12). Pure. The drop is planned for the task you hold, as always; this
// copies its change to the rest of the selection — the same fields, and
// places right behind the held one (in the view's order) when the drop sets a
// place — so the whole selection saves as one write with one Undo
// (`useBulkOps.bulkWrite`).

import type { BulkWrite } from "../bulk";
import { endPositions, positionsAfter, tasksWord } from "../bulk";
import type { Task } from "../model";
import { STATUS_KEY_LABELS, statusKeyOf } from "../statuses";
import type { DropNames, TaskDropWrite } from "./drop-write";

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * Every selected task's write for a drop planned on `held`. `ids` is the
 * selection in the view's order (the held task among them). A task the drop
 * can't take is left out: it can't nest under itself or a subtask of its own,
 * and a parent stays a parent (one level of subtasks). Fields a task already
 * has are dropped; a task left with nothing to change is skipped.
 */
export function multiDropWrites(
  write: TaskDropWrite,
  held: Task,
  ids: readonly string[],
  allByPosition: readonly Task[],
): BulkWrite[] {
  const byId = new Map(allByPosition.map((t) => [t.id, t]));
  const chosen = ids.map((id) => byId.get(id)).filter((t): t is Task => !!t);
  if (!chosen.some((t) => t.id === held.id)) chosen.unshift(held);
  const hasChildren = new Set(allByPosition.flatMap((t) => (t.parentId ? [t.parentId] : [])));
  const moving = new Set(chosen.map((t) => t.id));
  const fits = chosen.filter((t) => {
    if (t.id === held.id) return true;
    if (write.parentId) {
      if (t.id === write.parentId || hasChildren.has(t.id)) return false;
      if (byId.get(write.parentId)?.parentId === t.id) return false;
    }
    return true;
  });
  // A place: the held task's, then the rest right behind it. A move into
  // another project without one: the project's end, in order.
  const rest = fits.filter((t) => t.id !== held.id);
  const places =
    write.position !== undefined
      ? positionsAfter(write.position, rest.length, allByPosition, moving)
      : null;
  const endPlaces =
    write.position === undefined && write.bucketId !== undefined
      ? endPositions(fits.length, write.bucketId, allByPosition, moving)
      : null;
  const out: BulkWrite[] = [];
  fits.forEach((t, i) => {
    const w: BulkWrite = { taskId: t.id };
    if (write.parentId !== undefined && !same(t.parentId, write.parentId))
      w.parentId = write.parentId;
    if (write.bucketId !== undefined && t.bucketId !== write.bucketId) {
      w.bucketId = write.bucketId;
      // A subtask leaves a parent that stays behind in another project.
      const parent = t.parentId ? byId.get(t.parentId) : null;
      if (
        w.parentId === undefined &&
        parent &&
        !moving.has(parent.id) &&
        parent.bucketId !== write.bucketId
      ) {
        w.parentId = null;
      }
    }
    if (write.priority !== undefined && !same(t.priority, write.priority))
      w.priority = write.priority;
    if (write.sectionId !== undefined && !same(t.sectionId, write.sectionId)) {
      w.sectionId = write.sectionId;
    }
    if (write.teamId !== undefined && !same(t.teamId, write.teamId)) w.teamId = write.teamId;
    if (write.assigneeId !== undefined && !same(t.assigneeId || null, write.assigneeId)) {
      w.assigneeId = write.assigneeId;
    }
    if (write.status !== undefined) {
      const exact = write.statusId ?? null;
      if (statusKeyOf(t) !== write.status || (exact !== null && t.statusId !== exact)) {
        w.status = write.status;
        // A named status goes by id only into its own project (a Board column).
        if (write.statusId && (w.bucketId ?? t.bucketId) === held.bucketId) {
          w.statusId = write.statusId;
        }
      }
    }
    if (t.id === held.id) {
      if (write.position !== undefined) w.position = write.position;
      else if (endPlaces && w.bucketId) w.position = endPlaces[i];
    } else if (places) {
      w.position = places[rest.indexOf(t)];
    } else if (endPlaces && w.bucketId) {
      w.position = endPlaces[i];
    }
    if (Object.keys(w).length > 1) out.push(w);
  });
  return out;
}

/** What the toast says for several ("Moved 4 tasks to Website"), in a drop's grammar. */
export function multiDropLabel(write: TaskDropWrite, n: number, names: DropNames): string {
  const many = tasksWord(n);
  if (write.parentId) return `Moved ${many} under “${names.taskTitle(write.parentId)}”`;
  if (write.bucketId !== undefined) return `Moved ${many} to ${names.bucketName(write.bucketId)}`;
  if (write.status !== undefined) return `Moved ${many} to ${STATUS_KEY_LABELS[write.status]}`;
  if (write.assigneeId !== undefined) {
    return write.assigneeId
      ? `Assigned ${many} to ${names.assigneeName(write.assigneeId)}`
      : `Unassigned ${many}`;
  }
  if (write.sectionId !== undefined) {
    return `Moved ${many} to ${names.sectionName?.(write.sectionId) ?? "a section"}`;
  }
  if (write.teamId !== undefined) {
    return write.teamId
      ? `Routed ${many} to ${names.teamName?.(write.teamId) ?? "a team"}`
      : `Cleared the team of ${many}`;
  }
  if (write.parentId === null) return `Moved ${many} out of their parents`;
  return `Moved ${many}`;
}

/** A Board drop's own words for several: "Moved to In progress · 4 tasks". */
export function manyLabel(label: string, n: number): string {
  return n === 1 ? label : `${label} · ${tasksWord(n)}`;
}
