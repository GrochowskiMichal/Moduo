// AC44 (CALR-11): the web runtime's one-occurrence writes. A Moduo occurrence
// goes through the occurrence ops; a Google repeat's All events goes to its
// series (the recurringEventId) and is stored on the instances shown, never as
// a row of its own; the week's rows carry their series fields.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import type { CalendarAccountModel, CalendarEventModel } from "../features/calendar/events";
import { webCalendar } from "./runtime.web.calendar";

const h = rs.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  deletes: [] as Record<string, unknown>[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  rows: {} as Record<string, unknown>,
}));

rs.mock("../features/calendar/google-web", () => ({
  updateGoogleWebEvent: async (input: Record<string, unknown>) => {
    h.updates.push(input);
    // Google answers with the series itself: a repeat, its own id.
    return {
      externalEventId: "g-weekly",
      title: "Design crit",
      startsAt: "2026-10-06T08:00:00.000Z",
      endsAt: "2026-10-06T09:00:00.000Z",
      rrule: "FREQ=WEEKLY",
      calendarId: "google:me@x.com:primary",
    };
  },
  removeGoogleWebEvent: async (input: Record<string, unknown>) => {
    h.deletes.push(input);
  },
}));

function answer(fn: string) {
  if (fn in h.rows) return h.rows[fn];
  return { upserted: 1, removed: 0 };
}

rs.mock("./runtime.web.client", () => ({
  supabaseClient: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcs.push({ fn, args });
      return Promise.resolve({ data: answer(fn), error: null });
    },
  },
}));

const ROW = {
  id: "ov-1",
  workspace_id: "w1",
  owner_id: "u1",
  source_account_id: null,
  external_event_id: null,
  calendar_id: "moduo",
  calendar_ref: "cal-1",
  title: "Standup (late)",
  description: "",
  start_time: "2026-11-04T09:00:00+00:00",
  end_time: "2026-11-04T09:30:00+00:00",
  all_day: false,
  recurrence_rule: null,
  status: "confirmed",
  location: null,
  color: null,
  created_at: "2026-10-28T08:00:00Z",
  updated_at: "2026-10-28T08:00:00Z",
  deleted_at: null,
  attendees: [],
  is_private: false,
  series_id: "series-1",
  original_start: "2026-11-04T08:00:00+00:00",
  exdates: [],
  external_series_id: null,
};

const ACCOUNT = {
  id: "acc-g",
  workspaceId: "w1",
  ownerId: "u1",
  provider: "google",
  externalId: "google:me@x.com",
  displayLabel: "me@x.com",
  isDefaultTarget: false,
  color: null,
  lastSyncAt: null,
  status: "ok",
  syncToken: null,
  deletedAt: null,
} satisfies CalendarAccountModel;

function instance(day: number): CalendarEventModel {
  const start = `2026-11-${String(day).padStart(2, "0")}T08:00:00.000Z`;
  const end = `2026-11-${String(day).padStart(2, "0")}T09:00:00.000Z`;
  return {
    id: `row-${day}`,
    workspaceId: "w1",
    ownerId: "u1",
    sourceAccountId: "acc-g",
    externalEventId: `g-weekly_202611${String(day).padStart(2, "0")}T080000Z`,
    externalSeriesId: "g-weekly",
    originalStart: start,
    calendarId: "google:me@x.com:primary",
    title: "Design review",
    description: "",
    startsAt: start,
    endsAt: end,
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: "2026-10-28T08:00:00Z",
    updatedAt: "2026-10-28T08:00:00Z",
    deletedAt: null,
  };
}

beforeEach(() => {
  h.updates.length = 0;
  h.deletes.length = 0;
  h.rpcs.length = 0;
  h.rows = {
    calendar_op_event_occurrence_update: [ROW],
    calendar_op_event_occurrence_delete: null,
    calendar_op_event_occurrence_restore: [{ ...ROW, id: "series-1", series_id: null }],
  };
});

