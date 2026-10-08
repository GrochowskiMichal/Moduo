// The detail panel's "Comments & activity" feed (tasks-v2 §9): comments and the
// quiet activity trail in one list, oldest first, so the composer sits under the
// latest thing said or done. Creation leads it (it logs no activity row, module
// contract §3). Long histories fold their older items behind "Show N earlier".
// Pure.

import type { SpineComment } from "@/lib/runtime.types";
import { isTrailEntry } from "./activity";
import type { ActivityEntry, Task } from "./model";

export type FeedItem =
  | { kind: "created"; id: string; at: string; actorId: string | null }
  | { kind: "activity"; id: string; at: string; entry: ActivityEntry }
  | { kind: "comment"; id: string; at: string; comment: SpineComment };

/** How many of the latest items show before the rest fold away. */
export const FEED_VISIBLE = 8;

export function buildTaskFeed(input: {
  task: Pick<Task, "id" | "createdAt" | "creatorId" | "creatorUnknown">;
  activity: ActivityEntry[];
  comments: SpineComment[];
}): FeedItem[] {
  const { task, activity, comments } = input;
  const items: FeedItem[] = [
    ...activity
      .filter(isTrailEntry)
      .map((entry): FeedItem => ({ kind: "activity", id: entry.id, at: entry.createdAt, entry })),
    ...comments
      .filter((c) => !c.deletedAt)
      .map(
        (comment): FeedItem => ({
          kind: "comment",
          id: comment.id,
          at: comment.createdAt,
          comment,
        }),
      ),
  ];
  items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const created: FeedItem = {
    kind: "created",
    id: `created:${task.id}`,
    at: task.createdAt,
    actorId: task.creatorUnknown || !task.creatorId ? null : task.creatorId,
  };
  return [created, ...items];
}

/**
 * Fold a long feed: creation stays first, then "N earlier", then the latest
 * `visible` items. Nothing folds while `expanded`.
 */
export function foldFeed(
  items: FeedItem[],
  expanded: boolean,
  visible: number = FEED_VISIBLE,
): { lead: FeedItem[]; hidden: number; rest: FeedItem[] } {
  const [first, ...others] = items;
  const lead = first?.kind === "created" ? [first] : [];
  const body = first?.kind === "created" ? others : items;
  if (expanded || body.length <= visible + 1) return { lead, hidden: 0, rest: body };
  return { lead, hidden: body.length - visible, rest: body.slice(body.length - visible) };
}

const FEED_TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const FEED_DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const FEED_DAY_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** The feed's quiet time: "7:20 PM" today, "Oct 6" this year, "Oct 6, 2025" before. */
export function feedTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return FEED_TIME.format(d);
  }
  return d.getFullYear() === now.getFullYear() ? FEED_DAY.format(d) : FEED_DAY_YEAR.format(d);
}
