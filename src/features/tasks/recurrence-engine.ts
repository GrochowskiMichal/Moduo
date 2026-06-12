// The recurrence engine (spec §5d): pure functions over the single-row model —
// a recurring task is one row that cycles; `scheduledAt` carries the current
// occurrence and `recurrence.nextOccurrence` is the stored pointer for when a
// completed task comes back. Missed occurrences don't exist: no backfill, no
// "7 overdue" — there is only the next occurrence (design principle 4).
//
// Three entry points, all returning a Partial<Task> patch (or null for no-op):
//   - recurrenceOnStatusChange — advance-on-done (and pointer refresh on un-done)
//   - catchUpPatch             — idempotent catch-up pass on app open / reload
//   - skipOccurrencePatch      — the skip-occurrence affordance
//
// No React, no IO — easy to unit-test. Callers apply patches via the normal
// optimistic patch path.

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
  return status === "todo" || status === "in_progress";
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
 * first occurrence after `max(now, scheduledAt)`; un-completing recomputes it
 * the same way. Returns the updated rule, or null when the change is not a
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
  const next = occurrenceAfter(rec, advanceBase(task, now), task.createdAt);
  return { ...rec, nextOccurrence: next ? next.toISOString() : null };
}

/**
 * Catch-up (spec §5d) — one idempotent pass per task on app open / reload.
 * Returns a patch or null when the task is already current.
 *
 * - done + pointer arrived → reopen at the latest occurrence ≤ now (status
 *   todo, stale commit cleared — reopening never auto-commits).
 * - open + missed ≥1 full occurrence → collapse `scheduledAt` forward to the
 *   latest occurrence ≤ now (one quiet drift, never a pile).
 * - open + no `scheduledAt` → adopt the live occurrence (self-healing for
 *   rows captured before the engine existed).
 * - drift within the current occurrence is NOT caught up — still actionable.
 */
export function catchUpPatch(task: Task, now: Date): Partial<Task> | null {
  const rec = task.recurrence;
  if (!rec || task.deletedAt || task.status === "archived") return null;

  if (task.status === "done") {
    // The pointer stored at completion; fall back to recomputing from the last
    // update for pre-engine rows that were completed without one.
    const pointerIso = rec.nextOccurrence;
    const pointer = pointerIso
      ? new Date(pointerIso)
      : occurrenceAfter(rec, new Date(task.updatedAt), task.createdAt);
    if (!pointer || Number.isNaN(pointer.getTime()) || pointer.getTime() > now.getTime()) {
      return null; // exhausted rule stays done; future pointer isn't due yet
    }
    const current = currentOccurrence(rec, now, task.createdAt) ?? pointer;
    const next = occurrenceAfter(rec, now, task.createdAt);
    return {
      status: "todo",
      scheduledAt: current.toISOString(),
      recurrence: { ...rec, nextOccurrence: next ? next.toISOString() : null },
      committedFor: null,
      commitOrder: null,
    };
  }

  // Open task: collapse missed occurrences forward / adopt a missing one.
  const current = currentOccurrence(rec, now, task.createdAt);
  const next = occurrenceAfter(rec, now, task.createdAt);
  let scheduledAt: string | null = null;
  if (!task.scheduledAt) {
    const adopt = current ?? next;
    if (!adopt) return null;
    scheduledAt = adopt.toISOString();
  } else if (current) {
    const scheduled = new Date(task.scheduledAt);
    if (Number.isNaN(scheduled.getTime()) || scheduled.getTime() >= current.getTime()) {
      return null; // current (or deliberately pushed ahead) — leave it alone
    }
    scheduledAt = current.toISOString();
  } else {
    return null;
  }
  return {
    scheduledAt,
    recurrence: { ...rec, nextOccurrence: next ? next.toISOString() : null },
  };
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
