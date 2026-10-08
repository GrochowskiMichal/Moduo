// Tier-1 capture parser (no AI). Extracts a clock time / due date and a
// recurrence from a single line of natural language, using chrono-node for
// datetimes and a constrained vocabulary wrapper over rrule.js for recurrence.
//
// Scope (spec §7): dates/times + a small recurrence vocabulary only. It does NOT
// infer buckets, subtasks, duration, energy, or priority. On a recurrence phrase
// it can't understand, it does not guess — it flags it so the UI can say so.

import * as chrono from "chrono-node";
import { RRule, type Weekday } from "rrule";

import type { RecurrenceRule } from "../model";

export type ParsedCapture = {
  /** Title with the recognised date/recurrence spans stripped out. */
  title: string;
  /** A parsed clock time (hour known), as a plan-able scheduled time. */
  scheduledAt: string | null;
  /** A parsed date with no time — treated as a due date. */
  dueDate: string | null;
  recurrence: RecurrenceRule | null;
  /** Human-readable interpretation for the confirmation toast (empty if none). */
  summary: string;
  /** True if any date/recurrence was recognised. */
  matched: boolean;
  /**
   * Set when the text clearly intended a recurrence ("every …") that the Tier-1
   * vocabulary could not parse. The UI surfaces a polite note rather than a guess.
   */
  unparsedRecurrence: boolean;
};

const WEEKDAYS: Record<string, Weekday> = {
  monday: RRule.MO,
  mon: RRule.MO,
  tuesday: RRule.TU,
  tue: RRule.TU,
  tues: RRule.TU,
  wednesday: RRule.WE,
  wed: RRule.WE,
  thursday: RRule.TH,
  thu: RRule.TH,
  thur: RRule.TH,
  thurs: RRule.TH,
  friday: RRule.FR,
  fri: RRule.FR,
  saturday: RRule.SA,
  sat: RRule.SA,
  sunday: RRule.SU,
  sun: RRule.SU,
};

type RecurrenceMatch = {
  span: [number, number];
  options: Partial<{ freq: number; interval: number; byweekday: Weekday[] }>;
};

const DEFAULT_RECUR_HOUR = 9; // 9:00 AM local default when a recurrence has no time

/** Detect a recurrence phrase from the constrained vocabulary. */
function detectRecurrence(text: string): RecurrenceMatch | null {
  const lower = text.toLowerCase();

  // "every weekday" / "weekdays"
  let m = lower.match(/\b(every weekday|weekdays|each weekday)\b/);
  if (m) {
    return {
      span: [m.index!, m.index! + m[0].length],
      options: {
        freq: RRule.WEEKLY,
        byweekday: [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR],
      },
    };
  }

  // "every monday" / "each fri" / "every other tuesday"
  m = lower.match(/\b(?:every|each)\s+(other\s+)?([a-z]+)\b/);
  if (m && WEEKDAYS[m[2]]) {
    return {
      span: [m.index!, m.index! + m[0].length],
      options: { freq: RRule.WEEKLY, interval: m[1] ? 2 : 1, byweekday: [WEEKDAYS[m[2]]] },
    };
  }

  // "every 2 weeks" / "every 3 days" / "every other week"
  m = lower.match(
    /\b(?:every|each)\s+(other\s+|(\d+)\s+)?(day|days|week|weeks|month|months|year|years)\b/,
  );
  if (m) {
    const interval = m[1] ? (m[2] ? parseInt(m[2], 10) : 2) : 1;
    const unit = m[3];
    const freq = unit.startsWith("day")
      ? RRule.DAILY
      : unit.startsWith("week")
        ? RRule.WEEKLY
        : unit.startsWith("month")
          ? RRule.MONTHLY
          : RRule.YEARLY;
    return { span: [m.index!, m.index! + m[0].length], options: { freq, interval } };
  }

  // single-word cadences
  m = lower.match(/\b(daily|weekly|monthly|yearly|annually)\b/);
  if (m) {
    const freq =
      m[1] === "daily"
        ? RRule.DAILY
        : m[1] === "weekly"
          ? RRule.WEEKLY
          : m[1] === "monthly"
            ? RRule.MONTHLY
            : RRule.YEARLY;
    return { span: [m.index!, m.index! + m[0].length], options: { freq } };
  }

  return null;
}

