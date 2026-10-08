import { describe, expect, it } from "@rstest/core";

import { buildIcs, foldLine, icsAttachment, icsDate, icsText } from "./ics.ts";

const EVENT = {
  uid: "booking-42@moduo.app",
  start: new Date("2026-10-16T12:00:00Z"),
  end: new Date("2026-10-16T12:30:00Z"),
  stamp: new Date("2026-10-08T09:00:00Z"),
  summary: "Intro call: Anna Carter and Tom Becker",
  description: "Booked with Moduo.\nCancel: https://moduo.app/book/cancel?token=abc",
  url: "https://zoom.us/j/123",
  organizer: { name: "Anna Carter", email: "anna@northwind.studio" },
  attendees: [
    { name: "Tom Becker", email: "tom@becker.studio" },
    { email: "sam@lee.test" },
  ],
};

describe("calendar files", () => {
  it("builds a REQUEST with the booking's details", () => {
    const raw = buildIcs({ ...EVENT, method: "REQUEST" });
    // Long lines are folded (CRLF + space); unfold before reading values.
    const ics = raw.replace(/\r\n /g, "");
    expect(raw.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(raw.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("METHOD:REQUEST\r\n");
    expect(ics).toContain("UID:booking-42@moduo.app\r\n");
    expect(ics).toContain("SEQUENCE:0\r\n");
    expect(ics).toContain("DTSTART:20261016T120000Z\r\n");
    expect(ics).toContain("DTEND:20261016T123000Z\r\n");
    expect(ics).toContain("DTSTAMP:20261008T090000Z\r\n");
    expect(ics).toContain('ORGANIZER;CN="Anna Carter":mailto:anna@northwind.studio');
    expect(ics).toContain('ATTENDEE;CN="Tom Becker";CUTYPE=INDIVIDUAL');
    expect(ics).toContain("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:sam@lee.test");
    expect(ics).toContain("STATUS:CONFIRMED\r\n");
    // Bare LF never appears: every line ends in CRLF.
    expect(raw.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("builds a CANCEL with the same UID and a higher sequence", () => {
    const ics = buildIcs({ ...EVENT, method: "CANCEL" });
    expect(ics).toContain("METHOD:CANCEL\r\n");
    expect(ics).toContain("UID:booking-42@moduo.app\r\n");
    expect(ics).toContain("SEQUENCE:1\r\n");
    expect(ics).toContain("STATUS:CANCELLED\r\n");
  });

  it("escapes text values", () => {
    expect(icsText("a, b; c\\d\nnext")).toBe("a\\, b\\; c\\\\d\\nnext");
    // Tab stays; vertical tab and NUL go; CRLF becomes the escaped newline.
    expect(icsText("tab\there\u000bvt\u0000nul\r\ncrlf")).toBe("tab\therevtnul\\ncrlf");
    const ics = buildIcs({ ...EVENT, method: "REQUEST", summary: "Call; with, commas", organizer: { name: 'A "B"\r\nX', email: "a@b.test" } });
    expect(ics).toContain("SUMMARY:Call\\; with\\, commas");
    expect(ics).toContain('ORGANIZER;CN="A BX":mailto:a@b.test');
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const line = `DESCRIPTION:${"ł".repeat(80)}`;
    const folded = foldLine(line);
    const encoder = new TextEncoder();
    for (const piece of folded.split("\r\n")) expect(encoder.encode(piece).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("caps user-typed fields so the file stays small", () => {
    const ics = buildIcs({
      ...EVENT,
      method: "REQUEST",
      summary: "s".repeat(1000),
      description: "d".repeat(10_000),
      attendees: Array.from({ length: 50 }, (_, i) => ({ email: `g${i}@x.test` })),
    }).replace(/\r\n /g, "");
    expect(ics).not.toContain("s".repeat(201));
    expect(ics).not.toContain("d".repeat(2001));
    expect(ics.split("ATTENDEE").length - 1).toBe(20);
  });

  it("refuses a UID too long to keep whole", () => {
    expect(() => buildIcs({ ...EVENT, method: "REQUEST", uid: "u".repeat(300) })).toThrow("uid too long");
  });

  it("formats dates in UTC basic form", () => {
    expect(icsDate(new Date("2026-01-02T03:04:05.678Z"))).toBe("20260102T030405Z");
  });

  it("wraps the file as a Resend attachment", () => {
    const file = icsAttachment({ ...EVENT, method: "REQUEST" });
    expect(file.filename).toBe("invite.ics");
    expect(file.contentType).toBe("text/calendar; charset=utf-8; method=REQUEST");
    expect(new TextDecoder().decode(Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)))).toContain("METHOD:REQUEST");
  });
});
