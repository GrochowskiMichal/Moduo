// CAL-8 AC17/AC16 — the ical→mirror mapper. Fixtures cover the four target
// hosting shapes: VTIMEZONE-carrying resources (iCloud/Nextcloud style),
// UTC-instant events (Fastmail style), bare-IANA TZIDs (feed exports), and
// the drop-never-shift posture for unresolvable zones.

import { describe, expect, it } from "vitest";

import { icsCalendarName, isValidIanaZone, mapIcsEvents, wallTimeToInstant } from "./ics-mirror";

const WIN = {
  timeMin: "2026-06-01T00:00:00.000Z",
  timeMax: "2026-10-29T00:00:00.000Z",
};

function wrap(body: string, calProps = ""): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//moduo tests//EN",
    calProps,
    body,
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

const WARSAW_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Warsaw",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

describe("ics-mirror · instants & zones (AC17)", () => {
  it("converts a VTIMEZONE-backed event to the right instant (CEST = UTC+2)", () => {
    const ics = wrap(
      [
        WARSAW_VTIMEZONE,
        "BEGIN:VEVENT",
        "UID:tz-1",
        "SUMMARY:Standup",
        "DTSTART;TZID=Europe/Warsaw:20260706T090000",
        "DTEND;TZID=Europe/Warsaw:20260706T093000",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [ev] = mapIcsEvents([{ ics }], WIN);
    expect(ev.externalEventId).toBe("tz-1");
    expect(ev.startsAt).toBe("2026-07-06T07:00:00.000Z");
    expect(ev.endsAt).toBe("2026-07-06T07:30:00.000Z");
    expect(ev.allDay).toBe(false);
    expect(ev.rrule).toBeNull();
  });

  it("passes UTC instants through unchanged", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:utc-1",
        "SUMMARY:Call",
        "DTSTART:20260710T140000Z",
        "DTEND:20260710T150000Z",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [ev] = mapIcsEvents([{ ics }], WIN);
    expect(ev.startsAt).toBe("2026-07-10T14:00:00.000Z");
    expect(ev.endsAt).toBe("2026-07-10T15:00:00.000Z");
  });

  it("converts a bare-IANA TZID (no VTIMEZONE) via the Intl fallback", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:iana-1",
        "SUMMARY:NYC sync",
        "DTSTART;TZID=America/New_York:20260708T100000",
        "DTEND;TZID=America/New_York:20260708T110000",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [ev] = mapIcsEvents([{ ics }], WIN);
    // EDT = UTC-4 in July.
    expect(ev.startsAt).toBe("2026-07-08T14:00:00.000Z");
    expect(ev.endsAt).toBe("2026-07-08T15:00:00.000Z");
  });

  it("DROPS an event with an unresolvable TZID — never shifts it", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:bad-tz",
        "SUMMARY:Wrong slot trap",
        "DTSTART;TZID=Pacific Standard Time:20260708T100000",
        "DTEND;TZID=Pacific Standard Time:20260708T110000",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:good-1",
        "SUMMARY:Survivor",
        "DTSTART:20260708T100000Z",
        "DTEND:20260708T110000Z",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const events = mapIcsEvents([{ ics }], WIN);
    expect(events.map((e) => e.externalEventId)).toEqual(["good-1"]);
  });

  it("treats a floating time as local wall time", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:float-1",
        "SUMMARY:Floating",
        "DTSTART:20260709T080000",
        "DTEND:20260709T090000",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [ev] = mapIcsEvents([{ ics }], WIN);
    expect(ev.startsAt).toBe(new Date(2026, 6, 9, 8, 0, 0).toISOString());
  });

  it("wallTimeToInstant resolves DST boundaries to the post-transition offset", () => {
    // Europe/Warsaw 2026-03-29 02:30 does not exist (clocks jump 02:00→03:00).
    const d = wallTimeToInstant(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 },
      "Europe/Warsaw",
    );
    expect(d).not.toBeNull();
    // A nonexistent wall time resolves FORWARD (01:30Z = 03:30 CEST), the
    // spring-forward convention — never a wrong-by-a-day or NaN instant.
    expect(d!.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(isValidIanaZone("Not/AZone")).toBe(false);
  });
});

