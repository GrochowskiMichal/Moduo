// Recently deleted (TV-U6, REPLAN 78 + 98): what the list shows. Pure.
//
// A project is one entry with the finished tasks deleted with it (they share
// its batch and come back with it); the open ones its delete sent to Inboxes
// are counted on it. Everything else deleted on its own is an entry of its
// own. Entries leave the list when their 30 days are up (the daily purge then
// removes them, files included).

import type { LabelColor } from "../../components/tag-colors";
import { type TasksTrash, TRASH_DAYS } from "./model";
import { bucketDotColor } from "./sidebar";

const DAY_MS = 86_400_000;

export type TrashEntry =
  | {
      kind: "bucket";
      id: string;
      name: string;
      color: LabelColor;
      deletedAt: string;
      /** Finished tasks deleted together with it (they come back with a Restore). */
      deletedTasks: number;
      /** Open tasks its delete sent to Inboxes (a Restore takes back the untouched ones). */
      movedTasks: number;
    }
  | {
      kind: "task";
      id: string;
      title: string;
      deletedAt: string;
      /** The project it was in, when it still has a name to show. */
      bucketName: string | null;
    };

/** Whole days left before the purge; 0 on the last day. */
export function trashDaysLeft(deletedAt: string, now: Date = new Date()): number {
  const left = new Date(deletedAt).getTime() + TRASH_DAYS * DAY_MS - now.getTime();
  return Math.max(0, Math.floor(left / DAY_MS));
}

/** "Deleted today" / "Deleted yesterday" / "Deleted 3 days ago". */
export function trashAgeLabel(deletedAt: string, now: Date = new Date()): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(new Date(deletedAt))) / DAY_MS);
  if (days <= 0) return "Deleted today";
  if (days === 1) return "Deleted yesterday";
  return `Deleted ${days} days ago`;
}

/**
 * The list, newest first. `bucketName` names a live bucket (a task deleted on
 * its own shows where it was); deleted buckets name themselves.
 */
export function trashEntries(
  trash: TasksTrash | null,
  opts: { bucketName: (id: string) => string | null; now?: Date },
): TrashEntry[] {
  if (!trash) return [];
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - TRASH_DAYS * DAY_MS;
  const fresh = (iso: string | null): iso is string => !!iso && new Date(iso).getTime() > cutoff;

  const batches = new Map<string, number>();
  const deletedNames = new Map<string, string>();
  for (const b of trash.buckets) {
    if (b.batchId) batches.set(b.batchId, 0);
    deletedNames.set(b.bucket.id, b.bucket.name);
  }
  const entries: TrashEntry[] = [];
  for (const { task, batchId } of trash.tasks) {
    if (!fresh(task.deletedAt)) continue;
    if (batchId && batches.has(batchId)) {
      batches.set(batchId, (batches.get(batchId) ?? 0) + 1);
      continue;
    }
    entries.push({
      kind: "task",
      id: task.id,
      title: task.title.trim() || "Untitled",
      deletedAt: task.deletedAt,
      bucketName: opts.bucketName(task.bucketId) ?? deletedNames.get(task.bucketId) ?? null,
    });
  }
  for (const { bucket, batchId, movedTaskIds } of trash.buckets) {
    if (!fresh(bucket.deletedAt)) continue;
    entries.push({
      kind: "bucket",
      id: bucket.id,
      name: bucket.name,
      color: bucketDotColor(bucket),
      deletedAt: bucket.deletedAt,
      deletedTasks: batchId ? (batches.get(batchId) ?? 0) : 0,
      movedTasks: movedTaskIds.length,
    });
  }
  return entries.sort(
    (a, b) =>
      new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime() ||
      (a.kind === "bucket" ? a.name : a.title).localeCompare(
        b.kind === "bucket" ? b.name : b.title,
      ),
  );
}
