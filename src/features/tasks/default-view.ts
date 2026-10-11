// Default-view logic for the Tasks module.
//
// Tasks opens where you left it (REPLAN 30, TV-U6): the last sidebar place
// you had open (a project, the Inbox, Focus, Upcoming, My tasks or All), else
// the Inbox. The first open follows onboarding (TV-U17). "Open at" (a project
// per time of day) is retired from the sidebar; its data stays until TV-D7.
// The view (List / Board) restores to whatever was used last. Mode, selection
// and grouping are per-device view preferences in localStorage.

import { isBacklogTask, isOpenTask } from "@contracts/vocabularies";
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

/** The sidebar places Tasks can reopen besides a project (REPLAN 30). */
export const REOPENABLE_SCOPES = ["inbox", "today", "upcoming", "mine", "all"] as const;

type ResolveParams = {
  /** The sidebar place you had open last (a scope or a project id), or null. */
  lastBucket: string | null;
  /** Every live project id (the Inbox's too). */
  bucketIds: string[];
  inboxId: string | null;
};

/**
 * Where Tasks opens: where you left it, when that's still there, else the
 * Inbox (REPLAN 30). A project that's gone, archived or out of reach falls
 * back to the Inbox.
 */
export function resolveDefaultSelection({ lastBucket, bucketIds, inboxId }: ResolveParams): string {
  if (lastBucket && (REOPENABLE_SCOPES as readonly string[]).includes(lastBucket)) return lastBucket;
  if (lastBucket && new Set(bucketIds).has(lastBucket)) {
    return lastBucket === inboxId ? "inbox" : lastBucket;
  }
  return "inbox";
}

// ── My tasks (tasks-v2 §1, TV-D4) ────────────────────────────────────────────

/** The "My tasks" rail row exists only where there's someone else to tell apart. */
export function showsMyTasks(activeMemberCount: number): boolean {
  return activeMemberCount >= 2;
}

/**
 * The "My tasks" scope: tasks assigned to me, across buckets. Like All it
 * leaves Won't do tasks out and keeps done ones (TV-U1 hides completed tasks
 * everywhere by default); Backlog sits out too (TV-D9, REPLAN 53: the folded
 * "Backlog · n" line is TV-U15's).
 */
export function myTasksScope(tasks: Task[], userId: string | null): Task[] {
  if (!userId) return [];
  return tasks.filter(
    (t) => t.assigneeId === userId && t.status !== "archived" && !isBacklogTask(t),
  );
}

/** Open (To do / In progress) tasks in a list: a rail row's count. Backlog,
 *  Done and Won't do don't count. */
export function openCount(tasks: Task[]): number {
  return tasks.filter((t) => isOpenTask(t)).length;
}
