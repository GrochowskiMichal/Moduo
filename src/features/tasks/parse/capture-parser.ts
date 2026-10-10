// Tier-1 capture parser (no AI). Extracts a clock time / due date and a
// recurrence from a single line of natural language, using chrono-node for
// datetimes and a constrained vocabulary wrapper over rrule.js for recurrence.
//
// Scope (spec §7): dates/times + a small recurrence vocabulary only. It does NOT
// infer buckets, subtasks, duration, energy, or priority. On a recurrence phrase
// it can't understand, it does not guess — it flags it so the UI can say so.
//
// It keeps the words people typed (TV-P0, tasks-v3 AC1.3): only a clear date
// phrase is read as a date (a day, a weekday or a clock time — never a bare
// month, so "Send March report" stays whole); a bare hour reads as daytime
// ("at 5" is 5 PM); and a date typed with a repeat starts the repeat there.

import * as chrono from "chrono-node";
import { RRule, type Weekday } from "rrule";

import { formatDay, formatDayTime } from "../../../lib/time-format";
import { takeSlashDates } from "../../spine/grammar";
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

/** English month names, for handing a `/` command's day to chrono. */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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
  /** A second phrase that belongs to the repeat ("on the 1st"), stripped on its own. */
  extraSpan?: [number, number];
  options: Partial<{
    freq: number;
    interval: number;
    byweekday: Weekday[];
    bymonthday: number[];
  }>;
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

/**
 * A monthly repeat can name its day: "every month on the 1st" repeats on the
 * 1st, and the phrase leaves the title with the repeat.
 */
function withMonthDay(text: string, match: RecurrenceMatch | null): RecurrenceMatch | null {
  if (!match || match.options.freq !== RRule.MONTHLY) return match;
  // The ordinal must end the phrase (end of line, punctuation, a time):
  // "on the 3rd floor" is a place, not a day.
  const m = /\bon the (\d{1,2})(?:st|nd|rd|th)(?=\s*(?:$|[,.;!?]|at\b|\d))/i.exec(text);
  if (!m) return match;
  const day = Number.parseInt(m[1], 10);
  if (day < 1 || day > 31) return match;
  // Its own span: the words between "every month" and "on the 1st" stay.
  return {
    ...match,
    extraSpan: [m.index, m.index + m[0].length],
    options: { ...match.options, bymonthday: [day] },
  };
}

/**
 * A clear date phrase names a day, a weekday or a clock time. A month on its
 * own ("Send March report") or a year isn't one, so those words stay text.
 */
function isClearDate(result: chrono.ParsedResult): boolean {
  const s = result.start;
  return s.isCertain("day") || s.isCertain("weekday") || s.isCertain("hour");
}

/** A bare hour with no AM/PM reads as daytime: 1–6 is the afternoon ("at 5" = 5 PM). */
const DAYTIME_PM_UNTIL = 6;

/** Clock time of a chrono result, with a bare 1–6 o'clock moved to the afternoon. */
function daytimeClock(result: chrono.ParsedResult): { hour: number; minute: number } | null {
  const s = result.start;
  if (!s.isCertain("hour")) return null;
  let hour = s.get("hour") ?? 0;
  const minute = s.get("minute") ?? 0;
  // "05:30" is a 24-hour time someone meant; "5" or "5:30" is ambiguous. Only
  // a zero-padded clock counts ("Oct 05 at 3" is still 3 PM).
  const zeroPadded = /(?:^|[^\d])0\d:\d{2}/.test(result.text);
  if (!s.isCertain("meridiem") && !zeroPadded && hour >= 1 && hour <= DAYTIME_PM_UNTIL) {
    hour += 12;
  }
  return { hour, minute };
}

/** Does the chrono result name the day (so its date is meant), not just a time? */
function namesDay(result: chrono.ParsedResult): boolean {
  return result.start.isCertain("day") || result.start.isCertain("weekday");
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
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

/** Words that only introduce a date ("by Dec 15", "on Monday") and go with it. */
const CONNECTIVE_BEFORE = /\b(?:at|on|by|due|starting|from)\s+$/i;

/** Overlapping spans ("every weekday" + "weekday at 9") merged into one. */
function mergeSpans(spans: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else out.push([span[0], span[1]]);
  }
  return out;
}