describe("Moduo occurrence writes", () => {
  it("updateOccurrence calls the occurrence op and hands back the override", async () => {
    const saved = await webCalendar.updateOccurrence({
      workspaceId: "w1",
      seriesId: "series-1",
      originalStart: "2026-11-04T08:00:00.000Z",
      patch: { title: "Standup (late)" },
    });
    expect(h.rpcs).toEqual([
      {
        fn: "calendar_op_event_occurrence_update",
        args: {
          p_workspace_id: "w1",
          p_series_id: "series-1",
          p_original_start: "2026-11-04T08:00:00.000Z",
          p_patch: { title: "Standup (late)" },
        },
      },
    ]);
    expect(saved.id).toBe("ov-1");
    expect(saved.seriesId).toBe("series-1");
    expect(Date.parse(saved.originalStart ?? "")).toBe(Date.parse("2026-11-04T08:00:00Z"));
  });

  it("removeOccurrence and restoreOccurrence call theirs", async () => {
    await webCalendar.removeOccurrence({
      workspaceId: "w1",
      seriesId: "series-1",
      originalStart: "2026-11-05T08:00:00.000Z",
    });
    await webCalendar.restoreOccurrence({
      workspaceId: "w1",
      seriesId: "series-1",
      originalStart: "2026-11-05T08:00:00.000Z",
    });
    const args = {
      p_workspace_id: "w1",
      p_series_id: "series-1",
      p_original_start: "2026-11-05T08:00:00.000Z",
    };
    expect(h.rpcs).toEqual([
      { fn: "calendar_op_event_occurrence_delete", args },
      { fn: "calendar_op_event_occurrence_restore", args },
    ]);
  });

  it("an event row maps its series fields", async () => {
    h.rows.calendar_op_event_update = [
      {
        ...ROW,
        id: "series-1",
        series_id: null,
        original_start: null,
        recurrence_rule: "FREQ=DAILY",
        exdates: ["2026-11-04T08:00:00+00:00"],
      },
    ];
    const series = await webCalendar.updateEvent({
      workspaceId: "w1",
      eventId: "series-1",
      patch: { title: "x" },
    });
    expect(series.seriesId ?? null).toBeNull();
    expect(series.exdates?.map((d) => Date.parse(d))).toEqual([Date.parse("2026-11-04T08:00:00Z")]);
    h.rows.calendar_op_event_update = [
      {
        ...ROW,
        id: "row-g",
        source_account_id: "acc-g",
        series_id: null,
        external_series_id: "g-weekly",
        exdates: null,
      },
    ];
    const google = await webCalendar.updateEvent({
      workspaceId: "w1",
      eventId: "row-g",
      patch: { title: "x" },
    });
    expect(google.externalSeriesId).toBe("g-weekly");
    expect(google.exdates ?? []).toEqual([]);
  });
});

describe("Google All events", () => {
  it("patches the series by its recurringEventId, with no times", async () => {
    const shown = [instance(3), instance(10)];
    await webCalendar.updateGoogleSeries({
      workspaceId: "w1",
      account: ACCOUNT,
      instance: shown[0],
      instances: shown,
      patch: { title: "Design crit" },
    });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toMatchObject({
      externalAccountId: "google:me@x.com",
      calendarId: "google:me@x.com:primary",
      eventId: "g-weekly",
      patch: { title: "Design crit" },
    });
  });

  it("stores the change on the instances shown, never Google's series as a row", async () => {
    const shown = [instance(3), instance(10)];
    await webCalendar.updateGoogleSeries({
      workspaceId: "w1",
      account: ACCOUNT,
      instance: shown[0],
      instances: shown,
      patch: { title: "Design crit" },
    });
    const mirrored = h.rpcs
      .filter((r) => r.fn === "calendar_op_mirror_events")
      .flatMap(
        (r) => r.args.p_events as { externalEventId: string; title: string; startsAt: string }[],
      );
    expect(mirrored.map((e) => e.externalEventId).sort()).toEqual([
      "g-weekly_20261103T080000Z",
      "g-weekly_20261110T080000Z",
    ]);
    expect(mirrored.every((e) => e.title === "Design crit")).toBe(true);
    expect(mirrored.find((e) => e.externalEventId.endsWith("1103T080000Z"))?.startsAt).toBe(
      "2026-11-03T08:00:00.000Z",
    );
    expect(mirrored.some((e) => e.externalEventId === "g-weekly")).toBe(false);
  });

  it("deletes the series by its recurringEventId and tombstones the instances shown", async () => {
    const shown = [instance(3), instance(10)];
    await webCalendar.removeGoogleSeries({
      workspaceId: "w1",
      account: ACCOUNT,
      instance: shown[0],
      instances: shown,
    });
    expect(h.deletes).toEqual([
      {
        externalAccountId: "google:me@x.com",
        calendarId: "google:me@x.com:primary",
        eventId: "g-weekly",
      },
    ]);
    const tomb = h.rpcs.find((r) => r.fn === "calendar_op_mirror_events");
    expect([...((tomb?.args.p_deleted_external_ids ?? []) as string[])].sort()).toEqual([
      "g-weekly_20261103T080000Z",
      "g-weekly_20261110T080000Z",
    ]);
  });
});
