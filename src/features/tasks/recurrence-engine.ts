// The recurrence engine (spec §5d): pure functions over the single-row model —
// a recurring task is one row that cycles; `scheduledAt` carries the current
// occurrence and `recurrence.nextOccurrence` is the stored pointer for when a
// completed task comes back. Missed occurrences don't exist: no backfill, no
// "7 overdue" — there is only the next occurrence (design principle 4).
//
// Since TV-D8 the server owns the pointer and the roll-over
// (supabase/migrations/20261010161000_tasks_recurrence_server.sql, which reads
// rules the way rrule.js does): this engine is for previews ("Done — next: …")
// and for rules outside the server's subset, whose pointer the server keeps
// from the client. The client catch-up pass is gone.
//   - recurrenceOnStatusChange — the pointer a status change gives (preview)
//   - skipOccurrencePatch      — the skip-occurrence affordance
//
// No React, no IO — easy to unit-test.

import { isOpenTaskStatus } from "@contracts/vocabularies";
import { RRule } from "rrule";

import { todayStr } from "./helpers";
import type { RecurrenceRule, Task, TaskStatus } from "./model";

/** Build an RRule from a stored rule. Defensive: invalid input → null. */
function toRRule(rec: RecurrenceRule, fallbackDtstart?: string | null): RRule | null {
  try {
    const options = RRule.parseString(rec.rrule);
    const anchor = rec.dtstart ?? fallbackDtstart;
    if (anchor) {
      const d = new Date(anchor);
      if (!Number.isNaN(d.getTime())) options.dtstart = d;
    }
    return new RRule(options);
  } catch {
    return null;
  }
}

/** First occurrence strictly after `after`, or null (exhausted / invalid rule). */
export function occurrenceAfter(
  rec: RecurrenceRule,
  after: Date,
  fallbackDtstart?: string | null,
): Date | null {
  const rule = toRRule(rec, fallbackDtstart);
  return rule ? rule.after(after, false) : null;
}

/** Latest occurrence at or before `now` — the task's *current* occurrence. */
export function currentOccurrence(
  rec: RecurrenceRule,
  now: Date,
  fallbackDtstart?: string | null,
): Date | null {
  const rule = toRRule(rec, fallbackDtstart);
  return rule ? rule.before(now, true) : null;
}

function isOpenStatus(status: TaskStatus): boolean {
  return isOpenTaskStatus(status);
}

/** The instant a completion advances from: the pending occurrence if it's still
 * ahead (completing early skips it), otherwise now (completing late never
 * backfills). */
function advanceBase(task: Pick<Task, "scheduledAt">, now: Date): Date {
  if (task.scheduledAt) {
    const scheduled = new Date(task.scheduledAt);
    if (!Number.isNaN(scheduled.getTime()) && scheduled.getTime() > now.getTime()) {
      return scheduled;
    }
  }
  return now;
}

/**
 * Advance-on-done (spec §5d): when a recurring task's status changes, keep the
 * stored `nextOccurrence` pointer fresh. On completion the pointer moves to the
 * first occurrence after `max(now, scheduledAt)` that isn't on today's date (a
 * repeat done today comes back on a later day, TV-D8 — the server's rule, in
 * the device's zone here); un-completing recomputes it after `max(now,
 * scheduledAt)`. Returns the updated rule, or null when the change is not a
 * done-transition on a recurring task (archived is terminal — no advance).
 */
export function recurrenceOnStatusChange(
  task: Pick<Task, "recurrence" | "status" | "scheduledAt" | "createdAt">,
  nextStatus: TaskStatus,
  now: Date,
): RecurrenceRule | null {
  const rec = task.recurrence;
  if (!rec || nextStatus === task.status) return null;
  const completing = nextStatus === "done" && task.status !== "done";
  const reopening = task.status === "done" && isOpenStatus(nextStatus);
  if (!completing && !reopening) return null;
  let next = occurrenceAfter(rec, advanceBase(task, now), task.createdAt);
  if (completing) {
    const today = todayStr(now);
    for (let i = 0; next && todayStr(next) <= today && i < 400; i += 1) {
      next = occurrenceAfter(rec, next, task.createdAt);
    }
  }
  return { ...rec, nextOccurrence: next ? next.toISOString() : null };
}

/**
 * Skip-occurrence (spec §5d): jump an open recurring task to the occurrence
 * after `max(now, scheduledAt)` without done-credit. Releases a commit for
 * today when the new occurrence isn't today. Never offered on done tasks, and
 * deliberately does NOT touch `rescheduleCount` — a skipped occurrence is a
 * decision, not a slip. Returns null when there's nothing to skip to.
 */
export function skipOccurrencePatch(task: Task, now: Date): Partial<Task> | null {
  const rec = task.recurrence;
  if (!rec || task.deletedAt || !isOpenStatus(task.status)) return null;
  const next = occurrenceAfter(rec, advanceBase(task, now), task.createdAt);
  if (!next) return null;
  const after = occurrenceAfter(rec, next, task.createdAt);
  const patch: Partial<Task> = {
    scheduledAt: next.toISOString(),
    recurrence: { ...rec, nextOccurrence: after ? after.toISOString() : null },
  };
  if (task.committedFor === todayStr(now) && todayStr(next) !== todayStr(now)) {
    patch.committedFor = null;
    patch.commitOrder = null;
  }
  return patch;
}
