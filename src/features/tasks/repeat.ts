// The repeat picker's rules (Tasks v3 call 27i): presets, a Custom rule
// (frequency, interval, days, the nth weekday, an end, on schedule or after
// completion) and the one plain summary line ("Every 3rd Friday, until
// Dec 15"). Rules are RRULE strings the server's engine and rrule.js both
// read (TV-D8); "after completion" is `mode` on the rule. Pure.

import { RRule, Weekday } from "rrule";

import { formatDate } from "@/lib/time-format";
import type { RecurrenceRule } from "./model";

export type RepeatFrequency = "daily" | "weekly" | "monthly" | "yearly";

/** Weekdays as RRULE writes them, Monday first. */
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekdayCode = (typeof WEEKDAYS)[number];

const WEEKDAY_NAMES: Record<WeekdayCode, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};
const WEEKDAY_SHORT: Record<WeekdayCode, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

/** What the Custom form edits. */
export type RepeatSpec = {
  frequency: RepeatFrequency;
  /** Every n days / weeks / months / years (1–999). */
  interval: number;
  /** Weekly: which days (empty = the anchor's day). */
  weekdays: WeekdayCode[];
  /** Monthly: on a day of the month, or on the nth weekday (-1 = the last). */
  monthly: { kind: "day"; day: number } | { kind: "nth"; nth: number; weekday: WeekdayCode };
  end: { kind: "never" } | { kind: "until"; day: string } | { kind: "count"; count: number };
  /** On the schedule, or counted from when it was done (27b). */
  afterCompletion: boolean;
};

const FREQ: Record<RepeatFrequency, number> = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
};

const weekdayOf = (code: WeekdayCode): Weekday => RRule[code];

const clampInt = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/** The RRULE body for a spec (no DTSTART line). */
export function specToRrule(spec: RepeatSpec): string {
  const opts: Partial<ConstructorParameters<typeof RRule>[0]> = {
    freq: FREQ[spec.frequency],
    interval: clampInt(spec.interval, 1, 999),
  };
  if (spec.frequency === "weekly" && spec.weekdays.length > 0) {
    opts.byweekday = spec.weekdays.map(weekdayOf);
  }
  if (spec.frequency === "monthly") {
    if (spec.monthly.kind === "day") opts.bymonthday = clampInt(spec.monthly.day, 1, 31);
    else opts.byweekday = [weekdayOf(spec.monthly.weekday).nth(spec.monthly.nth)];
  }
  if (spec.end.kind === "until") {
    // The last day it may come back, at its end (UTC, as the engines read it).
    opts.until = new Date(`${spec.end.day}T23:59:59Z`);
  } else if (spec.end.kind === "count") {
    opts.count = clampInt(spec.end.count, 1, 999);
  }
  const line = new RRule(opts)
    .toString()
    .split("\n")
    .find((l) => l.startsWith("RRULE:"));
  return (line ?? "").replace(/^RRULE:/, "");
}

/** The spec a stored rule reads as, or null when the form can't show it. */
export function rruleToSpec(rule: RecurrenceRule): RepeatSpec | null {
  let o: ReturnType<typeof RRule.parseString>;
  try {
    o = RRule.parseString(rule.rrule);
  } catch {
    return null;
  }
  const frequency = (Object.keys(FREQ) as RepeatFrequency[]).find((k) => FREQ[k] === o.freq);
  if (!frequency) return null;
  const days = (Array.isArray(o.byweekday) ? o.byweekday : o.byweekday != null ? [o.byweekday] : [])
    .map((d) => (typeof d === "number" ? new Weekday(d) : (d as Weekday | undefined)))
    .filter((d): d is Weekday => !!d);
  const code = (d: Weekday) => WEEKDAYS[d.weekday] as WeekdayCode;
  const monthDay = Array.isArray(o.bymonthday) ? o.bymonthday[0] : o.bymonthday;
  const nthDay = days.find((d) => d.n != null && d.n !== 0);
  return {
    frequency,
    interval: o.interval ?? 1,
    weekdays: frequency === "weekly" ? days.map(code) : [],
    monthly:
      frequency === "monthly" && nthDay
        ? { kind: "nth", nth: nthDay.n as number, weekday: code(nthDay) }
        : { kind: "day", day: typeof monthDay === "number" ? monthDay : 1 },
    end: o.until
      ? { kind: "until", day: o.until.toISOString().slice(0, 10) }
      : o.count
        ? { kind: "count", count: o.count }
        : { kind: "never" },
    afterCompletion: rule.mode === "after_completion",
  };
}

