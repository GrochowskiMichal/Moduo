// The web runtime's event writes and row mapping for event data v2 (CALR-6,
// specs/calendar-rethink.md). The new op arguments are sent only when set, so
// an app on this build keeps creating events against a database that still
// has the old 7-argument calendar_op_event_create (PostgREST matches by name).

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import { webCalendar } from "./runtime.web.calendar";

const h = rs.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  row: {} as Record<string, unknown>,
}));

rs.mock("./runtime.web.client", () => ({
  supabaseClient: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.calls.push({ fn, args });
      return Promise.resolve({ data: h.row, error: null });
    },
  },
}));

const BASE_ROW = {
  id: "e1",
  workspace_id: "w",
  owner_id: "u",
  source_account_id: null,
  external_event_id: null,
  calendar_id: "moduo",
  title: "Investor prep",
  description: "",
  start_time: "2026-11-05T09:00:00Z",
  end_time: "2026-11-05T10:30:00Z",
  all_day: false,
  recurrence_rule: null,
  status: "confirmed",
  location: null,
  color: null,
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:00Z",
  deleted_at: null,
};

beforeEach(() => {
  h.calls.length = 0;
  h.row = { ...BASE_ROW };
});

const LEGACY_KEYS = [
  "p_all_day",
  "p_description",
  "p_ends_at",
  "p_rrule",
  "p_starts_at",
  "p_title",
  "p_workspace_id",
];

describe("webCalendar.createEvent (CALR-6)", () => {
  it("sends only the old arguments when no new field is set", async () => {
    await webCalendar.createEvent({
      workspaceId: "w",
      title: "Investor prep",
      startsAt: "2026-11-05T09:00:00Z",
      endsAt: "2026-11-05T10:30:00Z",
    });
    expect(h.calls[0]?.fn).toBe("calendar_op_event_create");
    expect(Object.keys(h.calls[0]?.args ?? {}).sort()).toEqual(LEGACY_KEYS);
  });

  it("sends calendar, place, people, link, privacy, kind and focus task when given", async () => {
    await webCalendar.createEvent({
      workspaceId: "w",
      title: "Investor prep",
      startsAt: "2026-11-05T09:00:00Z",
      endsAt: "2026-11-05T10:30:00Z",
      calendarId: "cal-work",
      location: "Hale & Co",
      attendees: [{ email: "priya@example.com", name: "Priya" }],
      conferenceUrl: "https://meet.google.com/abc-defg-hij",
      conferenceProvider: "google_meet",
      isPrivate: true,
      kind: "focus",
      focusTaskId: "t1",
    });
    expect(h.calls[0]?.args).toMatchObject({
      p_calendar_id: "cal-work",
      p_location: "Hale & Co",
      p_attendees: [{ email: "priya@example.com", name: "Priya" }],
      p_conference_url: "https://meet.google.com/abc-defg-hij",
      p_conference_provider: "google_meet",
      p_is_private: true,
      p_kind: "focus",
      p_focus_task_id: "t1",
    });
  });

  it("leaves out each field that is not set, one at a time", async () => {
    await webCalendar.createEvent({
      workspaceId: "w",
      title: "Lunch",
      startsAt: "2026-11-05T12:00:00Z",
      endsAt: "2026-11-05T13:00:00Z",
      location: "Café Lisboa",
    });
    expect(Object.keys(h.calls[0]?.args ?? {}).sort()).toEqual(
      [...LEGACY_KEYS, "p_location"].sort(),
    );
  });
});

describe("webCalendar.updateEvent (CALR-6)", () => {
  it("passes the new patch keys through as they are", async () => {
    await webCalendar.updateEvent({
      workspaceId: "w",
      eventId: "e1",
      patch: { calendarId: null, conferenceUrl: null, isPrivate: true, location: "Room 4" },
    });
    expect(h.calls[0]).toEqual({
      fn: "calendar_op_event_update",
      args: {
        p_workspace_id: "w",
        p_event_id: "e1",
        p_patch: { calendarId: null, conferenceUrl: null, isPrivate: true, location: "Room 4" },
      },
    });
  });
});

describe("calendar event rows → model (CALR-6)", () => {
  it("maps the v2 columns", async () => {
    h.row = {
      ...BASE_ROW,
      calendar_ref: "cal-work",
      location: "Hale & Co",
      is_private: true,
      conference_url: "https://zoom.us/j/1",
      conference_provider: "zoom",
      kind: "focus",
      focus_task_id: "t1",
      attendees: [{ email: "priya@example.com", name: "Priya", status: "accepted" }],
    };
    const event = await webCalendar.createEvent({
      workspaceId: "w",
      title: "Investor prep",
      startsAt: "2026-11-05T09:00:00Z",
      endsAt: "2026-11-05T10:30:00Z",
    });
    expect(event).toMatchObject({
      calendarRef: "cal-work",
      location: "Hale & Co",
      isPrivate: true,
      conferenceUrl: "https://zoom.us/j/1",
      conferenceProvider: "zoom",
      kind: "focus",
      focusTaskId: "t1",
      attendees: [{ email: "priya@example.com", name: "Priya", status: "accepted" }],
    });
  });

  it("reads a row from before the migration with the v2 defaults", async () => {
    const event = await webCalendar.createEvent({
      workspaceId: "w",
      title: "Investor prep",
      startsAt: "2026-11-05T09:00:00Z",
      endsAt: "2026-11-05T10:30:00Z",
    });
    expect(event).toMatchObject({
      calendarRef: null,
      isPrivate: false,
      conferenceUrl: null,
      conferenceProvider: null,
      kind: "event",
      focusTaskId: null,
      attendees: [],
    });
  });

  it("reads an unknown kind as a plain event and drops malformed people", async () => {
    h.row = {
      ...BASE_ROW,
      kind: "meeting",
      attendees: [{ email: "kai@example.com" }, { name: "no email" }, "junk"],
    };
    const event = await webCalendar.createEvent({
      workspaceId: "w",
      title: "Investor prep",
      startsAt: "2026-11-05T09:00:00Z",
      endsAt: "2026-11-05T10:30:00Z",
    });
    expect(event.kind).toBe("event");
    expect(event.attendees).toEqual([
      { email: "kai@example.com", name: "", status: "needsAction" },
    ]);
  });
});
