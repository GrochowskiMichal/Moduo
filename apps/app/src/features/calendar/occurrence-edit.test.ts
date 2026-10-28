// AC44 (CALR-11, K15): moving, editing or deleting one occurrence of a repeating
// event asks "This event / All events". This event changes only that occurrence,
// in Moduo (an override row, or an exdate on the series) and in Google (the
// instance id); All events changes the series (Google: its recurringEventId).
// Here, the pure parts: who is asked, what each answer writes, how the week
// draws an override, and what the Google mirror keeps of an instance.

process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { type CalendarEventModel, eventChipsInRange } from "./events";
import { mapGoogleEvent } from "./mirror";
import { isRepeatOccurrence, occurrenceScopeChoices, planOccurrenceWrite } from "./occurrence-edit";

function event(over: Partial<CalendarEventModel> = {}): CalendarEventModel {
  return {
    id: "ev-1",
    workspaceId: "w1",
    ownerId: "u1",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Standup",
    description: "",
    startsAt: "2026-11-02T08:00:00.000Z", // Mon 09:00 Warsaw
    endsAt: "2026-11-02T08:30:00.000Z",
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: "2026-10-28T08:00:00Z",
    updatedAt: "2026-10-28T08:00:00Z",
    deletedAt: null,
    ...over,
  };
}

const SERIES = event({ id: "series-1", rrule: "FREQ=DAILY" });
/** Wednesday's occurrence, moved from 09:00 to 10:00 (This event). */
const OVERRIDE = event({
  id: "ov-1",
  title: "Standup (late)",
  seriesId: "series-1",
  originalStart: "2026-11-04T08:00:00.000Z",
  startsAt: "2026-11-04T09:00:00.000Z",
  endsAt: "2026-11-04T09:30:00.000Z",
});
const ONE_OFF = event({ id: "lunch", title: "Lunch" });
const GOOGLE_INSTANCE = event({
  id: "row-g",
  sourceAccountId: "acc-g",
  externalEventId: "g-weekly_20261103T080000Z",
  externalSeriesId: "g-weekly",
  originalStart: "2026-11-03T08:00:00.000Z",
  calendarId: "google:me@x.com:primary",
  title: "Design review",
  startsAt: "2026-11-03T08:00:00.000Z",
  endsAt: "2026-11-03T09:00:00.000Z",
});
const GOOGLE_ONE_OFF = event({
  id: "row-g1",
  sourceAccountId: "acc-g",
  externalEventId: "g-board",
  calendarId: "google:me@x.com:primary",
});

/** Thursday's occurrence of SERIES (09:00 Warsaw = 08:00Z). */
const THURSDAY_MS = Date.parse("2026-11-05T08:00:00.000Z");
const HOUR = 3_600_000;

describe("who is asked This event / All events", () => {
  it("a series, an override and a Google instance are occurrences of a repeat", () => {
    expect(isRepeatOccurrence(SERIES)).toBe(true);
    expect(isRepeatOccurrence(OVERRIDE)).toBe(true);
    expect(isRepeatOccurrence(GOOGLE_INSTANCE)).toBe(true);
    expect(isRepeatOccurrence(ONE_OFF)).toBe(false);
    expect(isRepeatOccurrence(GOOGLE_ONE_OFF)).toBe(false);
  });

  it("an event that doesn't repeat is never asked", () => {
    const move = { kind: "patch" as const, patch: { startsAt: "x", endsAt: "y" } };
    expect(occurrenceScopeChoices(ONE_OFF, move).ask).toBe(false);
    expect(occurrenceScopeChoices(GOOGLE_ONE_OFF, { kind: "delete" }).ask).toBe(false);
  });

  it("a Moduo repeat asks, with both answers, for a move, an edit and a delete", () => {
    for (const ev of [SERIES, OVERRIDE]) {
      for (const change of [
        { kind: "patch" as const, patch: { startsAt: "x", endsAt: "y" } },
        { kind: "patch" as const, patch: { title: "Retro" } },
        { kind: "delete" as const },
      ]) {
        expect(occurrenceScopeChoices(ev, change)).toEqual({ ask: true, allEvents: true });
      }
    }
  });

  it("a Google repeat asks too; All events covers edits and deletes but not a time move yet", () => {
    expect(
      occurrenceScopeChoices(GOOGLE_INSTANCE, { kind: "patch", patch: { title: "Retro" } }),
    ).toEqual({ ask: true, allEvents: true });
    expect(occurrenceScopeChoices(GOOGLE_INSTANCE, { kind: "delete" })).toEqual({
      ask: true,
      allEvents: true,
    });
    for (const patch of [
      { startsAt: "2026-11-03T09:00:00.000Z", endsAt: "2026-11-03T10:00:00.000Z" },
      { endsAt: "2026-11-03T10:00:00.000Z" },
      { allDay: true },
    ]) {
      expect(occurrenceScopeChoices(GOOGLE_INSTANCE, { kind: "patch", patch })).toEqual({
        ask: true,
        allEvents: false,
      });
    }
  });
});