/** A rule from a spec, anchored to the task's next date (or 9:00 AM today). */
export function ruleFromSpec(spec: RepeatSpec, anchorIso?: string | null): RecurrenceRule {
  const dtstart = anchorIso ? new Date(anchorIso) : nineToday();
  const rrule = specToRrule(spec);
  let next: Date = dtstart;
  try {
    const rule = new RRule({ ...RRule.parseString(rrule), dtstart });
    next = rule.after(new Date(dtstart.getTime() - 1000), true) ?? dtstart;
  } catch {
    // An unreadable rule never reaches here (the spec writes it); keep the anchor.
  }
  return {
    rrule,
    dtstart: dtstart.toISOString(),
    nextOccurrence: next.toISOString(),
    ...(spec.afterCompletion ? { mode: "after_completion" as const } : {}),
  };
}

function nineToday(): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d;
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th"];
const ordinal = (n: number) => (n === -1 ? "last" : (ORDINAL[n] ?? `${n}th`));
const plural = (n: number, word: string) => (n === 1 ? word : `${n} ${word}s`);

/** "1st" … "31st" for a day of the month. */
function dayOrdinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

/**
 * The one plain line a rule reads as: "Every day", "Every 2 weeks on Mon,
 * Wed", "Every 3rd Friday, until Dec 15", "Monthly on the 15th, 10 times",
 * "Every 7 days after it's done".
 */
export function repeatSummary(rule: RecurrenceRule, now: Date = new Date()): string {
  const spec = rruleToSpec(rule);
  if (!spec) return "Repeats";
  const n = spec.interval;
  let line: string;
  switch (spec.frequency) {
    case "daily":
      line = n === 1 ? "Every day" : `Every ${plural(n, "day")}`;
      break;
    case "weekly": {
      const days = [...spec.weekdays].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
      const weekdaysOnly =
        days.length === 5 && ["MO", "TU", "WE", "TH", "FR"].every((d) => days.includes(d as WeekdayCode));
      if (n === 1 && weekdaysOnly) line = "Every weekday";
      else if (n === 1 && days.length === 1) line = `Every ${WEEKDAY_NAMES[days[0] as WeekdayCode]}`;
      else {
        const base = n === 1 ? "Every week" : `Every ${plural(n, "week")}`;
        line = days.length > 0 ? `${base} on ${days.map((d) => WEEKDAY_SHORT[d]).join(", ")}` : base;
      }
      break;
    }
    case "monthly": {
      if (spec.monthly.kind === "nth") {
        const what = `${ordinal(spec.monthly.nth)} ${WEEKDAY_NAMES[spec.monthly.weekday]}`;
        line = n === 1 ? `Every ${what}` : `Every ${plural(n, "month")} on the ${what}`;
      } else {
        const day = dayOrdinal(spec.monthly.day);
        line = n === 1 ? `Monthly on the ${day}` : `Every ${plural(n, "month")} on the ${day}`;
      }
      break;
    }
    case "yearly":
      line = n === 1 ? "Every year" : `Every ${plural(n, "year")}`;
      break;
  }
  if (spec.afterCompletion) line += " after it’s done";
  if (spec.end.kind === "until") {
    line += `, until ${formatDate(`${spec.end.day}T12:00:00`, now)}`;
  } else if (spec.end.kind === "count") {
    line += `, ${spec.end.count === 1 ? "once" : `${spec.end.count} times`}`;
  }
  return line;
}

/** A Custom form's starting point: the task's rule, else weekly on today's weekday. */
export function defaultSpec(rule: RecurrenceRule | null, now: Date = new Date()): RepeatSpec {
  const fromRule = rule ? rruleToSpec(rule) : null;
  if (fromRule) return fromRule;
  const today = WEEKDAYS[(now.getDay() + 6) % 7] as WeekdayCode;
  return {
    frequency: "weekly",
    interval: 1,
    weekdays: [today],
    monthly: { kind: "day", day: now.getDate() },
    end: { kind: "never" },
    afterCompletion: false,
  };
}
