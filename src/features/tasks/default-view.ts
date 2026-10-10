// Default-view logic for the Tasks module (spec §9).
//
// On opening Tasks we never drop the user into the full cross-bucket list.
// Instead we resolve, in order:
//   1. the bucket mapped to the current time-of-day block (if any time-blocks
//      are defined for this workspace), then
//   2. the last-opened bucket, then
//   3. the Inbox.
// The view (List / Board) restores to whatever was used last.
//
// Time-blocks are a quiet, opt-in planning aid: a user assigns a bucket to a
// slot via that bucket's "…" menu in the rail. At most one bucket per slot.
// No editor surface beyond that menu — the feature stays invisible until used.
//
// Time-blocks are workspace data (the `task_time_blocks` table, loaded through
// `runtime.tasks.getTimeBlocks` alongside the bundle). The rest of the state
// here — mode / selection / grouping — is a per-device view preference and
// stays in localStorage.

import { isOpenTaskStatus } from "@contracts/vocabularies";
import { type Task, TIME_BLOCK_SLOTS, type TimeBlockMap, type TimeBlockSlot } from "./model";

export { TIME_BLOCK_SLOTS, type TimeBlockMap, type TimeBlockSlot };

export const TIME_BLOCK_LABELS: Record<TimeBlockSlot, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

/** Hour ranges per slot (local time). Evening wraps midnight so coverage is total. */
export function currentTimeBlockSlot(now: Date = new Date()): TimeBlockSlot {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  return "evening"; // 18:00–04:59
}

/**
 * Assign `bucketId` to `slot` (evicting any prior holder of that slot), or pass
 * `slot = null` to clear whatever slot `bucketId` currently holds. Pure — returns
 * the next map; the caller persists it.
 */
export function setBucketTimeBlock(
  map: TimeBlockMap,
  bucketId: string,
  slot: TimeBlockSlot | null,
): TimeBlockMap {
  const next: TimeBlockMap = {};
  // Drop this bucket from every slot first (a bucket can't hold two slots).
  for (const s of TIME_BLOCK_SLOTS) {
    if (map[s] && map[s] !== bucketId) next[s] = map[s];
  }
  if (slot) next[slot] = bucketId;
  return next;
}

/** Invert the slot→bucket map to bucket→slot for per-row rendering. */
export function timeBlockByBucket(map: TimeBlockMap): Map<string, TimeBlockSlot> {
  const out = new Map<string, TimeBlockSlot>();
  for (const slot of TIME_BLOCK_SLOTS) {
    const id = map[slot];
    if (id) out.set(id, slot);
  }
  return out;
}

type ResolveParams = {
  now?: Date;
  timeBlocks: TimeBlockMap;
  /** "inbox" | bucketId from a prior session, or null. */
  lastBucket: string | null;
  /** Every live bucket id (user buckets + Inbox). */
  bucketIds: string[];
  inboxId: string | null;
};

/**
 * Resolve which selection to open Tasks on. Returns "inbox" or a concrete
 * bucketId — never "all" / "today" (spec §9.4: never the full list first).
 */
export function resolveDefaultSelection({
  now = new Date(),
  timeBlocks,
  lastBucket,
  bucketIds,
  inboxId,
}: ResolveParams): string {
  const known = new Set(bucketIds);

  // 1. Time-block mapped bucket for the current slot (if it still exists).
  const slotBucket = timeBlocks[currentTimeBlockSlot(now)];
  if (slotBucket && known.has(slotBucket)) {
    return slotBucket === inboxId ? "inbox" : slotBucket;
  }

  // 2. Last-opened bucket (if it still exists). "inbox" is always valid.
  if (lastBucket === "inbox") return "inbox";
  if (lastBucket && known.has(lastBucket)) {
    return lastBucket === inboxId ? "inbox" : lastBucket;
  }

  // 3. Fallback.
  return "inbox";
}

// ── My tasks (tasks-v2 §1, TV-D4) ────────────────────────────────────────────

/** The "My tasks" rail row exists only where there's someone else to tell apart. */
export function showsMyTasks(activeMemberCount: number): boolean {
  return activeMemberCount >= 2;
}

/**
 * The "My tasks" scope: tasks assigned to me, across buckets. Like All it
 * leaves archived tasks out and keeps done ones (TV-U1 hides completed tasks
 * everywhere by default).
 */
export function myTasksScope(tasks: Task[], userId: string | null): Task[] {
  if (!userId) return [];
  return tasks.filter((t) => t.assigneeId === userId && t.status !== "archived");
}

/** Open (not done, not archived) tasks in a list: a rail row's count. */
export function openCount(tasks: Task[]): number {
  return tasks.filter((t) => isOpenTaskStatus(t.status)).length;
}