describe("ics-mirror · all-day & duration (AC17)", () => {
  it("lands VALUE=DATE on the right LOCAL day, end-exclusive like the Google path", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:allday-1",
        "SUMMARY:Conference",
        "DTSTART;VALUE=DATE:20260715",
        "DTEND;VALUE=DATE:20260717",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [ev] = mapIcsEvents([{ ics }], WIN);
    expect(ev.allDay).toBe(true);
    expect(ev.startsAt).toBe(new Date(2026, 6, 15).toISOString());
    expect(ev.endsAt).toBe(new Date(2026, 6, 17).toISOString());
  });

  it("honors DURATION when DTEND is absent", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:dur-1",
        "SUMMARY:Sprint review",
        "DTSTART:20260716T120000Z",
        "DURATION:PT1H30M",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [ev] = mapIcsEvents([{ ics }], WIN);
    expect(ev.startsAt).toBe("2026-07-16T12:00:00.000Z");
    expect(ev.endsAt).toBe("2026-07-16T13:30:00.000Z");
  });

  it("defaults a date-only event with no DTEND to one day", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:dur-2",
        "SUMMARY:Holiday",
        "DTSTART;VALUE=DATE:20260720",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const [ev] = mapIcsEvents([{ ics }], WIN);
    expect(ev.allDay).toBe(true);
    expect(ev.startsAt).toBe(new Date(2026, 6, 20).toISOString());
    expect(ev.endsAt).toBe(new Date(2026, 6, 21).toISOString());
  });
});

describe("ics-mirror · recurrence expansion (AC17)", () => {
  it("expands a weekly series honoring EXDATE and a moved RECURRENCE-ID override", () => {
    const ics = wrap(
      [
        WARSAW_VTIMEZONE,
        "BEGIN:VEVENT",
        "UID:rec-1",
        "SUMMARY:Weekly review",
        "DTSTART;TZID=Europe/Warsaw:20260706T100000",
        "DTEND;TZID=Europe/Warsaw:20260706T110000",
        "RRULE:FREQ=WEEKLY;COUNT=4",
        "EXDATE;TZID=Europe/Warsaw:20260713T100000",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:rec-1",
        "RECURRENCE-ID;TZID=Europe/Warsaw:20260720T100000",
        "SUMMARY:Weekly review (moved)",
        "DTSTART;TZID=Europe/Warsaw:20260721T150000",
        "DTEND;TZID=Europe/Warsaw:20260721T160000",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const events = mapIcsEvents([{ ics }], WIN);
    // 4 scheduled − 1 EXDATE = 3 occurrences; Jul 20 renders MOVED to Jul 21.
    expect(events).toHaveLength(3);
    const starts = events.map((e) => e.startsAt).sort();
    expect(starts).toEqual([
      "2026-07-06T08:00:00.000Z",
      "2026-07-21T13:00:00.000Z",
      "2026-07-27T08:00:00.000Z",
    ]);
    // No duplicate at the original Jul 20 slot.
    expect(starts).not.toContain("2026-07-20T08:00:00.000Z");
    // Stable, distinct per-occurrence ids; expanded rows carry no rrule.
    expect(new Set(events.map((e) => e.externalEventId)).size).toBe(3);
    expect(events.every((e) => e.externalEventId.startsWith("rec-1::"))).toBe(true);
    expect(events.every((e) => e.rrule === null)).toBe(true);
    const moved = events.find((e) => e.startsAt === "2026-07-21T13:00:00.000Z");
    expect(moved?.title).toBe("Weekly review (moved)");
  });

  it("expands only into the window and never past it", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:rec-2",
        "SUMMARY:Daily",
        "DTSTART:20260101T080000Z",
        "DTEND:20260101T083000Z",
        "RRULE:FREQ=DAILY",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const events = mapIcsEvents([{ ics }], WIN);
    expect(events.length).toBeGreaterThan(100); // ~June 1 → Oct 29
    const starts = events.map((e) => e.startsAt).sort();
    expect(starts[0] >= WIN.timeMin).toBe(true);
    expect(starts[starts.length - 1] <= WIN.timeMax).toBe(true);
  });

  it("includes an override moved BACKWARD into the window from beyond it", () => {
    // Weekly series far in the future (all base occurrences past the window),
    // but one occurrence is moved back to inside the window via RECURRENCE-ID.
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:back-1",
        "SUMMARY:Future series",
        "DTSTART:20261201T090000Z",
        "DTEND:20261201T100000Z",
        "RRULE:FREQ=WEEKLY;COUNT=8",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:back-1",
        "RECURRENCE-ID:20261215T090000Z",
        "SUMMARY:Pulled earlier",
        "DTSTART:20260715T090000Z",
        "DTEND:20260715T100000Z",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const events = mapIcsEvents([{ ics }], WIN);
    // Only the moved-back override lands in the window; the base series is all
    // in December, past timeMax.
    expect(events).toHaveLength(1);
    expect(events[0].startsAt).toBe("2026-07-15T09:00:00.000Z");
    expect(events[0].externalEventId).toBe("back-1::2026-12-15T09:00:00");
    expect(events[0].title).toBe("Pulled earlier");
  });

  it("skips cancelled events and cancelled overrides", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:canc-1",
        "SUMMARY:Ghost",
        "STATUS:CANCELLED",
        "DTSTART:20260708T100000Z",
        "DTEND:20260708T110000Z",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:canc-2",
        "SUMMARY:Weekly",
        "DTSTART:20260706T080000Z",
        "DTEND:20260706T083000Z",
        "RRULE:FREQ=WEEKLY;COUNT=2",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:canc-2",
        "RECURRENCE-ID:20260713T080000Z",
        "STATUS:CANCELLED",
        "DTSTART:20260713T080000Z",
        "DTEND:20260713T083000Z",
        "SUMMARY:Weekly",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const events = mapIcsEvents([{ ics }], WIN);
    // Id is keyed by the occurrence's ORIGINAL slot (tz-independent), not its
    // moved/instant start — so it never churns on an OS-zone change.
    expect(events.map((e) => e.externalEventId)).toEqual(["canc-2::2026-07-06T08:00:00"]);
  });
});

