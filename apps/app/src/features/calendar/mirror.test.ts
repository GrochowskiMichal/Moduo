// NOTE: TZ pinned before any Date math so the all-day local-midnight
// normalization is deterministic across machines.
process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { deletedExternalIds, mapGoogleEvent, mapOutlookEvent, mapProviderEvents } from "./mirror";

describe("mirror — Google provider→row mapper (AC12)", () => {
  it("maps a timed Google event to the mirror input shape", () => {
    const row = mapGoogleEvent({
      id: "g-evt-1",
      status: "confirmed",
      summary: "Standup",
      description: "daily sync",
      start: { dateTime: "2026-07-02T09:00:00+02:00" },
      end: { dateTime: "2026-07-02T09:30:00+02:00" },
      calendarId: "google:me@x.com:primary",
    });
    expect(row).toEqual({
      externalEventId: "g-evt-1",
      title: "Standup",
      startsAt: "2026-07-02T07:00:00.000Z", // +02:00 → UTC
      endsAt: "2026-07-02T07:30:00.000Z",
      allDay: false,
      rrule: null,
      status: "confirmed",
      description: "daily sync",
      calendarId: "google:me@x.com:primary",
    });
  });

  it("normalizes an all-day Google event to LOCAL midnight (no UTC day-spill)", () => {
    const row = mapGoogleEvent({
      id: "g-allday",
      summary: "Holiday",
      start: { date: "2026-07-02" },
      end: { date: "2026-07-03" },
    });
    expect(row?.allDay).toBe(true);
    // Warsaw is +02:00 in July → local midnight is 22:00 UTC the prior day.
    expect(row?.startsAt).toBe("2026-07-01T22:00:00.000Z");
    expect(row?.endsAt).toBe("2026-07-02T22:00:00.000Z");
  });

  it("extracts the RRULE line from Google's recurrence array", () => {
    const row = mapGoogleEvent({
      id: "g-rec",
      summary: "Weekly review",
      start: { dateTime: "2026-07-02T15:00:00Z" },
      end: { dateTime: "2026-07-02T16:00:00Z" },
      recurrence: ["EXDATE;...:20260709", "RRULE:FREQ=WEEKLY;BYDAY=TH"],
    });
    expect(row?.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
  });

  it("marks a cancelled Google event so the grid hides it", () => {
    const row = mapGoogleEvent({
      id: "g-cancelled",
      status: "cancelled",
      start: { dateTime: "2026-07-02T09:00:00Z" },
      end: { dateTime: "2026-07-02T09:30:00Z" },
    });
    expect(row?.status).toBe("cancelled");
  });

  it("drops an event with no id or no resolvable times", () => {
    expect(mapGoogleEvent({ summary: "no id" })).toBeNull();
    expect(mapGoogleEvent({ id: "x", start: {}, end: {} })).toBeNull();
  });

  it("is idempotent — same input maps to the same output (re-sync updates, never dupes)", () => {
    const raw = {
      id: "g-1",
      summary: "S",
      start: { dateTime: "2026-07-02T09:00:00Z" },
      end: { dateTime: "2026-07-02T09:30:00Z" },
    };
    expect(mapGoogleEvent(raw)).toEqual(mapGoogleEvent(raw));
  });
});

describe("mirror — Microsoft-Graph provider→row mapper (AC12)", () => {
  it("maps a timed Graph event (subject/times/bodyPreview)", () => {
    const row = mapOutlookEvent({
      id: "o-1",
      subject: "1:1",
      bodyPreview: "sync",
      isAllDay: false,
      isCancelled: false,
      start: { dateTime: "2026-07-02T11:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-07-02T11:30:00.0000000", timeZone: "UTC" },
    });
    expect(row).toMatchObject({
      externalEventId: "o-1",
      title: "1:1",
      allDay: false,
      status: "confirmed",
      description: "sync",
    });
    expect(row?.startsAt).toBe("2026-07-02T11:00:00.000Z");
  });

  it("converts a weekly Graph recurrence pattern to RRULE", () => {
    const row = mapOutlookEvent({
      id: "o-rec",
      subject: "Weekly",
      start: { dateTime: "2026-07-02T09:00:00.0000000" },
      end: { dateTime: "2026-07-02T09:30:00.0000000" },
      recurrence: {
        pattern: { type: "weekly", interval: 2, daysOfWeek: ["tuesday", "thursday"] },
      },
    });
    expect(row?.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH");
  });

  it("drops a naive Graph event tagged with a non-UTC zone (no silent shift)", () => {
    // Windows zone names can't be resolved here; a wrong-slot chip is worse than
    // a missing one (the desktop sync requests UTC, so this shouldn't occur).
    expect(
      mapOutlookEvent({
        id: "o-tz",
        subject: "PST meeting",
        start: { dateTime: "2026-07-02T09:00:00.0000000", timeZone: "Pacific Standard Time" },
        end: { dateTime: "2026-07-02T10:00:00.0000000", timeZone: "Pacific Standard Time" },
      }),
    ).toBeNull();
  });

  it("honors an explicit offset even without a UTC zone tag", () => {
    const row = mapOutlookEvent({
      id: "o-off",
      subject: "offset",
      start: { dateTime: "2026-07-02T09:00:00-07:00" },
      end: { dateTime: "2026-07-02T10:00:00-07:00" },
    });
    expect(row?.startsAt).toBe("2026-07-02T16:00:00.000Z");
  });

  it("marks a cancelled Graph event", () => {
    const row = mapOutlookEvent({
      id: "o-x",
      subject: "gone",
      isCancelled: true,
      start: { dateTime: "2026-07-02T09:00:00.0000000" },
      end: { dateTime: "2026-07-02T09:30:00.0000000" },
    });
    expect(row?.status).toBe("cancelled");
  });
});

describe("mirror — batch + deletion diff", () => {
  it("maps a batch and drops unmappable rows", () => {
    const rows = mapProviderEvents("google", [
      {
        id: "a",
        start: { dateTime: "2026-07-02T09:00:00Z" },
        end: { dateTime: "2026-07-02T10:00:00Z" },
      },
      { summary: "no id" },
    ]);
    expect(rows.map((r) => r.externalEventId)).toEqual(["a"]);
  });

  it("diffs vanished external ids for tombstoning", () => {
    expect(deletedExternalIds(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
  });
});
