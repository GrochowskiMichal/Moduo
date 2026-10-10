import { describe, expect, it } from "@rstest/core";

import { renderEmail } from "../render.ts";
import {
  BOOKING_QUEUED,
  BOOKING_SETTINGS_URL,
  bookingGuestConfirmedEmail,
  bookingHostNewEmail,
  parseBookingPayload,
} from "./booking.ts";
import { BOOKING_FIXTURE, BOOKING_ZOOM_FIXTURE } from "./fixtures.ts";

const payload = (data: object) => JSON.parse(JSON.stringify(data)) as Record<string, unknown>;

function decode(base64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

describe("booking emails · guest", () => {
  it("C1 comes from the host via Moduo, replies to the host, in the guest's zone, zone named", () => {
    const queued = BOOKING_QUEUED.booking_guest_confirmed(payload(BOOKING_FIXTURE));
    const { subject, html, text } = renderEmail(queued.doc);
    expect(queued.fromName).toBe("Anna Carter via Moduo");
    expect(queued.replyTo).toBe("anna@northwind.studio");
    expect(subject).toBe("Booked: Anna Carter, Fri 16 Oct at 14:00");
    expect(text).toContain("You're meeting Anna on Friday 16 October at 14:00.");
    expect(text).toContain("30 minutes on Google Meet, Warsaw time. Google is sending the calendar invite separately.");
    expect(text).toContain("sam@lee.design, priya@nair.dev");
    expect(text).toContain("https://meet.google.com/abc-defg-hij");
    expect(text).toContain("https://moduo.app/book/cancel?token=3c1e6f7a");
    expect(html).toContain("Join Google Meet");
    expect(text).toContain("Scheduled with Moduo");
  });

  it("C1 never carries the guest's own note", () => {
    const doc = bookingGuestConfirmedEmail({ ...BOOKING_FIXTURE, note: "<b>Buy cheap pills</b>" });
    const { html, text } = renderEmail(doc);
    expect(text).not.toContain("Buy cheap pills");
    expect(html).not.toContain("Buy cheap pills");
  });

  it("C1 attaches a calendar file only when Google isn't inviting", () => {
    expect(BOOKING_QUEUED.booking_guest_confirmed(payload(BOOKING_FIXTURE)).attachments).toBeUndefined();
    const zoom = BOOKING_QUEUED.booking_guest_confirmed(payload(BOOKING_ZOOM_FIXTURE));
    expect(zoom.attachments).toHaveLength(1);
    const file = zoom.attachments?.[0];
    expect(file?.filename).toBe("invite.ics");
    expect(file?.contentType).toContain("method=REQUEST");
    const ics = decode(file?.content ?? "");
    expect(ics).toContain("UID:booking-8f0c2a4e-1b6d-4c3a-9e7f-2d5b8a1c6e90@moduo.app");
    expect(ics).toContain("DTSTART:20261016T120000Z");
    // The stamp comes from the payload, so a retry sends the same bytes.
    expect(ics).toContain("DTSTAMP:20261009T091200Z");
    expect(ics).toContain("ORGANIZER;CN=\"Anna Carter\":mailto:anna@northwind.studio");
    const text = renderEmail(zoom.doc).text;
    expect(text).toContain("30 minutes on Zoom, Warsaw time.");
    expect(text).not.toContain("Google is sending");
    expect(text).toContain("invite.ics");
  });

  it("renders the same email twice from one payload (retry-safe)", () => {
    const first = BOOKING_QUEUED.booking_guest_confirmed(payload(BOOKING_ZOOM_FIXTURE));
    const second = BOOKING_QUEUED.booking_guest_confirmed(payload(BOOKING_ZOOM_FIXTURE));
    expect(renderEmail(first.doc).html).toBe(renderEmail(second.doc).html);
    expect(first.attachments?.[0]?.content).toBe(second.attachments?.[0]?.content);
  });

  it("C2 tells an extra guest who added them, with a calendar file when Google isn't inviting", () => {
    const queued = BOOKING_QUEUED.booking_guest_added(payload(BOOKING_ZOOM_FIXTURE));
    const { subject, text } = renderEmail(queued.doc);
    expect(queued.fromName).toBe("Anna Carter via Moduo");
    expect(queued.replyTo).toBeUndefined();
    expect(subject).toBe("Tom Becker added you: Anna Carter, Fri 16 Oct at 14:00");
    expect(text).toContain("Tom Becker added you to a meeting with Anna on Friday 16 October at 14:00.");
    expect(text).toContain("Can't make it? Let Tom know.");
    expect(text).not.toContain("cancel?token");
    expect(queued.attachments?.[0]?.contentType).toContain("method=REQUEST");
    expect(BOOKING_QUEUED.booking_guest_added(payload(BOOKING_FIXTURE)).attachments).toBeUndefined();
  });

  it("C5 confirms the guest's cancel, cancels the calendar file on Zoom-only links, no badge", () => {
    const queued = BOOKING_QUEUED.booking_guest_cancelled(payload(BOOKING_ZOOM_FIXTURE));
    const { subject, text } = renderEmail(queued.doc);
    expect(subject).toBe("You canceled your meeting with Anna Carter");
    expect(text).toContain("You canceled your meeting with Anna on Friday 16 October at 14:00.");
    expect(text).toContain("Anna knows.");
    expect(text).toContain("https://moduo.app/book/anna");
    expect(text).not.toContain("Scheduled with Moduo");
    const ics = decode(queued.attachments?.[0]?.content ?? "");
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("UID:booking-8f0c2a4e-1b6d-4c3a-9e7f-2d5b8a1c6e90@moduo.app");
    expect(BOOKING_QUEUED.booking_guest_cancelled(payload(BOOKING_FIXTURE)).attachments).toBeUndefined();
  });
});

describe("booking emails · host", () => {
  it("C3 replies to the guest, uses the host's zone, and includes the note and answers", () => {
    const data = {
      ...BOOKING_FIXTURE,
      zone: "America/New_York",
      answers: [{ label: "Company", value: "Becker Studio" }],
    };
    const queued = BOOKING_QUEUED.booking_host_new(payload(data));
    const { subject, text } = renderEmail(queued.doc);
    expect(queued.fromName).toBeUndefined();
    expect(queued.replyTo).toBe("tom@becker.studio");
    expect(queued.attachments).toBeUndefined();
    expect(subject).toBe("New booking: Tom Becker, Fri 16 Oct at 08:00");
    expect(text).toContain("Tom Becker booked 30 minutes with you on Friday 16 October at 08:00.");
    expect(text).toContain("Keen to talk about the redesign.");
    expect(text).toContain("Becker Studio");
    expect(text).toContain("Intro call");
    expect(text).toContain("It's on your Moduo calendar and your Google Calendar.");
    expect(text).toContain(BOOKING_SETTINGS_URL);
    expect(text).toContain("https://app.moduo.app/calendar?event=");
  });

  it("C3 on a Zoom-only link doesn't claim a Google Calendar copy", () => {
    const text = renderEmail(bookingHostNewEmail(BOOKING_ZOOM_FIXTURE)).text;
    expect(text).toContain("It's on your Moduo calendar. Reply to this email to reach Tom.");
  });

  it("C4 tells the host, replies to the guest", () => {
    const queued = BOOKING_QUEUED.booking_host_guest_cancelled(payload(BOOKING_FIXTURE));
    const { subject, preheader, text } = renderEmail(queued.doc);
    expect(queued.replyTo).toBe("tom@becker.studio");
    expect(subject).toBe("Canceled: Tom Becker, Fri 16 Oct at 14:00");
    expect(preheader).toBe("The time is open on your Intro call link again.");
    expect(text).toContain("Tom Becker canceled your meeting on Friday 16 October at 14:00.");
  });
});

describe("booking payload", () => {
  it("refuses a payload the templates can't render", () => {
    expect(() => parseBookingPayload({})).toThrow();
    expect(() => parseBookingPayload({ ...payload(BOOKING_FIXTURE), start: "soon" })).toThrow();
    expect(() => parseBookingPayload({ ...payload(BOOKING_FIXTURE), googleInvites: "yes" })).toThrow();
  });

  it("writes in a usable zone even when the payload's isn't", () => {
    const text = renderEmail(bookingGuestConfirmedEmail({ ...BOOKING_FIXTURE, zone: "Mars/Olympus" })).text;
    expect(text).toContain("at 12:00");
    expect(text).toContain("on Google Meet, UTC.");
  });
});