describe("what This event writes (AC44)", () => {
  it("a plain occurrence of a Moduo series becomes an override at its original start", () => {
    const patch = {
      startsAt: new Date(THURSDAY_MS + HOUR).toISOString(),
      endsAt: new Date(THURSDAY_MS + HOUR + 30 * 60_000).toISOString(),
    };
    expect(
      planOccurrenceWrite({
        event: SERIES,
        occurrenceStartMs: THURSDAY_MS,
        scope: "this",
        change: { kind: "patch", patch },
      }),
    ).toEqual({
      kind: "occurrence-update",
      seriesId: "series-1",
      originalStart: "2026-11-05T08:00:00.000Z",
      patch,
    });
  });

  it("deleting a plain occurrence skips it on the series", () => {
    expect(
      planOccurrenceWrite({
        event: SERIES,
        occurrenceStartMs: THURSDAY_MS,
        scope: "this",
        change: { kind: "delete" },
      }),
    ).toEqual({
      kind: "occurrence-delete",
      seriesId: "series-1",
      originalStart: "2026-11-05T08:00:00.000Z",
    });
  });

  it("an occurrence already changed is edited in place", () => {
    expect(
      planOccurrenceWrite({
        event: OVERRIDE,
        series: SERIES,
        occurrenceStartMs: Date.parse(OVERRIDE.startsAt),
        scope: "this",
        change: { kind: "patch", patch: { title: "Standup (moved)" } },
      }),
    ).toEqual({ kind: "event-update", eventId: "ov-1", patch: { title: "Standup (moved)" } });
  });

  it("and deleted by the occurrence it replaced, so the series doesn't draw it back", () => {
    expect(
      planOccurrenceWrite({
        event: OVERRIDE,
        series: SERIES,
        occurrenceStartMs: Date.parse(OVERRIDE.startsAt),
        scope: "this",
        change: { kind: "delete" },
      }),
    ).toEqual({
      kind: "occurrence-delete",
      seriesId: "series-1",
      originalStart: "2026-11-04T08:00:00.000Z",
    });
  });

  it("Google gets the instance id", () => {
    const patch = {
      startsAt: "2026-11-03T09:00:00.000Z",
      endsAt: "2026-11-03T10:00:00.000Z",
    };
    expect(
      planOccurrenceWrite({
        event: GOOGLE_INSTANCE,
        occurrenceStartMs: Date.parse(GOOGLE_INSTANCE.startsAt),
        scope: "this",
        change: { kind: "patch", patch },
      }),
    ).toEqual({ kind: "google-update", externalEventId: "g-weekly_20261103T080000Z", patch });
    expect(
      planOccurrenceWrite({
        event: GOOGLE_INSTANCE,
        occurrenceStartMs: Date.parse(GOOGLE_INSTANCE.startsAt),
        scope: "this",
        change: { kind: "delete" },
      }),
    ).toEqual({ kind: "google-delete", externalEventId: "g-weekly_20261103T080000Z" });
  });
});

describe("what All events writes", () => {
  it("a move of one occurrence moves the series anchor by the same amount", () => {
    expect(
      planOccurrenceWrite({
        event: SERIES,
        occurrenceStartMs: THURSDAY_MS,
        scope: "all",
        change: {
          kind: "patch",
          patch: {
            startsAt: new Date(THURSDAY_MS + HOUR).toISOString(),
            endsAt: new Date(THURSDAY_MS + 2 * HOUR).toISOString(),
          },
        },
      }),
    ).toEqual({
      kind: "event-update",
      eventId: "series-1",
      // Start an hour later; the end an hour and a half later (a 30-min event made 60).
      patch: { startsAt: "2026-11-02T09:00:00.000Z", endsAt: "2026-11-02T10:00:00.000Z" },
    });
  });

  it("an edit that isn't a time goes to the series as it is", () => {
    expect(
      planOccurrenceWrite({
        event: SERIES,
        occurrenceStartMs: THURSDAY_MS,
        scope: "all",
        change: { kind: "patch", patch: { title: "Daily standup", isPrivate: true } },
      }),
    ).toEqual({
      kind: "event-update",
      eventId: "series-1",
      patch: { title: "Daily standup", isPrivate: true },
    });
  });

  it("from a changed occurrence, the series moves by how far that occurrence moved", () => {
    expect(
      planOccurrenceWrite({
        event: OVERRIDE,
        series: SERIES,
        occurrenceStartMs: Date.parse(OVERRIDE.startsAt),
        scope: "all",
        change: {
          kind: "patch",
          patch: { startsAt: "2026-11-04T09:15:00.000Z", endsAt: "2026-11-04T09:45:00.000Z" },
        },
      }),
    ).toEqual({
      kind: "event-update",
      eventId: "series-1",
      patch: { startsAt: "2026-11-02T08:15:00.000Z", endsAt: "2026-11-02T08:45:00.000Z" },
    });
  });

  it("deleting all events deletes the series, from any occurrence", () => {
    for (const [ev, at] of [
      [SERIES, THURSDAY_MS],
      [OVERRIDE, Date.parse(OVERRIDE.startsAt)],
    ] as const) {
      expect(
        planOccurrenceWrite({
          event: ev,
          series: SERIES,
          occurrenceStartMs: at,
          scope: "all",
          change: { kind: "delete" },
        }),
      ).toEqual({ kind: "event-delete", eventId: "series-1" });
    }
  });

  it("a Google repeat's series is its recurringEventId", () => {
    expect(
      planOccurrenceWrite({
        event: GOOGLE_INSTANCE,
        occurrenceStartMs: Date.parse(GOOGLE_INSTANCE.startsAt),
        scope: "all",
        change: { kind: "patch", patch: { title: "Design crit" } },
      }),
    ).toEqual({
      kind: "google-series-update",
      externalSeriesId: "g-weekly",
      patch: { title: "Design crit" },
    });
    expect(
      planOccurrenceWrite({
        event: GOOGLE_INSTANCE,
        occurrenceStartMs: Date.parse(GOOGLE_INSTANCE.startsAt),
        scope: "all",
        change: { kind: "delete" },
      }),
    ).toEqual({ kind: "google-series-delete", externalSeriesId: "g-weekly" });
  });
});