function stripSpans(
  text: string,
  spans: Array<[number, number]>,
  /** Where the date phrase starts: only it takes the connective before it. */
  dateStart: number | null,
): string {
  // Remove from right to left so indices stay valid.
  const ordered = mergeSpans(spans).sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [start, end] of ordered) {
    // The connective right before a date goes with it ("Essay by Dec 15 …");
    // never before a repeat ("Log on every day" keeps "on").
    const head = out.slice(0, start);
    const before = start === dateStart ? head.replace(CONNECTIVE_BEFORE, "") : head;
    out = `${before} ${out.slice(end)}`;
  }
  // No blanket strip of leading/trailing "at"/"on"/"by": the date's own
  // connective went with it above, and anything else is the person's words
  // ("On-call handover", "Log on every day").
  return out
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
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

  // `/today`, `/tomorrow`, `/next week` (the grammar's date commands, 33a):
  // an explicit command sets the day and leaves the title. It wins over date
  // words, which then stay the person's words; a clock time still schedules
  // on that day; a repeat keeps its own start.
  const slash = takeSlashDates(raw, refDate);
  if (slash.day && !slash.text) {
    // Only a command: nothing to call the task but its words.
    const due = new Date(`${slash.day}T12:00:00`);
    return {
      ...empty,
      dueDate: due.toISOString(),
      summary: `due ${chronoLabel(due, false)}`,
      matched: true,
    };
  }
  if (slash.day && slash.text) {
    const rest = parseCapture(slash.text, refDate);
    if (rest.recurrence) {
      // The command's day starts the repeat, like a typed date does.
      const day = new Date(`${slash.day}T12:00:00`);
      const named = `${slash.text} on ${MONTHS[day.getMonth()]} ${day.getDate()} ${day.getFullYear()}`;
      const started = parseCapture(named, refDate);
      return started.recurrence ? { ...started, title: rest.title } : rest;
    }
    if (rest.scheduledAt) {
      const at = new Date(rest.scheduledAt);
      const day = new Date(`${slash.day}T00:00:00`);
      day.setHours(at.getHours(), at.getMinutes(), 0, 0);
      return {
        ...rest,
        scheduledAt: day.toISOString(),
        summary: `scheduled ${chronoLabel(day, true)}`,
      };
    }
    // A date alone is due on that day, at noon like a typed date word, so
    // every time zone reads the same calendar day.
    const due = new Date(`${slash.day}T12:00:00`);
    return {
      ...empty,
      title: rest.dueDate ? slash.text : rest.title,
      dueDate: due.toISOString(),
      summary: `due ${chronoLabel(due, false)}`,
      matched: true,
    };
  }

  const spans: Array<[number, number]> = [];
  let scheduledAt: string | null = null;
  let dueDate: string | null = null;
  let recurrence: RecurrenceRule | null = null;
  const parts: string[] = [];

  // ── recurrence vocabulary ──────────────────────────────────────────────────
  const recur = withMonthDay(raw, detectRecurrence(raw));

  // ── chrono: time / date ────────────────────────────────────────────────────
  // The first clear date phrase. One inside the repeat ("every monday at 9")
  // only lends its clock time; the repeat already says which days.
  const results = chrono.parse(raw, refDate, { forwardDate: true }).filter(isClearDate);
  const dateResult = results[0];
  const insideRepeat =
    !!dateResult &&
    !!recur &&
    overlaps(recur.span, [dateResult.index, dateResult.index + dateResult.text.length]);
  const timeOfDay = dateResult ? daytimeClock(dateResult) : null;
  if (dateResult) spans.push([dateResult.index, dateResult.index + dateResult.text.length]);

  /** The parsed moment: chrono's day (or today) at the daytime clock time. */
  const resolveDate = (result: chrono.ParsedResult): Date => {
    const date = result.start.date();
    if (!timeOfDay) return date;
    if (namesDay(result)) {
      date.setHours(timeOfDay.hour, timeOfDay.minute, 0, 0);
      return date;
    }
    // Only a time ("at 5"): today if it's still ahead, else tomorrow — worked
    // out again here, since chrono forwarded the unadjusted hour.
    const at = new Date(refDate);
    at.setHours(timeOfDay.hour, timeOfDay.minute, 0, 0);
    if (at.getTime() <= refDate.getTime()) at.setDate(at.getDate() + 1);
    return at;
  };

  let unparsedRecurrence = false;
  if (recur) {
    spans.push(recur.span);
    if (recur.extraSpan) spans.push(recur.extraSpan);
    // DTSTART: the date typed with the repeat ("tomorrow 3pm every week"), or
    // today; at the parsed time of day, or a 9am default.
    const dtstart = dateResult && !insideRepeat ? resolveDate(dateResult) : new Date(refDate);
    dtstart.setHours(timeOfDay?.hour ?? DEFAULT_RECUR_HOUR, timeOfDay?.minute ?? 0, 0, 0);
    const rule = new RRule({ ...recur.options, dtstart });
    const from = Math.max(refDate.getTime(), dtstart.getTime()) - 1000;
    const next = rule.after(new Date(from), true) ?? dtstart;
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
    const date = resolveDate(dateResult);
    if (timeOfDay) {
      scheduledAt = date.toISOString();
      parts.push(`scheduled ${chronoLabel(date, true)}`);
    } else {
      dueDate = date.toISOString();
      parts.push(`due ${chronoLabel(date, false)}`);
    }
  }

  const matched = !!recurrence || !!dateResult;
  const title = stripSpans(raw, spans, dateResult ? dateResult.index : null) || raw;
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

/** The confirmation's "scheduled Tomorrow, 3:00 PM" / "due Oct 16" (one grammar). */
function chronoLabel(date: Date, withTime: boolean): string {
  return withTime ? formatDayTime(date) : formatDay(date);
}
