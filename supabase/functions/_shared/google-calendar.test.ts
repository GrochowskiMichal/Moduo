// CALR-8 (specs/calendar-rethink.md AC43) · "patch, delete, Meet and visibility":
// Google events edit both ways. Patch and delete target the event's own
// calendar, the body carries only what changed (time, title, place, guests,
// privacy, a Meet link added or removed), and a refusal throws Google's reason
// so the app can roll the change back and say why.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import {
  deleteGoogleEvent,
  getGoogleEvent,
  GoogleRefusal,
  googleCalendarTarget,
  googleEventBody,
  googleSendUpdates,
  insertGoogleEvent,
  isGoogleEventId,
  patchGoogleEvent,
  removeGoogleEvent,
} from "./google-calendar.ts";

type Call = { url: string; method: string; body: unknown; auth: string | null };
let calls: Call[] = [];
let answer: { status: number; json: unknown } = { status: 200, json: { id: "g1" } };

beforeEach(() => {
  calls = [];
  answer = { status: 200, json: { id: "g1" } };
  rs.spyOn(globalThis, "fetch").mockImplementation((async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get("authorization"),
    });
    return new Response(answer.status === 204 ? null : JSON.stringify(answer.json), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  }) as never);
});

afterEach(() => {
  rs.restoreAllMocks();
});

describe("googleCalendarTarget", () => {
  it("reads the Google calendar id out of a mirrored event's calendar id", () => {
    expect(googleCalendarTarget("google:me@x.com:team@group.calendar.google.com")).toBe(
      "team@group.calendar.google.com",
    );
    expect(googleCalendarTarget("google:me@x.com:en.polish#holiday@group.v.calendar.google.com")).toBe(
      "en.polish#holiday@group.v.calendar.google.com",
    );
    expect(googleCalendarTarget("google:me@x.com:primary")).toBe("primary");
  });

  it("falls back to the primary calendar when the id names no calendar", () => {
    expect(googleCalendarTarget("google:me@x.com")).toBe("primary");
    expect(googleCalendarTarget("google")).toBe("primary");
    expect(googleCalendarTarget("")).toBe("primary");
    expect(googleCalendarTarget(null)).toBe("primary");
    expect(googleCalendarTarget(undefined)).toBe("primary");
  });
});

