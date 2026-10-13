// Connective-tissue spine — pure snippet formatters (DF-7).
//
// Turn a module's live `HubSnippetMeta` into the one-line preview a hub row
// shows next to the entity name: a task's "In progress · due Fri", a note's
// "Edited 3 days ago", an event's "Tomorrow, 2:00 PM". Pure + runtime-free (no
// `new Date()` — `now` is injected) so snippet-format.test.ts can pin every
// relative phrase. snippet-projectors.builtin.ts wires these to the registry.

import { isOpenTaskStatus } from "@contracts/vocabularies";
import type {
  EmailSnippetMeta,
  EventSnippetMeta,
  NoteSnippetMeta,
  TaskSnippetMeta,
} from "./snippet-projectors";

const DAY_MS = 86_400_000;

/** Sentence-case labels for the fixed task lifecycle statuses. */
const TASK_STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  archived: "Archived",
};

/** Whole-day delta between two instants by LOCAL calendar date (today = 0). */
function calendarDayDelta(target: Date, now: Date): number {
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / DAY_MS);
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A calm relative day label for a due/when date: "today" · "tomorrow" ·
 * "yesterday" · a weekday within the coming week ("Fri") · else a month-day
 * ("Jul 18"). Case-neutral so callers can prefix ("due …", "When: …").
 */
export function relativeDayLabel(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const delta = calendarDayDelta(then, now);
  if (delta === 0) return "today";
  if (delta === 1) return "tomorrow";
  if (delta === -1) return "yesterday";
  // Within the next 6 days, a weekday name reads fastest ("Fri").
  if (delta > 1 && delta < 7) return WEEKDAY[then.getDay()];
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A quiet "…ago"/"in…" clock label for recency ("just now" · "3 days ago"). */
export function relativeTimeAgo(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const ms = now.getTime() - then;
  const abs = Math.abs(ms);
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) {
    const m = Math.floor(abs / 60_000);
    return ms >= 0
      ? `${m} ${m === 1 ? "minute" : "minutes"} ago`
      : `in ${m} ${m === 1 ? "minute" : "minutes"}`;
  }
  if (abs < DAY_MS) {
    const h = Math.floor(abs / 3_600_000);
    return ms >= 0
      ? `${h} ${h === 1 ? "hour" : "hours"} ago`
      : `in ${h} ${h === 1 ? "hour" : "hours"}`;
  }
  if (abs < 30 * DAY_MS) {
    const d = Math.floor(abs / DAY_MS);
    return ms >= 0 ? `${d} ${d === 1 ? "day" : "days"} ago` : `in ${d} ${d === 1 ? "day" : "days"}`;
  }
  return `on ${iso.slice(0, 10)}`;
}

/** "2:00 PM" from a timestamptz (local clock). */
function clockLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Task row snippet: the status, plus a due caption when set. Done/archived tasks
 * read just their status (a due date on a finished task is noise). A live-status
 * row is more useful than the bare title the registry gave us.
 *   todo + due tomorrow → "To do · due tomorrow"
 *   in_progress, no due → "In progress"
 *   done               → "Done"
 */
export function formatTaskSnippet(meta: TaskSnippetMeta, now: Date): string | null {
  const statusLabel = TASK_STATUS_LABEL[meta.status] ?? null;
  const finished = !isOpenTaskStatus(meta.status);
  const parts: string[] = [];
  if (statusLabel) parts.push(statusLabel);
  if (!finished && meta.dueDate) {
    const due = relativeDayLabel(meta.dueDate, now);
    if (due) parts.push(`due ${due}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Note row snippet. The v2 list carries no body, so the honest preview is
 * recency ("Edited 3 days ago"), with a "Pinned"/"Archived" state prefix. A
 * body excerpt would need a per-note fetch (an N-fan-out the roll-up forbids).
 */
export function formatNoteSnippet(meta: NoteSnippetMeta, now: Date): string | null {
  const edited = meta.updatedAt ? `Edited ${relativeTimeAgo(meta.updatedAt, now)}` : null;
  if (meta.isArchived) return edited ? `Archived · ${edited}` : "Archived";
  if (meta.isPinned) return edited ? `Pinned · ${edited}` : "Pinned";
  return edited;
}

/**
 * Event row snippet: the "when". All-day events drop the clock; timed events
 * append it ("Tomorrow, 2:00 PM"). Relative for the near term, month-day beyond.
 */
export function formatEventSnippet(meta: EventSnippetMeta, now: Date): string | null {
  if (!meta.startsAt) return null;
  const start = new Date(meta.startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const day = relativeDayLabel(meta.startsAt, now);
  // Capitalize a leading relative word ("today" → "Today") for a standalone caption.
  const dayLabel = day ? day.charAt(0).toUpperCase() + day.slice(1) : "";
  if (meta.allDay) return dayLabel || null;
  return dayLabel ? `${dayLabel}, ${clockLabel(start)}` : clockLabel(start);
}

/**
 * Email row snippet. The registry label is already the subject (the title), so
 * the snippet adds a body preview when the module supplies one, else a "Received
 * …" recency. On web (email is desktop-only) meta is usually absent → null.
 */
export function formatEmailSnippet(meta: EmailSnippetMeta, now: Date): string | null {
  const preview = meta.preview?.trim();
  if (preview) return preview;
  if (meta.receivedAt) return `Received ${relativeTimeAgo(meta.receivedAt, now)}`;
  return null;
}
