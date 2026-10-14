// The detail panel's one feed (tasks-v2 §9, Tasks v3 §9 + default q):
// comments and the quiet activity trail in one list, oldest first, so the
// composer sits under the latest thing said or done. Creation leads it: the
// `tasks.create` row since TV-D8 (it names who, an agent's key included),
// else the task row's own creator and time.
//
// TV-U13 (research views-board-detail §9) keeps it calm:
// - one person's changes within 10 minutes merge into one line ("changed
//   due, priority and 2 more"), expandable;
// - a run of changes between two comments folds into "Show 12 earlier
//   changes"; the run after the last comment shows its latest few;
// - "All · Comments" in the feed header shows everything or the talk only.
// Pure.

import type { SpineComment } from "@/lib/runtime.types";
import { dayOffset, formatDate, formatTime } from "@/lib/time-format";
import { isTrailEntry } from "./activity";
import type { ActivityEntry, Task } from "./model";

export type FeedItem =
  | { kind: "created"; id: string; at: string; actorId: string | null }
  | { kind: "activity"; id: string; at: string; entry: ActivityEntry }
  | { kind: "comment"; id: string; at: string; comment: SpineComment };

/** How many of the latest items show before the rest fold away (the v2 fold). */
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

// ── v3: merged changes, folded runs, All · Comments ──────────────────────────

/** "All" shows comments and changes; "Comments" only the talk (default q). */
export type FeedFilter = "all" | "comments";

/** One person's changes merge when each is this close to the group's first. */
export const MERGE_WINDOW_MS = 10 * 60 * 1000;
/** A run of change lines between comments folds once it is longer than this. */
export const RUN_FOLD_AT = 2;
/** The run after the last comment shows this many of its latest lines. */
export const TAIL_VISIBLE = 5;

/** What the feed draws, in order. */
export type FeedRow =
  /** The creation line, or one change. */
  | { kind: "line"; id: string; item: FeedItem }
  /** One person's changes within 10 minutes: "changed due, priority and 2 more". */
  | { kind: "merged"; id: string; entries: ActivityEntry[]; at: string }
  | { kind: "comment"; id: string; comment: SpineComment }
  /** "Show 12 earlier changes": `count` change lines behind one button. */
  | { kind: "fold"; id: string; count: number };

/** The short name a change goes by in a merged line, or null when it never merges. */
export function changeWord(entry: Pick<ActivityEntry, "op" | "payload">): string | null {
  switch (entry.op) {
    case "tasks.update": {
      const fields = Array.isArray(entry.payload?.fields)
        ? (entry.payload.fields as unknown[]).filter((f): f is string => typeof f === "string")
        : [];
      const words = fields.map((f) => FIELD_WORDS[f] ?? f);
      return words.length > 0 ? words.join(", ") : null;
    }
    case "tasks.set_status":
      return "status";
    case "tasks.assigned":
      return "assignee";
    case "tasks.reschedule":
    case "tasks.unschedule":
      return "scheduled time";
    case "tasks.session_add":
    case "tasks.session_move":
    case "tasks.session_remove":
      return "sessions";
    case "tasks.waiting_add":
    case "tasks.waiting_remove":
      return "waiting on";
    case "tasks.queue_add":
    case "tasks.queue_remove":
      return "queue";
    default:
      return null;
  }
}

const FIELD_WORDS: Record<string, string> = {
  title: "title",
  description: "description",
  bucket_id: "project",
  parent_id: "parent",
  due_date: "due",
  due_on: "due",
  due_time: "due",
  scheduled_at: "scheduled time",
  duration_minutes: "estimate",
  estimate_minutes: "estimate",
  recurrence: "repeat",
  energy_level: "energy",
  priority: "priority",
  section_id: "section",
  team_id: "team",
};

