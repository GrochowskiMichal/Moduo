// The Inbox's triage (tasks-v3 §8, defaults b and h; research §7; TV-U15).
// Pure: no React, no IO.
//
// - Keys (Linear's, because A and D already mean Assign and Due): 1 Accept
//   (file it, assigned to you) · 2 Decline (someone else's goes back to them
//   with a note; your own becomes Won't do) · 3 Duplicate of… (its links
//   move over and its comments are copied there, then Won't do) · H Snooze
//   (Tomorrow · Next week · Pick…). They work only in the Inbox.
// - A snoozed task leaves the list for "Snoozed · n" at its end and comes
//   back on top on its day, or as soon as someone comments on it. The
//   snoozes follow the person (synced preferences, no new table).

import type { TasksInboxSnooze } from "../../lib/preferences";
import { formatDate, formatDay } from "../../lib/time-format";
import { daysLeftInWeek } from "./day-buckets";
import { todayStr } from "./helpers";
import type { Task } from "./model";

export type TriageAction = "accept" | "decline" | "duplicate" | "snooze";

/** The triage actions in the bottom bar's order, with their keys (82b). */
export const TRIAGE_ACTIONS: ReadonlyArray<{ action: TriageAction; label: string; key: string }> = [
  { action: "accept", label: "Accept", key: "1" },
  { action: "decline", label: "Decline", key: "2" },
  { action: "duplicate", label: "Duplicate", key: "3" },
  { action: "snooze", label: "Snooze", key: "H" },
];

/** The triage action a keydown asks for (no modifiers), or null. */
export function triageActionFor(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
): TriageAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case "1":
      return "accept";
    case "2":
      return "decline";
    case "3":
      return "duplicate";
    case "h":
    case "H":
      return "snooze";
    default:
      return null;
  }
}

// ── snoozing ─────────────────────────────────────────────────────────────

/**
 * Whether a snooze still holds: before its day, and no comment since. A task
 * with no comment stamp now (its comments not read yet, as at a boot) holds:
 * only a stamp that moved wakes it.
 */
export function snoozeHolds(
  entry: TasksInboxSnooze,
  today: string,
  stampNow: string | null | undefined,
): boolean {
  if (entry.until <= today) return false;
  return stampNow == null || stampNow === entry.stamp;
}

export type SnoozeSplit<T extends Pick<Task, "id">> = {
  /** In the list as usual. */
  active: T[];
  /** Folded into "Snoozed · n", in the order they come back. */
  snoozed: T[];
  /** Their snooze ended (the day came, or someone commented): back on top. */
  woken: string[];
  /** Snoozes of tasks no longer in the Inbox (filed, finished, gone): forgotten. */
  stale: string[];
};

/**
 * Split the Inbox's open tasks by their snoozes. A snooze whose task isn't
 * among them any more is stale; one that ended has woken (the caller puts
 * the task back on top and forgets the snooze).
 */
export function splitSnoozed<T extends Pick<Task, "id">>(
  tasks: readonly T[],
  snoozes: Readonly<Record<string, TasksInboxSnooze>>,
  today: string,
  stamps: ReadonlyMap<string, string>,
): SnoozeSplit<T> {
  const ids = new Set(tasks.map((t) => t.id));
  const stale = Object.keys(snoozes).filter((id) => !ids.has(id));
  const woken: string[] = [];
  const active: T[] = [];
  const snoozed: T[] = [];
  for (const task of tasks) {
    const entry = snoozes[task.id];
    if (!entry) {
      active.push(task);
      continue;
    }
    if (snoozeHolds(entry, today, stamps.get(task.id))) {
      snoozed.push(task);
    } else {
      woken.push(task.id);
      active.push(task);
    }
  }
  snoozed.sort((a, b) => {
    const x = snoozes[a.id]?.until ?? "";
    const y = snoozes[b.id]?.until ?? "";
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return { active, snoozed, woken, stale };
}

/** Snooze's choices: Tomorrow, and Next week (the coming week's first day, where
 *  Time & region starts it, as the date panel's). */
export function snoozeChoices(now: Date): Array<{ label: string; until: string }> {
  const today = todayStr(now);
  const at = (days: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
    return todayStr(d);
  };
  const tomorrow = at(1);
  const nextWeek = at(daysLeftInWeek(now) + 1);
  const out = [{ label: "Tomorrow", until: tomorrow }];
  if (nextWeek !== tomorrow && nextWeek > today) out.push({ label: "Next week", until: nextWeek });
  return out;
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/** A snooze choice's calendar day: "Wed, Oct 14". */
export function snoozeDayLabel(until: string, now: Date): string {
  const [y, m, d] = until.split("-").map(Number);
  const day = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  return `${WEEKDAY.format(day)}, ${formatDate(day, now)}`;
}

/** A snoozed row's date words: "until Tomorrow", "until Mon", "until Nov 3". */
export function snoozedUntilLabel(until: string, now: Date): string {
  const [y, m, d] = until.split("-").map(Number);
  return `until ${formatDay(new Date(y ?? 0, (m ?? 1) - 1, d ?? 1), now)}`;
}

// ── declining, sources ──────────────────────────────────────────────────

/**
 * What Decline does with a task: someone else's goes back to them with a
 * note; your own (or one whose maker isn't known) becomes Won't do.
 */
export function declineMode(
  task: Pick<Task, "creatorId" | "creatorUnknown">,
  me: string | null,
): "hand-back" | "wont-do" {
  return !task.creatorUnknown && task.creatorId && me && task.creatorId !== me
    ? "hand-back"
    : "wont-do";
}

/** The comment a declined task carries back: "Declined by Maciej: not mine". */
export function declineComment(byName: string, note: string): string {
  const trimmed = note.trim();
  return trimmed ? `Declined by ${byName}: ${trimmed}` : `Declined by ${byName}.`;
}

/**
 * Where an Inbox task came from, as its row says it (research §7): your own
 * captures say nothing; one someone else made reads "from Mike".
 */
export function inboxSourceLabel(
  task: Pick<Task, "creatorId" | "creatorUnknown">,
  me: string | null,
  firstNameOf: (userId: string) => string | null,
): string | null {
  if (task.creatorUnknown || !task.creatorId || !me || task.creatorId === me) return null;
  const name = firstNameOf(task.creatorId);
  return name ? `from ${name}` : null;
}

/**
 * The comment "Duplicate of…" leaves on the task it keeps: the duplicate's
 * comments copied over, each with who wrote it (there's no server move for
 * comments; their own thread stays on the duplicate).
 */
export function duplicateComment(
  duplicateTitle: string,
  comments: ReadonlyArray<{ author: string; body: string }>,
): string {
  const head = `Merged “${duplicateTitle || "Untitled"}” into this task.`;
  const lines = comments
    .map((c) => ({ author: c.author, body: c.body.trim() }))
    .filter((c) => c.body)
    .map((c) => `${c.author}: ${c.body}`);
  return lines.length === 0 ? head : `${head}\n\n${lines.join("\n\n")}`;
}
