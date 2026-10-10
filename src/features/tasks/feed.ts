// The detail panel's "Comments & activity" feed (tasks-v2 §9): comments and the
// quiet activity trail in one list, oldest first, so the composer sits under the
// latest thing said or done. Creation leads it: the `tasks.create` row since
// TV-D8 (it names who, an agent's key included), else the task row's own
// creator and time. Long histories fold their older items behind "Show N earlier".
// Pure.

import type { SpineComment } from "@/lib/runtime.types";
import { dayOffset, formatDate, formatTime } from "@/lib/time-format";
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
  const createEntry = activity.find((e) => e.op === "tasks.create");
  const items: FeedItem[] = [
    ...activity
      .filter((entry) => isTrailEntry(entry) && entry !== createEntry)
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
  const created: FeedItem = createEntry
    ? { kind: "activity", id: createEntry.id, at: createEntry.createdAt, entry: createEntry }
    : {
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

/** The feed's quiet time: "7:20 PM" today, "Oct 6" this year, "Oct 6, 2025" before. */
export function feedTime(iso: string, now: Date = new Date()): string {
  if (dayOffset(iso, now) === 0) return formatTime(iso);
  return formatDate(iso, now);
}