/** Just the RRULE body (no "RRULE:"/"DTSTART:" lines), e.g. "FREQ=DAILY;INTERVAL=1". */
function rruleBody(rule: RRule): string {
  const line = rule
    .toString()
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.startsWith("RRULE:"));
  return line ? line.slice("RRULE:".length) : rule.toString().replace(/^RRULE:/, "");
}

function stripSpans(text: string, spans: Array<[number, number]>): string {
  // Remove from right to left so indices stay valid.
  const ordered = [...spans].sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [start, end] of ordered) {
    out = out.slice(0, start) + " " + out.slice(end);
  }
  return (
    out
      .replace(/\s+/g, " ")
      .replace(/\s+([,.])/g, "$1")
      // drop dangling connective words left behind ("at", "on", "by", "every")
      .replace(/\b(at|on|by|every|each|due|starting)\s*$/i, "")
      .replace(/^\s*(at|on|by)\b/i, "")
      .trim()
  );
}

export function parseCapture(input: string, refDate: Date = new Date()): ParsedCapture {
  const raw = input.trim();
  const empty: ParsedCapture = {
    title: raw,
    scheduledAt: null,
    dueDate: null,
    recurrence: null,
    summary: "",
    matched: false,
    unparsedRecurrence: false,
  };
  if (!raw) return empty;

  const spans: Array<[number, number]> = [];
  let scheduledAt: string | null = null;
  let dueDate: string | null = null;
  let recurrence: RecurrenceRule | null = null;
  const parts: string[] = [];

  // ── chrono: time / date ────────────────────────────────────────────────────
  const results = chrono.parse(raw, refDate, { forwardDate: true });
  const dateResult = results[0];
  let timeOfDay: { hour: number; minute: number } | null = null;
  if (dateResult) {
    spans.push([dateResult.index, dateResult.index + dateResult.text.length]);
    const start = dateResult.start;
    const date = start.date();
    const hasTime = start.isCertain("hour");
    if (hasTime) {
      timeOfDay = { hour: date.getHours(), minute: date.getMinutes() };
    }
  }

  // ── recurrence vocabulary ──────────────────────────────────────────────────
  const recur = detectRecurrence(raw);
  let unparsedRecurrence = false;
  if (recur) {
    spans.push(recur.span);
    // DTSTART anchored to the parsed time-of-day (or a 9am default), today.
    const dtstart = new Date(refDate);
    dtstart.setHours(timeOfDay?.hour ?? DEFAULT_RECUR_HOUR, timeOfDay?.minute ?? 0, 0, 0);
    const rule = new RRule({ ...recur.options, dtstart });
    const next = rule.after(new Date(refDate.getTime() - 1000), true) ?? dtstart;
    recurrence = {
      rrule: rruleBody(rule),
      dtstart: dtstart.toISOString(),
      nextOccurrence: next.toISOString(),
    };
    // A recurring task is scheduled at its next occurrence.
    scheduledAt = next.toISOString();
    parts.push(`recurs ${rule.toText()}`);
  } else if (/\b(every|each)\b/i.test(raw) && dateResult == null) {
    // The user clearly meant a recurrence but we couldn't parse it — don't guess.
    unparsedRecurrence = true;
  }

  // ── resolve a one-off date/time when there's no recurrence ──────────────────
  if (!recurrence && dateResult) {
    const date = dateResult.start.date();
    if (timeOfDay) {
      scheduledAt = date.toISOString();
      parts.push(`scheduled ${chronoLabel(date, true)}`);
    } else {
      dueDate = date.toISOString();
      parts.push(`due ${chronoLabel(date, false)}`);
    }
  }

  const matched = !!recurrence || !!dateResult;
  const title = stripSpans(raw, spans) || raw;
  return {
    title,
    scheduledAt,
    dueDate,
    recurrence,
    summary: parts.join(" · "),
    matched,
    unparsedRecurrence,
  };
}

const LABEL_TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const LABEL_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const LABEL_DATETIME = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function chronoLabel(date: Date, withTime: boolean): string {
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (withTime)
    return isToday ? `today at ${LABEL_TIME.format(date)}` : LABEL_DATETIME.format(date);
  return isToday ? "today" : LABEL_DATE.format(date);
}
