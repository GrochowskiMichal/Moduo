// Per-task counts and stamps for the task rows' marks (files, comments), from
// the synced attachment and comment rows. Split out of store.ts.

import type { SyncRows } from "./types";

/**
 * Finished files per task, and each task's file stamp: its newest file change
 * plus the live count (a delete that drops the row moves it). A file still
 * uploading (a Realtime row before it's finished) never counts.
 */
export function countAttachments(files: readonly SyncRows["attachments"][]): {
  counts: ReadonlyMap<string, number>;
  stamps: ReadonlyMap<string, string>;
} {
  const counts = new Map<string, number>();
  const newest = new Map<string, string>();
  for (const f of files) {
    if (f.status !== "ready") continue;
    const seen = newest.get(f.taskId);
    if (!seen || f.updatedAt > seen) newest.set(f.taskId, f.updatedAt);
    if (f.deletedAt) continue;
    counts.set(f.taskId, (counts.get(f.taskId) ?? 0) + 1);
  }
  const stamps = new Map<string, string>();
  for (const [taskId, at] of newest) stamps.set(taskId, `${at}#${counts.get(taskId) ?? 0}`);
  return { counts, stamps };
}

/** Live comments per task, and each task's comment stamp: its newest
 *  comment change plus the live count (a delete that drops the row moves it). */
export function countComments(comments: readonly SyncRows["comments"][]): {
  counts: ReadonlyMap<string, number>;
  stamps: ReadonlyMap<string, string>;
} {
  const counts = new Map<string, number>();
  const newest = new Map<string, string>();
  for (const c of comments) {
    const seen = newest.get(c.taskId);
    if (!seen || c.updatedAt > seen) newest.set(c.taskId, c.updatedAt);
    if (c.deletedAt) continue;
    counts.set(c.taskId, (counts.get(c.taskId) ?? 0) + 1);
  }
  const stamps = new Map<string, string>();
  for (const [taskId, at] of newest) stamps.set(taskId, `${at}#${counts.get(taskId) ?? 0}`);
  return { counts, stamps };
}
