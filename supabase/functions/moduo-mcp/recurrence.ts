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
 * Like the app's engine (TV-D12, HV-15 509-4) every function takes the zone
 * last (the caller passes the person's: tasks-helpers.ts personZone) and
 * computes in "floating" time: DTSTART is floated to the zone's wall clock,
 * UNTIL is already that wall clock (the picker and the connector store it so)
 * and stays as written, and commit-release compares the person's days. The
 * default is UTC, the old behaviour. toFloating/fromFloating are ported from
 * apps/app/src/lib/zoned-time.ts.
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

// ── Wall clocks in a zone (port of apps/app/src/lib/zoned-time.ts) ─────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(zone);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
    return f;
  } catch {
    return null;
  }
}

const isUtc = (zone: string | null | undefined) =>
  !zone || zone === "UTC" || zone === "Etc/UTC" || zone === "GMT";

/** The instant's wall clock in `zone`, as a UTC Date (milliseconds kept). */
export function toFloating(at: Date, zone: string | null | undefined): Date {
  if (isUtc(zone)) return new Date(at.getTime());
  const f = formatter(zone as string);
  if (!f) return new Date(at.getTime());
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return new Date(Date.UTC(
    parts.year ?? 1970, (parts.month ?? 1) - 1, parts.day ?? 1,
    parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, at.getUTCMilliseconds(),
  ));
}

const DAY_MS = 86_400_000;
const offsetAt = (ms: number, zone: string) => toFloating(new Date(ms), zone).getTime() - ms;

/** The instant a floating Date names in `zone`, resolved as Postgres's `AT TIME ZONE` does. */
export function fromFloating(floating: Date, zone: string | null | undefined): Date {
  if (isUtc(zone)) return new Date(floating.getTime());
  const target = floating.getTime();
  const before = target - offsetAt(target - DAY_MS, zone as string);
  const after = target - offsetAt(target + DAY_MS, zone as string);
  const fits = (ms: number) => toFloating(new Date(ms), zone).getTime() === target;
  const okBefore = fits(before);
  const okAfter = fits(after);
  if (okBefore && okAfter) return new Date(Math.max(before, after));
  if (okAfter) return new Date(after);
  return new Date(before);
}

/** The calendar day an instant falls on in `zone` (YYYY-MM-DD). */
function zonedDay(at: Date, zone: string): string {
  return toFloating(at, zone).toISOString().slice(0, 10);
}

/** The rule in floating time for `zone`: DTSTART floated, UNTIL as written
 *  (already the zone's wall clock). Defensive: invalid input → null. */
function toRRule(rec: RecurrenceRule, fallbackDtstart: string | null | undefined, zone: string): RRule | null {
  try {
    const options = RRule.parseString(rec.rrule);
    const anchor = rec.dtstart ?? fallbackDtstart;
    if (anchor) {
      const d = new Date(anchor);
      if (!Number.isNaN(d.getTime())) options.dtstart = toFloating(d, zone);
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
  zone = "UTC",
): Date | null {
  const rule = toRRule(rec, fallbackDtstart, zone);
  const next = rule ? rule.after(toFloating(after, zone), false) : null;
  return next ? fromFloating(next, zone) : null;
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
  zone = "UTC",
): RecurrenceRule | null {
  const rec = task.recurrence;
  if (!rec || nextStatus === task.status) return null;
  const completing = nextStatus === "done" && task.status !== "done";
  const reopening = task.status === "done" && isOpenStatus(nextStatus);
  if (!completing && !reopening) return null;
  const next = occurrenceAfter(rec, advanceBase(task.scheduled_at, now), task.created_at, zone);
  return { ...rec, nextOccurrence: next ? next.toISOString() : null };
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
  zone = "UTC",
): { scheduledAt: string; recurrence: RecurrenceRule; releaseCommit: boolean } | null {
  const rec = task.recurrence;
  if (!rec || !isOpenStatus(task.status)) return null;
  const next = occurrenceAfter(rec, advanceBase(task.scheduled_at, now), task.created_at, zone);
  if (!next) return null;
  const after = occurrenceAfter(rec, next, task.created_at, zone);
  const today = zonedDay(now, zone);
  const releaseCommit = task.committed_for === today && zonedDay(next, zone) !== today;
  return {
    scheduledAt: next.toISOString(),
    recurrence: { ...rec, nextOccurrence: after ? after.toISOString() : null },
    releaseCommit,
  };
}