describe("ics-mirror · idempotence & feed parse (AC16/AC17)", () => {
  const feed = wrap(
    [
      "BEGIN:VEVENT",
      "UID:feed-1",
      "SUMMARY:One",
      "DTSTART:20260707T090000Z",
      "DTEND:20260707T100000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:feed-2",
      "SUMMARY:Two",
      "DTSTART;VALUE=DATE:20260709",
      "END:VEVENT",
    ].join("\r\n"),
    "X-WR-CALNAME:Team calendar",
  );

  it("re-mapping yields identical externalEventIds (re-sync updates, never duplicates)", () => {
    const a = mapIcsEvents([{ ics: feed }], WIN).map((e) => e.externalEventId);
    const b = mapIcsEvents([{ ics: feed }], WIN).map((e) => e.externalEventId);
    expect(a).toEqual(b);
    expect(a).toEqual(["feed-1", "feed-2"]);
  });

  it("parses a multi-VEVENT feed whole + exposes X-WR-CALNAME", () => {
    const events = mapIcsEvents([{ ics: feed, calendarId: "feed-hash" }], WIN);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.calendarId === "feed-hash")).toBe(true);
    expect(icsCalendarName(feed)).toBe("Team calendar");
  });

  it("isolates a malformed resource — the good one still maps", () => {
    const events = mapIcsEvents([{ ics: "NOT ICS AT ALL" }, { ics: feed }], WIN);
    expect(events).toHaveLength(2);
  });

  it("THROWS when nothing parses (a 200 HTML error page) — never returns [] that would tombstone", () => {
    // A feed URL that expired and now serves a login page under HTTP 200.
    expect(() =>
      mapIcsEvents([{ ics: "<!doctype html><html><body>Sign in</body></html>" }], WIN),
    ).toThrow();
    // A non-VCALENDAR jCal-ish blob also throws rather than mapping to [].
    expect(() => mapIcsEvents([{ ics: "BEGIN:VCARD\r\nFN:Nope\r\nEND:VCARD" }], WIN)).toThrow();
  });

  it("does NOT throw on a valid but genuinely empty calendar", () => {
    const empty = wrap("");
    expect(mapIcsEvents([{ ics: empty }], WIN)).toEqual([]);
  });

  it("keeps good CalDAV resources when one sibling resource is unparseable", () => {
    const good = wrap(
      [
        "BEGIN:VEVENT",
        "UID:multi-1",
        "DTSTART:20260707T090000Z",
        "DTEND:20260707T100000Z",
        "SUMMARY:Good",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const events = mapIcsEvents([{ ics: good }, { ics: "garbage" }], WIN);
    expect(events.map((e) => e.externalEventId)).toEqual(["multi-1"]);
  });

  it("filters events entirely outside the window", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "UID:old-1",
        "SUMMARY:Ancient",
        "DTSTART:20250101T090000Z",
        "DTEND:20250101T100000Z",
        "END:VEVENT",
      ].join("\r\n"),
    );
    expect(mapIcsEvents([{ ics }], WIN)).toHaveLength(0);
  });
});
