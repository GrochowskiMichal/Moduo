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
  /** Where a first open goes (the role's first view, TV-U17); else the Inbox. */
  firstOpen?: string | null;
};

function reopenable(place: string | null | undefined, bucketIds: string[]): place is string {
  if (!place) return false;
  return (REOPENABLE_SCOPES as readonly string[]).includes(place) || bucketIds.includes(place);
}

/**
 * Where Tasks opens: where you left it, when that's still there (REPLAN 30);
 * a first open follows onboarding (the role's first view, TV-U17); else the
 * Inbox. A project that's gone, archived or out of reach falls back.
 */
export function resolveDefaultSelection({
  lastBucket,
  bucketIds,
  inboxId,
  firstOpen,
}: ResolveParams): string {
  // A first open has nothing remembered; a remembered place that's gone is
  // still not a first open.
  const place = reopenable(lastBucket, bucketIds)
    ? lastBucket
    : !lastBucket && reopenable(firstOpen, bucketIds)
      ? firstOpen
      : null;
  if (!place) return "inbox";
  return place === inboxId ? "inbox" : place;
}

// ── the place open in the centre (DF-1) ─────────────────────────────────────

/** The scopes the sidebar opens besides a project or a saved view. */
const FIXED_SCOPES = [
  ...REOPENABLE_SCOPES,
  "wontdo",
  "archived",
  "trash",
  "templates",
  "new-view",
] as const;

/**
 * Places you pass through but never land back on (REPLAN 30, MOD-142):
 * Won't do, Archived projects, Recently deleted, Templates, a new view
 * never saved, and an archived project's page. Neither remembered as where
 * you left Tasks nor reopened from the address bar.
 */
export function remembersPlace(place: string, archivedBucketIds: readonly string[]): boolean {
  if (!(FIXED_SCOPES as readonly string[]).includes(place)) {
    return !archivedBucketIds.includes(place);
  }
  return (REOPENABLE_SCOPES as readonly string[]).includes(place);
}

export type EntryPlaceInput = {
  /** The place the address bar holds (`?place=`), or null. */
  url: string | null;
  /**
   * The address bar still holds the place the page opened with (a refresh,
   * Back or Forward, a link): a place you only pass through doesn't reopen.
   */
  reopening: boolean;
  /** Where you left Tasks on this device, read once when the page opens. */
  lastBucket: string | null;
  /** A device left in the retired "Plan · Focus" switch's Focus mode (TV-F7). */
  legacyMode: boolean;
  /** Where a first open goes (the role's first view, TV-U17). */
  firstView: string | null;
  inboxId: string | null;
  /** Every live project id (not the Inbox's). */
  bucketIds: readonly string[];
  archivedBucketIds: readonly string[];
  /** Saved views' selections (`view:<id>`, TV-U8). */
  viewSelections: readonly string[];
  /** The bundle has loaded: until then the address bar and memory are trusted. */
  loaded: boolean;
  /** The server answered at least once: only then is a missing view gone. */
  reachedServer: boolean;
};

/**
 * The place the centre shows (DF-1). The address bar holds it, and wins over
 * where you left Tasks: a link (Home's Upcoming "+n more", a saved view) and
 * a place picked before the bundle answered both land there. Without one it's
 * where you left Tasks, a first open's onboarding view, else the Inbox
 * (`resolveDefaultSelection`). A project that's gone falls back to the Inbox;
 * while the bundle loads, nothing counts as gone.
 */
export function resolveEntryPlace(input: EntryPlaceInput): string {
  const { url, inboxId, bucketIds, archivedBucketIds, viewSelections, loaded } = input;
  const remembered = input.legacyMode ? "today" : input.lastBucket;
  const fallback = () =>
    loaded
      ? resolveDefaultSelection({
          lastBucket: remembered,
          bucketIds: [...(inboxId ? [inboxId] : []), ...bucketIds, ...viewSelections],
          inboxId,
          firstOpen: input.firstView,
        })
      : (remembered ?? "inbox");
  if (!url) return fallback();
  if (input.reopening && !remembersPlace(url, archivedBucketIds)) return fallback();
  // Gone: a view once the server answered, a project once the bundle has.
  const gone = () => (input.reopening ? fallback() : "inbox");
  if (url.startsWith("view:")) {
    return viewSelections.includes(url) || !input.reachedServer ? url : gone();
  }
  if ((FIXED_SCOPES as readonly string[]).includes(url) || !loaded) return url;
  if (url === inboxId || bucketIds.includes(url) || archivedBucketIds.includes(url)) return url;
  return gone();
}

// ── My tasks (tasks-v2 §1, TV-D4; in every workspace since TV-U15) ──────────

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
