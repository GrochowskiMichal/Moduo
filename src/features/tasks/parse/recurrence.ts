// Simple recurrence presets for the capture modal's recurrence pill. Deliberately
// NOT a full RRULE builder (spec §7: "no complex recurrence picker in v1") — just
// the common cadences, plus a human label for whatever recurrence is currently
// set (parsed or chosen).

import { RRule } from "rrule";

import type { RecurrenceRule } from "../model";

export type RecurrencePreset = "daily" | "weekdays" | "weekly" | "monthly";

export const RECURRENCE_PRESETS: Array<{ value: RecurrencePreset; label: string }> = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

const DEFAULT_RECUR_HOUR = 9; // 9:00 AM local when there's no anchor time

function presetOptions(preset: RecurrencePreset) {
  switch (preset) {
    case "daily":
      return { freq: RRule.DAILY, interval: 1 };
    case "weekdays":
      return { freq: RRule.WEEKLY, byweekday: [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR] };
    case "weekly":
      return { freq: RRule.WEEKLY, interval: 1 };
    case "monthly":
      return { freq: RRule.MONTHLY, interval: 1 };
  }
}

function rruleBody(rule: RRule): string {
  const line = rule
    .toString()
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.startsWith("RRULE:"));
  return line ? line.slice("RRULE:".length) : rule.toString().replace(/^RRULE:/, "");
}

/** Build a RecurrenceRule from a preset, anchored to a scheduled time or 9am today. */
export function recurrenceFromPreset(
  preset: RecurrencePreset,
  anchorIso?: string | null,
): RecurrenceRule {
  let dtstart: Date;
  if (anchorIso) {
    dtstart = new Date(anchorIso);
  } else {
    dtstart = new Date();
    dtstart.setHours(DEFAULT_RECUR_HOUR, 0, 0, 0);
  }
  const rule = new RRule({ ...presetOptions(preset), dtstart });
  const next = rule.after(new Date(dtstart.getTime() - 1000), true) ?? dtstart;
  return {
    rrule: rruleBody(rule),
    dtstart: dtstart.toISOString(),
    nextOccurrence: next.toISOString(),
  };
}

/** Human label for a recurrence (e.g. "every day"), for display on the pill. */
export function recurrenceLabel(recurrence: RecurrenceRule): string {
  try {
    return RRule.fromString(recurrence.rrule).toText();
  } catch {
    return "Repeats";
  }
}
