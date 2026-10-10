import { describe, expect, it } from "@rstest/core";

import { type BookingFacts, bookEmails, cancelEmails, guestTimeZone } from "./emails.ts";

const FACTS: BookingFacts = {
  bookingId: "b1",
  link: { name: "Intro call", durationMinutes: 30, hostZone: "Europe/Warsaw" },
  start: "2026-10-16T12:00:00Z",
  end: "2026-10-16T12:30:00Z",
  guestZone: "America/New_York",
  video: "Google Meet",
  joinUrl: "https://meet.google.com/abc-defg-hij",
  host: { name: "Anna Carter", avatarUrl: null, email: "anna@northwind.studio" },
  hostInbox: { email: "anna@moduo-account.test", userId: "u-anna" },
  guest: { name: "Tom Becker", email: "tom@becker.studio" },
  guests: ["sam@lee.design", "Priya@Nair.dev"],
  googleInvites: true,
  at: "2026-10-09T09:12:00Z",
};
const EXTRA = {
  cancelUrl: "https://moduo.app/book/cancel?token=t",
  openUrl: "https://app.moduo.app/calendar?event=e1",
  note: "Keen to talk",
  answers: [{ label: "Company", value: "Becker Studio" }],
};
const BEFORE = Date.parse("2026-10-15T09:00:00Z");

describe("booking-public · book enqueue", () => {
  it("queues C1 for the booker and C3 for the host; Google invites the extra guests", () => {
    const out = bookEmails(FACTS, EXTRA);
    expect(out.map((r) => [r.kind, r.to, r.dedupeKey])).toEqual([
      ["booking_guest_confirmed", "tom@becker.studio", "C1:b1"],
      ["booking_host_new", "anna@moduo-account.test", "C3:b1"],
    ]);
    const [guest, host] = out;
    expect(guest.payload.zone).toBe("America/New_York");
    expect(guest.payload.cancelUrl).toBe(EXTRA.cancelUrl);
    expect(guest.payload.note).toBeUndefined();
    expect(host.toUserId).toBe("u-anna");
    expect(host.payload.zone).toBe("Europe/Warsaw");
    expect(host.payload.note).toBe("Keen to talk");
    expect(host.payload.answers).toEqual(EXTRA.answers);
    expect(host.payload.openUrl).toBe(EXTRA.openUrl);
  });

  it("queues C2 for each extra guest when Google isn't inviting them", () => {
    const out = bookEmails(
      { ...FACTS, googleInvites: false, guests: [...FACTS.guests, "priya@nair.dev", "TOM@becker.studio"] },
      EXTRA,
    );
    const added = out.filter((r) => r.kind === "booking_guest_added");
    expect(added.map((r) => r.dedupeKey)).toEqual(["C2:b1:sam@lee.design", "C2:b1:priya@nair.dev"]);
    expect(added.every((r) => r.payload.googleInvites === false)).toBe(true);
  });

  it("falls back to the host's zone, and then UTC, for a zone it can't use", () => {
    expect(guestTimeZone("Mars/Olympus", "Europe/Warsaw")).toBe("Europe/Warsaw");
    expect(guestTimeZone(undefined, "Nope/Nope")).toBe("UTC");
    expect(guestTimeZone("europe/warsaw", "UTC")).toBe("Europe/Warsaw");
    const [guest] = bookEmails({ ...FACTS, guestZone: "+01:00" }, EXTRA);
    expect(guest.payload.zone).toBe("Europe/Warsaw");
  });

  it("skips the host email when there's no address to send it to", () => {
    const out = bookEmails({ ...FACTS, hostInbox: { email: "", userId: null } }, EXTRA);
    expect(out.map((r) => r.kind)).toEqual(["booking_guest_confirmed"]);
  });
});

describe("booking-public · cancel enqueue", () => {
  it("queues C4 for the host and C5 for the booker, and cancels the reminder", () => {
    const { enqueue, cancelPrefixes } = cancelEmails(FACTS, { rebookUrl: "https://moduo.app/book/anna", nowMs: BEFORE });
    expect(enqueue.map((r) => [r.kind, r.to, r.dedupeKey])).toEqual([
      ["booking_host_guest_cancelled", "anna@moduo-account.test", "C4:b1"],
      ["booking_guest_cancelled", "tom@becker.studio", "C5:b1"],
    ]);
    expect(enqueue[1].payload.rebookUrl).toBe("https://moduo.app/book/anna");
    expect(enqueue[1].payload.zone).toBe("America/New_York");
    expect(enqueue[0].payload.zone).toBe("Europe/Warsaw");
    expect(cancelPrefixes).toEqual(["C7:b1"]);
  });

  it("sends nothing for a cancel after the meeting started", () => {
    const { enqueue, cancelPrefixes } = cancelEmails(FACTS, {
      rebookUrl: "https://moduo.app/book/anna",
      nowMs: Date.parse("2026-10-16T12:05:00Z"),
    });
    expect(enqueue).toEqual([]);
    expect(cancelPrefixes).toEqual(["C7:b1"]);
  });

  it("on a Zoom-only booking, also cancels the extra guests' calendar files", () => {
    const { enqueue } = cancelEmails(
      { ...FACTS, googleInvites: false, guests: [...FACTS.guests, "TOM@becker.studio", "sam@lee.design"] },
      { rebookUrl: "https://moduo.app/book/anna", nowMs: BEFORE },
    );
    const added = enqueue.filter((r) => r.payload.recipient === "added");
    expect(added.map((r) => [r.kind, r.to, r.dedupeKey])).toEqual([
      ["booking_guest_cancelled", "sam@lee.design", "C5:b1:sam@lee.design"],
      ["booking_guest_cancelled", "priya@nair.dev", "C5:b1:priya@nair.dev"],
    ]);
    expect(added.every((r) => r.payload.rebookUrl === undefined)).toBe(true);
  });

  it("leaves extra guests to Google when Google invited them", () => {
    const { enqueue } = cancelEmails(FACTS, { rebookUrl: "https://moduo.app/book/anna", nowMs: BEFORE });
    expect(enqueue.some((r) => r.payload.recipient === "added")).toBe(false);
  });
});
