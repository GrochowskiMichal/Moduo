/**
 * PORT — keep in sync with src/features/tasks/recurrence-engine.ts.
 *
 * The module contract (Pillar 1) puts occurrence math in the caller: the app
 * runs the tested client engine; the connector runs this server-side port
 * before calling the same tasks_op_* RPCs. Deno can't import the app's
 * extensionless modules, so the two functions the connector needs —
 * advance-on-done / reopen pointer refresh and the skip-occurrence targets —
 * are ported here against the same rrule major version (rrule@2). The ops
 * still enforce the structural invariants (forward-only, recurring-only),
 * so drift between the ports degrades to a rejected call, never corruption.
 *
 * One deliberate divergence: commit-release on skip compares calendar days
 * in UTC (the edge has no user timezone), where the client compares local
 * days. The op takes release_commit explicitly, so the app's behavior is
 * unaffected.
 */

import { RRule } from "https://esm.sh/rrule@2.8.1?target=deno";

export type RecurrenceRule = {
  rrule: string;
  dtstart: string | null;
  nextOccurrence: string | null;
};

export type RecurringTaskRow = {
  status: string;
  scheduled_at: string | null;
  committed_for: string | null;
  created_at: string;
  recurrence: RecurrenceRule | null;
};

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

/** First occurrence strictly after `after`, or null (exhausted / invalid). */
export function occurrenceAfter(
  rec: RecurrenceRule,
  after: Date,
  fallbackDtstart?: string | null,
): Date | null {
  const rule = toRRule(rec, fallbackDtstart);
  return rule ? rule.after(after, false) : null;
}

/** The instant a completion advances from: the pending occurrence if still
 * ahead (completing early skips it), otherwise now (no backfill). */
function advanceBase(scheduledAt: string | null, now: Date): Date {
  if (scheduledAt) {
    const scheduled = new Date(scheduledAt);
    if (!Number.isNaN(scheduled.getTime()) && scheduled.getTime() > now.getTime()) {
      return scheduled;
    }
  }
  return now;
}

function isOpenStatus(status: string): boolean {
  return status === "todo" || status === "in_progress";
}

/**
 * Advance-on-done (spec §5d): the refreshed rule to ride along with a status
 * change, or null when the change is not a done-transition on a recurring
 * task. Mirrors recurrenceOnStatusChange in the client engine.
 */
export function pointerOnStatusChange(
  task: RecurringTaskRow,
  nextStatus: string,
  now: Date,
): RecurrenceRule | null {
  const rec = task.recurrence;
  if (!rec || nextStatus === task.status) return null;
  const completing = nextStatus === "done" && task.status !== "done";
  const reopening = task.status === "done" && isOpenStatus(nextStatus);
  if (!completing && !reopening) return null;
  const next = occurrenceAfter(rec, advanceBase(task.scheduled_at, now), task.created_at);
  return { ...rec, nextOccurrence: next ? next.toISOString() : null };
}

/** UTC calendar day (YYYY-MM-DD) — see the divergence note in the header. */
function utcDayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Skip-occurrence targets (spec §5d): the next occurrence, the rule with the
 * advanced pointer, and whether the day's commit should be released. Mirrors
 * skipOccurrencePatch in the client engine; null when there is nothing to
 * skip to (not recurring, not open, or the rule is exhausted).
 */
export function skipOccurrenceTargets(
  task: RecurringTaskRow,
  now: Date,
): { scheduledAt: string; recurrence: RecurrenceRule; releaseCommit: boolean } | null {
  const rec = task.recurrence;
  if (!rec || !isOpenStatus(task.status)) return null;
  const next = occurrenceAfter(rec, advanceBase(task.scheduled_at, now), task.created_at);
  if (!next) return null;
  const after = occurrenceAfter(rec, next, task.created_at);
  const releaseCommit =
    task.committed_for === utcDayStr(now) && utcDayStr(next) !== utcDayStr(now);
  return {
    scheduledAt: next.toISOString(),
    recurrence: { ...rec, nextOccurrence: after ? after.toISOString() : null },
    releaseCommit,
  };
}
