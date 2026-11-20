// The selected task's "waits on" lines whose other end isn't drawn (70, 68b):
// the words shown as stubs on its row, before (it waits on) and after (it blocks).

import type { Task, TaskRelation } from "../model";
import type { DepStub } from "./timeline-deps-layer";
import type { RowStubs } from "./timeline-row";

type Input = {
  self: Task;
  relations: readonly TaskRelation[];
  taskById: ReadonlyMap<string, Task>;
  /** Where a task's point is on the canvas (null: it has none, or no row). */
  pointDay: (id: string) => number | null;
  isHidden: (task: Task) => boolean;
  projectName: (bucketId: string) => string;
};

export function depStubsFor({
  self,
  relations,
  taskById,
  pointDay,
  isHidden,
  projectName,
}: Input): RowStubs | null {
  const words = (other: Task) => {
    const title = other.title || "Untitled";
    if (!other.dueOn && !other.dueDate && !other.scheduledAt) return `${title} · no date`;
    if (other.bucketId !== self.bucketId) return `↗ ${projectName(other.bucketId)} · ${title}`;
    return `↗ ${title}`;
  };
  const before: DepStub[] = [];
  const after: DepStub[] = [];
  const seen = new Set<string>();
  for (const rel of relations) {
    const waitsOn = rel.blockedTaskId === self.id;
    const blocks = rel.blockerTaskId === self.id;
    if (!waitsOn && !blocks) continue;
    const other = taskById.get(waitsOn ? rel.blockerTaskId : rel.blockedTaskId);
    if (!other || other.deletedAt || isHidden(other) || pointDay(other.id) !== null) continue;
    const id = `${waitsOn ? "before" : "after"}:${other.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    (waitsOn ? before : after).push({ id, text: words(other) });
  }
  return before.length + after.length > 0 ? { before, after } : null;
}
