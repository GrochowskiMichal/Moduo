// DF-7 — the pure snippet formatters. Relative phrasing is pinned to an injected
// `now`; day/clock assertions are written TZ-robustly (equal-offset UTC-midday
// dates preserve the calendar-day delta in every timezone, and clock/month-day
// text is matched structurally rather than to an exact wall-clock string).

import { describe, expect, it } from "vitest";
import {
  formatEmailSnippet,
  formatEventSnippet,
  formatNoteSnippet,
  formatTaskSnippet,
  relativeDayLabel,
  relativeTimeAgo,
} from "./snippet-format";
import type {
  EmailSnippetMeta,
  EventSnippetMeta,
  NoteSnippetMeta,
  TaskSnippetMeta,
} from "./snippet-projectors";

const NOW = new Date("2026-07-15T12:00:00Z"); // Wednesday, midday UTC
const DAY = 86_400_000;
/** Same wall-clock instant N days from NOW — preserves the calendar-day delta in any TZ. */
const dayOffset = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString();

const task = (over: Partial<TaskSnippetMeta>): TaskSnippetMeta => ({
  kind: "task",
  status: "todo",
  dueDate: null,
  ...over,
});

describe("formatTaskSnippet", () => {
  it("shows status + a due caption", () => {
    expect(formatTaskSnippet(task({ status: "todo", dueDate: dayOffset(1) }), NOW)).toBe("To do · due tomorrow");
    expect(formatTaskSnippet(task({ status: "in_progress", dueDate: dayOffset(0) }), NOW)).toBe(
      "In progress · due today",
    );
  });

  it("shows status alone when there is no due date", () => {
    expect(formatTaskSnippet(task({ status: "in_progress" }), NOW)).toBe("In progress");
    expect(formatTaskSnippet(task({ status: "todo" }), NOW)).toBe("To do");
  });

  it("suppresses the due caption on finished tasks", () => {
    expect(formatTaskSnippet(task({ status: "done", dueDate: dayOffset(-2) }), NOW)).toBe("Done");
    expect(formatTaskSnippet(task({ status: "archived", dueDate: dayOffset(3) }), NOW)).toBe("Archived");
  });

  it("returns null when there is nothing to say (unknown status, no due)", () => {
    expect(formatTaskSnippet(task({ status: "weird-custom" }), NOW)).toBeNull();
  });
});

describe("formatNoteSnippet", () => {
  const note = (over: Partial<NoteSnippetMeta>): NoteSnippetMeta => ({
    kind: "note",
    updatedAt: dayOffset(-3),
    isPinned: false,
    isArchived: false,
    ...over,
  });

  it("reads recency (the list carries no body)", () => {
    expect(formatNoteSnippet(note({}), NOW)).toBe("Edited 3 days ago");
  });

  it("prefixes a pinned / archived state", () => {
    expect(formatNoteSnippet(note({ isPinned: true }), NOW)).toBe("Pinned · Edited 3 days ago");
    expect(formatNoteSnippet(note({ isArchived: true }), NOW)).toBe("Archived · Edited 3 days ago");
  });
});

describe("formatEventSnippet", () => {
  const ev = (over: Partial<EventSnippetMeta>): EventSnippetMeta => ({
    kind: "event",
    startsAt: dayOffset(1),
    endsAt: dayOffset(1),
    allDay: false,
    ...over,
  });

  it("renders an all-day event as just the day", () => {
    expect(formatEventSnippet(ev({ allDay: true, startsAt: dayOffset(1) }), NOW)).toBe("Tomorrow");
    expect(formatEventSnippet(ev({ allDay: true, startsAt: dayOffset(0) }), NOW)).toBe("Today");
  });

  it("appends a clock time for a timed event", () => {
    const out = formatEventSnippet(ev({ startsAt: dayOffset(1) }), NOW);
    expect(out).toMatch(/^Tomorrow, .+/);
  });

  it("returns null with no start", () => {
    expect(formatEventSnippet(ev({ startsAt: "" }), NOW)).toBeNull();
  });
});

describe("formatEmailSnippet", () => {
  const email = (over: Partial<EmailSnippetMeta>): EmailSnippetMeta => ({ kind: "email", ...over });

  it("prefers a body preview", () => {
    expect(formatEmailSnippet(email({ preview: "Quick question about Q3" }), NOW)).toBe("Quick question about Q3");
  });

  it("falls back to received recency", () => {
    expect(formatEmailSnippet(email({ receivedAt: dayOffset(-1) }), NOW)).toBe("Received 1 day ago");
  });

  it("returns null when the module supplied nothing (desktop-only on web)", () => {
    expect(formatEmailSnippet(email({}), NOW)).toBeNull();
  });
});

describe("relativeDayLabel", () => {
  it("names today / tomorrow / yesterday", () => {
    expect(relativeDayLabel(dayOffset(0), NOW)).toBe("today");
    expect(relativeDayLabel(dayOffset(1), NOW)).toBe("tomorrow");
    expect(relativeDayLabel(dayOffset(-1), NOW)).toBe("yesterday");
  });

  it("uses a weekday name within the coming week", () => {
    expect(relativeDayLabel(dayOffset(3), NOW)).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/);
  });

  it("falls back to an absolute date beyond a week", () => {
    // Locale-robust: the exact month-day text is `toLocaleDateString`-formatted
    // (ICU-locale dependent), so assert only that it left the near-term/weekday
    // vocabulary — a non-empty label that isn't a relative word or weekday.
    const label = relativeDayLabel(dayOffset(20), NOW);
    expect(label).toBeTruthy();
    expect(label).not.toMatch(/^(today|tomorrow|yesterday)$/);
    expect(label).not.toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/);
  });
});

describe("relativeTimeAgo", () => {
  it("reads recent / past / future", () => {
    expect(relativeTimeAgo(new Date(NOW.getTime() - 10_000).toISOString(), NOW)).toBe("just now");
    expect(relativeTimeAgo(new Date(NOW.getTime() - 2 * 3_600_000).toISOString(), NOW)).toBe("2 hours ago");
    expect(relativeTimeAgo(new Date(NOW.getTime() + 3 * 3_600_000).toISOString(), NOW)).toBe("in 3 hours");
  });
});