describe("googleEventBody", () => {
  it("sends only what changed", () => {
    expect(googleEventBody({ title: "Board" }, { timeZone: "Europe/Warsaw" })).toEqual({ summary: "Board" });
    expect(googleEventBody({}, { timeZone: "Europe/Warsaw" })).toEqual({});
  });

  it("maps a timed move with its zone, and an all-day one to dates in that zone", () => {
    expect(
      googleEventBody(
        { startsAt: "2026-11-05T09:00:00.000Z", endsAt: "2026-11-05T10:30:00.000Z", allDay: false },
        { timeZone: "Europe/Warsaw" },
      ),
    ).toEqual({
      start: { dateTime: "2026-11-05T09:00:00.000Z", timeZone: "Europe/Warsaw" },
      end: { dateTime: "2026-11-05T10:30:00.000Z", timeZone: "Europe/Warsaw" },
    });
    // Local midnight in Warsaw is 23:00 UTC the day before.
    expect(
      googleEventBody(
        { startsAt: "2026-11-04T23:00:00.000Z", endsAt: "2026-11-06T23:00:00.000Z", allDay: true },
        { timeZone: "Europe/Warsaw" },
      ),
    ).toEqual({ start: { date: "2026-11-05" }, end: { date: "2026-11-07" } });
  });

  it("a timed meeting switched to all day covers its day (Google's end date is exclusive)", () => {
    expect(
      googleEventBody(
        { startsAt: "2026-11-05T08:00:00.000Z", endsAt: "2026-11-05T09:00:00.000Z", allDay: true },
        { timeZone: "Europe/Warsaw" },
      ),
    ).toEqual({ start: { date: "2026-11-05" }, end: { date: "2026-11-06" } });
    expect(
      googleEventBody(
        { startsAt: "2026-12-31T08:00:00.000Z", endsAt: "2026-12-31T09:00:00.000Z", allDay: true },
        { timeZone: "UTC" },
      ),
    ).toEqual({ start: { date: "2026-12-31" }, end: { date: "2027-01-01" } });
  });

  it("maps place, description, guests and privacy", () => {
    expect(
      googleEventBody(
        {
          description: "Agenda",
          location: "Hale & Co",
          attendees: [
            { email: "priya@example.com", name: "Priya" },
            { email: "kai@example.com", name: "" },
          ],
          isPrivate: true,
        },
        { timeZone: "UTC" },
      ),
    ).toEqual({
      description: "Agenda",
      location: "Hale & Co",
      attendees: [{ email: "priya@example.com", displayName: "Priya" }, { email: "kai@example.com" }],
      visibility: "private",
    });
    expect(googleEventBody({ isPrivate: false }, { timeZone: "UTC" })).toEqual({ visibility: "default" });
    expect(googleEventBody({ location: null }, { timeZone: "UTC" })).toEqual({ location: "" });
  });

  it("adds a Meet link with a request id, and removes one", () => {
    expect(googleEventBody({ meet: "add" }, { timeZone: "UTC", requestId: "req-1" })).toEqual({
      conferenceData: {
        createRequest: { requestId: "req-1", conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
    });
    expect(googleEventBody({ meet: "remove" }, { timeZone: "UTC" })).toEqual({ conferenceData: null });
  });
});

describe("googleSendUpdates", () => {
  it("tells guests about changes they'd notice, not about privacy", () => {
    expect(googleSendUpdates({ startsAt: "x", endsAt: "y" })).toBe("all");
    expect(googleSendUpdates({ attendees: [] })).toBe("all");
    expect(googleSendUpdates({ title: "New" })).toBe("all");
    expect(googleSendUpdates({ isPrivate: true })).toBe("none");
    expect(googleSendUpdates({})).toBe("none");
  });
});

describe("patchGoogleEvent", () => {
  it("patches the event on its own calendar with conference data on", async () => {
    answer = { status: 200, json: { id: "g1", summary: "Board" } };
    const out = await patchGoogleEvent({
      accessToken: "tok",
      calendarId: "team@group.calendar.google.com",
      eventId: "g1_20261105T090000Z",
      body: { summary: "Board" },
      sendUpdates: "all",
    });
    expect(out).toEqual({ id: "g1", summary: "Board" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("PATCH");
    expect(call.auth).toBe("Bearer tok");
    const url = new URL(call.url);
    expect(url.pathname).toBe(
      "/calendar/v3/calendars/team%40group.calendar.google.com/events/g1_20261105T090000Z",
    );
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(url.searchParams.get("sendUpdates")).toBe("all");
    expect(call.body).toEqual({ summary: "Board" });
  });

  it("a refusal throws Google's reason and status", async () => {
    answer = { status: 403, json: { error: { code: 403, message: "You need to have writer access to this calendar." } } };
    const err = await patchGoogleEvent({
      accessToken: "tok",
      calendarId: "primary",
      eventId: "g1",
      body: { summary: "x" },
      sendUpdates: "none",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleRefusal);
    expect((err as GoogleRefusal).status).toBe(403);
    expect((err as GoogleRefusal).message).toBe("You need to have writer access to this calendar.");
  });

  it("a refusal without a message still says something", async () => {
    answer = { status: 500, json: {} };
    const err = await patchGoogleEvent({
      accessToken: "tok",
      calendarId: "primary",
      eventId: "g1",
      body: {},
      sendUpdates: "none",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleRefusal);
    expect((err as GoogleRefusal).message.length).toBeGreaterThan(0);
  });
});

describe("removeGoogleEvent", () => {
  it("deletes on the event's own calendar", async () => {
    answer = { status: 204, json: null };
    await removeGoogleEvent({
      accessToken: "tok",
      calendarId: "team@group.calendar.google.com",
      eventId: "g1",
      sendUpdates: "all",
    });
    const url = new URL(calls[0]!.url);
    expect(calls[0]!.method).toBe("DELETE");
    expect(url.pathname).toBe("/calendar/v3/calendars/team%40group.calendar.google.com/events/g1");
    expect(url.searchParams.get("sendUpdates")).toBe("all");
  });

  it("an event already gone counts as deleted", async () => {
    answer = { status: 410, json: { error: { message: "Resource has been deleted" } } };
    await expect(
      removeGoogleEvent({ accessToken: "tok", calendarId: "primary", eventId: "g1", sendUpdates: "all" }),
    ).resolves.toBeUndefined();
    answer = { status: 404, json: { error: { message: "Not Found" } } };
    await expect(
      removeGoogleEvent({ accessToken: "tok", calendarId: "primary", eventId: "g1", sendUpdates: "all" }),
    ).resolves.toBeUndefined();
  });

  it("a refusal throws Google's reason", async () => {
    answer = { status: 403, json: { error: { message: "Forbidden" } } };
    const err = await removeGoogleEvent({
      accessToken: "tok",
      calendarId: "primary",
      eventId: "g1",
      sendUpdates: "all",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleRefusal);
    expect((err as GoogleRefusal).message).toBe("Forbidden");
  });
});

describe("deleteGoogleEvent (booking's)", () => {
  it("still defaults to the primary calendar and answers true or false", async () => {
    answer = { status: 204, json: null };
    expect(await deleteGoogleEvent("tok", "g1")).toBe(true);
    expect(new URL(calls[0]!.url).pathname).toBe("/calendar/v3/calendars/primary/events/g1");
    answer = { status: 403, json: { error: { message: "Forbidden" } } };
    expect(await deleteGoogleEvent("tok", "g1", "team@group.calendar.google.com")).toBe(false);
    expect(new URL(calls[1]!.url).pathname).toBe(
      "/calendar/v3/calendars/team%40group.calendar.google.com/events/g1",
    );
  });
});

// CALR-20b: the app names a new event's id, so a retried create can't make a second copy.
describe("insertGoogleEvent with the app's id", () => {
  const input = {
    accessToken: "tok",
    calendarId: "primary",
    summary: "Board",
    description: "",
    start: { dateTime: "2026-11-05T10:00:00Z" },
    end: { dateTime: "2026-11-05T11:00:00Z" },
  };

  it("sends the id in the insert", async () => {
    answer = { status: 200, json: { id: "abc123def456" } };
    await insertGoogleEvent({ ...input, id: "abc123def456" });
    expect((calls[0]?.body as { id?: string }).id).toBe("abc123def456");
  });

  it("sends no id when the app gave none", async () => {
    await insertGoogleEvent(input);
    expect("id" in (calls[0]?.body as object)).toBe(false);
  });

  it("answers a 409 for its own id with the event already there, so a retry makes no second copy", async () => {
    let n = 0;
    rs.spyOn(globalThis, "fetch").mockImplementation((async (url: string, init?: RequestInit) => {
      n += 1;
      calls.push({ url: String(url), method: init?.method ?? "GET", body: undefined, auth: null });
      return n === 1
        ? new Response(JSON.stringify({ error: { message: "The requested identifier already exists." } }), {
            status: 409,
          })
        : new Response(JSON.stringify({ id: "abc123def456", summary: "Board" }), { status: 200 });
    }) as never);
    const got = await insertGoogleEvent({ ...input, id: "abc123def456" });
    expect(got.id).toBe("abc123def456");
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    expect(calls[1]?.url).toContain("/events/abc123def456");
  });

  it("still throws a 409 without an id of its own", async () => {
    answer = { status: 409, json: { error: { message: "conflict" } } };
    await expect(insertGoogleEvent(input)).rejects.toThrow("conflict");
  });
});

describe("getGoogleEvent", () => {
  it("returns the event", async () => {
    answer = { status: 200, json: { id: "abc123def456", status: "confirmed" } };
    expect((await getGoogleEvent({ accessToken: "t", calendarId: "primary", eventId: "abc123def456" }))?.id).toBe(
      "abc123def456",
    );
  });

  it.each([404, 410])("is null when Google has none (%i)", async (status) => {
    answer = { status, json: { error: { message: "gone" } } };
    expect(await getGoogleEvent({ accessToken: "t", calendarId: "primary", eventId: "abc123def456" })).toBeNull();
  });

  it("is null for a cancelled event", async () => {
    answer = { status: 200, json: { id: "abc123def456", status: "cancelled" } };
    expect(await getGoogleEvent({ accessToken: "t", calendarId: "primary", eventId: "abc123def456" })).toBeNull();
  });

  it("throws when it can't tell", async () => {
    answer = { status: 500, json: { error: { message: "backend" } } };
    await expect(
      getGoogleEvent({ accessToken: "t", calendarId: "primary", eventId: "abc123def456" }),
    ).rejects.toThrow("backend");
  });
});

describe("isGoogleEventId", () => {
  it("takes base32hex of 5 to 1024 characters, as a dashless lowercase uuid is", () => {
    expect(isGoogleEventId("0f8fad5bd9cb469fa16570867728950e")).toBe(true);
    expect(isGoogleEventId("abcd")).toBe(false);
    expect(isGoogleEventId("abcdw")).toBe(false);
    expect(isGoogleEventId("ABCDE")).toBe(false);
    expect(isGoogleEventId("0f8fad5b-d9cb")).toBe(false);
    expect(isGoogleEventId(42)).toBe(false);
  });
});
