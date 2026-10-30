// An event's trail in words, for the panel's feed: "created this", "changed
// the time and place", "moved one occurrence". Links, comments and bookings
// read as the spine says them. Pure.

import { spineActivityLine } from "../spine/activity";

type Entry = { op: string; payload?: Record<string, unknown> | null };

/** The words for a changed key of `calendar_op_event_update`'s patch. */
const KEY_WORDS: Record<string, string> = {
  title: "title",
  starts_at: "time",
  ends_at: "time",
  start_time: "time",
  end_time: "time",
  startsAt: "time",
  endsAt: "time",
  all_day: "all day",
  allDay: "all day",
  location: "place",
  description: "description",
  rrule: "repeat",
  recurrence: "repeat",
  is_private: "privacy",
  isPrivate: "privacy",
  calendar_ref: "calendar",
  calendarId: "calendar",
  attendees: "people",
  conference_url: "meeting link",
  conferenceUrl: "meeting link",
  conferenceProvider: "meeting link",
  meet: "meeting link",
  color: "color",
  kind: "kind",
  focusTaskId: "focus task",
};

/** "the time and place" · "the title, time and 2 more". */
function changedLine(payload: Record<string, unknown>): string {
  const keys = Array.isArray(payload.keys)
    ? payload.keys.filter((k): k is string => typeof k === "string")
    : [];
  const words: string[] = [];
  for (const k of keys) {
    const w = KEY_WORDS[k];
    if (w && !words.includes(w)) words.push(w);
  }
  if (words.length === 0) return "made changes";
  if (words.length === 1) return `changed the ${words[0]}`;
  if (words.length <= 3) {
    return `changed the ${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  }
  return `changed the ${words.slice(0, 2).join(", ")} and ${words.length - 2} more`;
}

export function calendarActivityLine(entry: Entry): string {
  const p = entry.payload ?? {};
  switch (entry.op) {
    case "calendar.event_create":
    case "calendar.create":
      return "created this";
    case "calendar.event_update":
    case "calendar.edit":
      return changedLine(p);
    case "calendar.event_delete":
      return "deleted this";
    case "calendar.event_restore":
      return "restored this";
    case "calendar.occurrence_update":
      return "changed one occurrence";
    case "calendar.occurrence_delete":
      return "removed one occurrence";
    case "calendar.occurrence_restore":
      return "brought back one occurrence";
    case "calendar.offer_create":
      return "offered times";
    case "calendar.offer_release":
      return "released the held times";
    default: {
      const line = spineActivityLine(entry);
      // An op nobody has words for yet reads plainly, never as its code.
      return line === entry.op ? "made changes" : line;
    }
  }
}
