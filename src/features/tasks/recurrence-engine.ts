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
// Since TV-D12 rules read in a time zone: a 9:00 repeat stays at 9:00 across
// a daylight-saving change. rrule.js computes in "floating" time (the zone's
// wall clock written as UTC), exactly like the server's tasks__rrule_next_in.
// Every function takes the zone last; the default is UTC (the old behaviour,
// and what a pure test wants). The app passes the device's zone.
//
// No React, no IO — easy to unit-test.

import { isOpenTaskStatus } from "@contracts/vocabularies";
import { RRule } from "rrule";

import { getResolvedTimeRegion } from "../../lib/time-region";
import { fromFloating, toFloating } from "../../lib/zoned-time";
import { todayStr } from "./helpers";
import type { RecurrenceRule, Task, TaskStatus } from "./model";

/** The zone the app reads rules in: Time & region's (TV-D14), the one the
 *  server rolls the person's repeats over in; the device's until it's known,
 *  UTC when neither is. */
export function engineZone(): string {
  return getResolvedTimeRegion().timeZone;
}

/** Build an RRule in floating time for `zone`. Defensive: invalid input → null. */
function toRRule(
  rec: RecurrenceRule,
  fallbackDtstart: string | null | undefined,
  zone: string,
): RRule | null {
  try {
    const options = RRule.parseString(rec.rrule);
    const anchor = rec.dtstart ?? fallbackDtstart;
    if (anchor) {
      const d = new Date(anchor);
      if (!Number.isNaN(d.getTime())) options.dtstart = toFloating(d, zone);
    }
    if (options.until) options.until = toFloating(options.until, zone);
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
  zone = "UTC",
): Date | null {
  const rule = toRRule(rec, fallbackDtstart, zone);
  const next = rule ? rule.after(toFloating(after, zone), false) : null;
  return next ? fromFloating(next, zone) : null;
}

/** Latest occurrence at or before `now` — the task's *current* occurrence. */
export function currentOccurrence(
  rec: RecurrenceRule,
  now: Date,
  fallbackDtstart?: string | null,
  zone = "UTC",
): Date | null {
  const rule = toRRule(rec, fallbackDtstart, zone);
  const prev = rule ? rule.before(toFloating(now, zone), true) : null;
  return prev ? fromFloating(prev, zone) : null;
}

/**
 * The occurrences from `from` to `to` (both included), at most `limit`: the
 * Calendar draws the ones after the task's current date as faint ghosts
 * (REPLAN 27 f). A repeat that counts from completion has no ghosts (its next
 * date isn't known until it's done).
 */
export function occurrencesBetween(
  rec: RecurrenceRule,
  from: Date,
  to: Date,
  fallbackDtstart?: string | null,
  zone = "UTC",
  limit = 60,
): Date[] {
  if (rec.mode === "after_completion" || to.getTime() < from.getTime()) return [];
  const rule = toRRule(rec, fallbackDtstart, zone);
  if (!rule) return [];
  const out: Date[] = [];
  rule.between(toFloating(from, zone), toFloating(to, zone), true, (d) => {
    out.push(fromFloating(d, zone));
    return out.length < limit;
  });
  return out;
}

/**
 * "Change the pattern" (REPLAN 27 g): the rule moved so that an occurrence
 * on `from` falls on `to` instead. DTSTART moves to `to`; a weekly rule's one
 * weekday and a monthly rule's one day of the month follow it. Other rules
 * keep their parts and only start again from `to`.
 */
export function changePatternRule(rec: RecurrenceRule, to: Date, zone = "UTC"): RecurrenceRule {
  const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const wall = toFloating(to, zone);
  const parts = rec.rrule.split(";").filter((p) => p.trim() !== "");
  const freq = parts
    .find((p) => p.toUpperCase().startsWith("FREQ="))
    ?.slice(5)
    .toUpperCase();
  const next = parts.map((part) => {
    const [rawKey, value = ""] = part.split("=");
    const key = (rawKey ?? "").trim().toUpperCase();
    if (key === "BYDAY" && freq === "WEEKLY" && /^[A-Z]{2}$/i.test(value.trim())) {
      return `BYDAY=${DAYS[wall.getUTCDay()]}`;
    }
    if (key === "BYMONTHDAY" && freq === "MONTHLY" && /^\d{1,2}$/.test(value.trim())) {
      return `BYMONTHDAY=${wall.getUTCDate()}`;
    }
    return part;
  });
  const { movedFrom: _from, movedDays: _days, ...rest } = rec;
  return { ...rest, rrule: next.join(";"), dtstart: to.toISOString(), nextOccurrence: null };
}

function isOpenStatus(status: TaskStatus): boolean {
  return isOpenTaskStatus(status);
}

/** The pattern's slot a repeat stands on now, close to the server's
 * tasks__pattern_slot (TV-D12): where "move just this one" took it from, else
 * its due date (the end of that day, so a due date today counts as today's),
 * else its work session. A preview: the server decides. */
function patternSlot(
  task: Pick<Task, "scheduledAt" | "recurrence"> & { dueOn?: string | null },
): Date | null {
  const candidates = [
    task.recurrence?.movedFrom,
    task.dueOn ? `${task.dueOn}T23:59:59.000Z` : null,
    task.scheduledAt,
  ];
  for (const iso of candidates) {
    if (!iso) continue;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** The instant a completion advances from: the pending occurrence if it's still
 * ahead (completing early skips it), otherwise now (completing late never
 * backfills). */
function advanceBase(
  task: Pick<Task, "scheduledAt" | "recurrence"> & { dueOn?: string | null },
  now: Date,
): Date {
  const slot = patternSlot(task);
  return slot && slot.getTime() > now.getTime() ? slot : now;
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
  task: Pick<Task, "recurrence" | "status" | "scheduledAt" | "createdAt"> & {
    dueOn?: string | null;
  },
  nextStatus: TaskStatus,
  now: Date,
  zone = "UTC",
): RecurrenceRule | null {
  const rec = task.recurrence;
  if (!rec || nextStatus === task.status) return null;
  const completing = nextStatus === "done" && task.status !== "done";
  const reopening = task.status === "done" && isOpenStatus(nextStatus);
  if (!completing && !reopening) return null;
  // Counting from completion: only the server knows the next date (TV-D8).
  if (rec.mode === "after_completion") return { ...rec, nextOccurrence: null };
  let next = occurrenceAfter(rec, advanceBase(task, now), task.createdAt, zone);
  if (completing) {
    const today = todayStr(now);
    for (let i = 0; next && todayStr(next) <= today && i < 400; i += 1) {
      next = occurrenceAfter(rec, next, task.createdAt, zone);
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
export function skipOccurrencePatch(task: Task, now: Date, zone = "UTC"): Partial<Task> | null {
  const rec = task.recurrence;
  if (!rec || task.deletedAt || !isOpenStatus(task.status)) return null;
  const next = occurrenceAfter(rec, advanceBase(task, now), task.createdAt, zone);
  if (!next) return null;
  const after = occurrenceAfter(rec, next, task.createdAt, zone);
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