describe("an event that doesn't repeat writes as before, whatever the scope", () => {
  it("Moduo and Google one-offs", () => {
    for (const scope of ["this", "all"] as const) {
      expect(
        planOccurrenceWrite({
          event: ONE_OFF,
          occurrenceStartMs: Date.parse(ONE_OFF.startsAt),
          scope,
          change: { kind: "patch", patch: { title: "Long lunch" } },
        }),
      ).toEqual({ kind: "event-update", eventId: "lunch", patch: { title: "Long lunch" } });
      expect(
        planOccurrenceWrite({
          event: ONE_OFF,
          occurrenceStartMs: Date.parse(ONE_OFF.startsAt),
          scope,
          change: { kind: "delete" },
        }),
      ).toEqual({ kind: "event-delete", eventId: "lunch" });
      expect(
        planOccurrenceWrite({
          event: GOOGLE_ONE_OFF,
          occurrenceStartMs: Date.parse(GOOGLE_ONE_OFF.startsAt),
          scope,
          change: { kind: "delete" },
        }),
      ).toEqual({ kind: "google-delete", externalEventId: "g-board" });
    }
  });
});

describe("the week draws an override in place of its occurrence", () => {
  // Mon 2 – Sun 8 Nov, local.
  const days = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 2 + i));
  const range = {
    view: "week" as const,
    days,
    startMs: days[0].getTime(),
    endMs: new Date(2026, 10, 9).getTime(),
  };
  const series = { ...SERIES, exdates: ["2026-11-04T08:00:00.000Z", "2026-11-06T08:00:00.000Z"] };

  it("Wednesday shows the moved occurrence once, Friday nothing, the rest the series", () => {
    const { timed } = eventChipsInRange([series, OVERRIDE], range);
    const wednesday = timed.get("2026-11-04") ?? [];
    expect(wednesday.map((c) => [c.eventId, new Date(c.startMs).getHours()])).toEqual([
      ["ov-1", 10],
    ]);
    expect(timed.get("2026-11-06") ?? []).toEqual([]);
    for (const day of ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-07", "2026-11-08"]) {
      expect((timed.get(day) ?? []).map((c) => c.eventId)).toEqual(["series-1"]);
    }
  });

  it("the moved occurrence still reads as part of a repeat", () => {
    const { timed } = eventChipsInRange([series, OVERRIDE], range);
    expect(timed.get("2026-11-04")?.[0]?.recurring).toBe(true);
    expect(timed.get("2026-11-02")?.[0]?.recurring).toBe(true);
  });

  it("an override of a deleted series isn't drawn", () => {
    const gone = { ...series, deletedAt: "2026-11-01T00:00:00Z" };
    const { timed } = eventChipsInRange([gone, OVERRIDE], range);
    expect([...timed.values()].flat()).toEqual([]);
  });
});

describe("the Google mirror keeps which repeat an instance belongs to", () => {
  it("recurringEventId and originalStartTime come along", () => {
    const mapped = mapGoogleEvent({
      id: "g-weekly_20261103T080000Z",
      summary: "Design review",
      recurringEventId: "g-weekly",
      originalStartTime: { dateTime: "2026-11-03T09:00:00+01:00" },
      start: { dateTime: "2026-11-03T10:00:00+01:00" },
      end: { dateTime: "2026-11-03T11:00:00+01:00" },
    });
    expect(mapped?.externalSeriesId).toBe("g-weekly");
    expect(mapped?.originalStart).toBe("2026-11-03T08:00:00.000Z");
  });

  it("an event that isn't an instance sends neither", () => {
    const mapped = mapGoogleEvent({
      id: "g-board",
      summary: "Board",
      start: { dateTime: "2026-11-03T10:00:00Z" },
      end: { dateTime: "2026-11-03T11:00:00Z" },
    });
    expect(mapped).not.toHaveProperty("externalSeriesId");
    expect(mapped).not.toHaveProperty("originalStart");
  });
});