/** "changed due, priority and 2 more" for a merged run (each word once). */
export function mergedLine(entries: readonly Pick<ActivityEntry, "op" | "payload">[]): string {
  const words: string[] = [];
  for (const e of entries) {
    for (const w of (changeWord(e) ?? "").split(", ")) {
      if (w && !words.includes(w)) words.push(w);
    }
  }
  if (words.length === 0) return "made changes";
  if (words.length === 1) return `changed ${words[0]}`;
  if (words.length <= 3) {
    return `changed ${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  }
  return `changed ${words.slice(0, 2).join(", ")} and ${words.length - 2} more`;
}

const actorKey = (e: ActivityEntry) => `${e.actorType}:${e.actorId ?? e.actorLabel ?? ""}`;

/** Merge one person's mergeable changes within the window; anything else stands alone. */
function mergeRun(items: FeedItem[]): FeedRow[] {
  const rows: FeedRow[] = [];
  let group: ActivityEntry[] = [];
  const flush = () => {
    if (group.length === 1) {
      const entry = group[0] as ActivityEntry;
      rows.push({
        kind: "line",
        id: entry.id,
        item: { kind: "activity", id: entry.id, at: entry.createdAt, entry },
      });
    } else if (group.length > 1) {
      const last = group[group.length - 1] as ActivityEntry;
      rows.push({
        kind: "merged",
        id: `merged:${group[0]?.id}`,
        entries: group,
        at: last.createdAt,
      });
    }
    group = [];
  };
  for (const item of items) {
    if (item.kind !== "activity" || changeWord(item.entry) === null) {
      flush();
      rows.push({ kind: "line", id: item.id, item });
      continue;
    }
    const first = group[0];
    if (
      first &&
      (actorKey(first) !== actorKey(item.entry) ||
        Date.parse(item.entry.createdAt) - Date.parse(first.createdAt) > MERGE_WINDOW_MS)
    ) {
      flush();
    }
    group.push(item.entry);
  }
  flush();
  return rows;
}

/** How many underlying change lines a row stands for. */
const lineCount = (row: FeedRow) => (row.kind === "merged" ? row.entries.length : 1);

/**
 * The rows the feed draws. Creation stays first. With "comments", only the
 * comments. Otherwise each run of changes between two comments folds once it
 * has more than {@link RUN_FOLD_AT} rows, and the run after the last comment
 * (or the whole trail, with no comments) shows its latest
 * {@link TAIL_VISIBLE} rows behind one fold. A fold whose id is in `opened`
 * shows its rows instead.
 */
export function shapeFeed(
  items: FeedItem[],
  filter: FeedFilter,
  opened: ReadonlySet<string> = new Set(),
): FeedRow[] {
  if (filter === "comments") {
    return items.flatMap((item): FeedRow[] =>
      item.kind === "comment" ? [{ kind: "comment", id: item.id, comment: item.comment }] : [],
    );
  }
  const [first, ...rest] = items;
  const out: FeedRow[] = first ? [{ kind: "line", id: first.id, item: first }] : [];
  // Split into runs of changes and the comments between them.
  const runs: { changes: FeedItem[]; comment: SpineComment | null }[] = [];
  let changes: FeedItem[] = [];
  for (const item of rest) {
    if (item.kind === "comment") {
      runs.push({ changes, comment: item.comment });
      changes = [];
    } else {
      changes.push(item);
    }
  }
  runs.push({ changes, comment: null });
  runs.forEach((run, index) => {
    const rows = mergeRun(run.changes);
    const isTail = index === runs.length - 1;
    const keep = isTail ? TAIL_VISIBLE : rows.length > RUN_FOLD_AT ? 0 : rows.length;
    const hidden = rows.slice(0, Math.max(0, rows.length - keep));
    const foldId = `fold:${hidden[0]?.id ?? index}`;
    if (hidden.length > 0 && !opened.has(foldId)) {
      out.push({ kind: "fold", id: foldId, count: hidden.reduce((n, r) => n + lineCount(r), 0) });
      out.push(...rows.slice(hidden.length));
    } else {
      out.push(...rows);
    }
    if (run.comment) out.push({ kind: "comment", id: run.comment.id, comment: run.comment });
  });
  return out;
}

/** "Show 12 earlier changes" · "Show 1 earlier change". */
export function foldLabel(count: number): string {
  return `Show ${count} earlier ${count === 1 ? "change" : "changes"}`;
}

/** The feed's quiet time: "7:20 PM" today, "Oct 6" this year, "Oct 6, 2025" before. */
export function feedTime(iso: string, now: Date = new Date()): string {
  if (dayOffset(iso, now) === 0) return formatTime(iso);
  return formatDate(iso, now);
}
