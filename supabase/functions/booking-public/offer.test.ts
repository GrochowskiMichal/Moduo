// booking-public's offer mode (CALR-19, specs/calendar-rethink.md AC34): a
// guest opens /book/r/<slug> and picks one of the times the host offered. Pure
// rules here; the pick itself (book one, release the rest, in one transaction)
// is booking_op_offer_book (supabase/tests/slot_offers.test.sql).

import { describe, expect, it } from "@rstest/core";

import {
  type OfferRow,
  type OfferTimeRow,
  offerAsLink,
  offerBookFailure,
  offerSlots,
  offerState,
  offerTimeAt,
} from "./offer.ts";

const NOW = new Date("2026-11-02T12:00:00.000Z");

function offer(over: Partial<OfferRow> = {}): OfferRow {
  return {
    id: "offer-1",
    slug: "intro-4kq7xzt2",
    link_id: "link-1",
    owner_id: "host",
    workspace_id: "w1",
    title: "Investor meeting",
    duration_minutes: 45,
    video_provider: "zoom",
    hold: true,
    expires_at: "2026-11-04T12:00:00.000Z",
    status: "open",
    ...over,
  };
}

const time = (id: string, start: string, minutes = 45): OfferTimeRow => ({
  id,
  offer_id: "offer-1",
  start_at: start,
  end_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
});

const TIMES = [
  time("t3", "2026-11-05T09:00:00.000Z"),
  time("t1", "2026-11-02T09:00:00.000Z"), // already past
  time("t2", "2026-11-03T14:00:00.000Z"),
];

describe("offerState", () => {
  it("an open offer past its 48 hours reads as expired", () => {
    expect(offerState(offer(), NOW)).toBe("open");
    expect(offerState(offer({ expires_at: "2026-11-02T12:00:00.000Z" }), NOW)).toBe("expired");
    expect(offerState(offer({ expires_at: "2026-11-01T12:00:00.000Z" }), NOW)).toBe("expired");
  });

  it("a closed offer keeps its status", () => {
    expect(offerState(offer({ status: "booked" }), NOW)).toBe("booked");
    expect(offerState(offer({ status: "released" }), NOW)).toBe("released");
    expect(offerState(offer({ status: "booked", expires_at: "2026-11-01T00:00:00.000Z" }), NOW)).toBe("booked");
  });

  it("an unknown status reads as closed, never open", () => {
    expect(offerState(offer({ status: "weird" }), NOW)).not.toBe("open");
  });
});

describe("offerSlots", () => {
  it("offers the times still ahead, in time order", () => {
    expect(offerSlots(offer(), TIMES, NOW).map((d) => d.toISOString())).toEqual([
      "2026-11-03T14:00:00.000Z",
      "2026-11-05T09:00:00.000Z",
    ]);
  });

  it("offers nothing once the offer is picked, released or expired", () => {
    expect(offerSlots(offer({ status: "booked" }), TIMES, NOW)).toEqual([]);
    expect(offerSlots(offer({ status: "released" }), TIMES, NOW)).toEqual([]);
    expect(offerSlots(offer({ expires_at: "2026-11-02T11:00:00.000Z" }), TIMES, NOW)).toEqual([]);
  });
});

describe("offerTimeAt", () => {
  it("finds the offered time a guest picked, to the second", () => {
    expect(offerTimeAt(TIMES, new Date("2026-11-03T14:00:00.400Z"))?.id).toBe("t2");
    expect(offerTimeAt(TIMES, new Date("2026-11-03T14:30:00.000Z"))).toBeNull();
  });
});

describe("offerAsLink", () => {
  const link = { name: "Intro call", duration_minutes: 30, video_provider: "google_meet", slug: "intro" };

  it("the offer's title, length and video stand in for the link's", () => {
    expect(offerAsLink(link, offer())).toEqual({
      name: "Investor meeting",
      duration_minutes: 45,
      video_provider: "zoom",
      slug: "intro",
    });
  });

  it("an offer without its own video keeps the link's", () => {
    expect(offerAsLink(link, offer({ video_provider: null })).video_provider).toBe("google_meet");
  });
});

describe("offerBookFailure", () => {
  it("a closed or expired offer is a 409 the page explains", () => {
    expect(offerBookFailure("offer_closed")).toEqual({ error: "offer_closed", status: 409 });
    expect(offerBookFailure("offer_expired")).toEqual({ error: "offer_closed", status: 409 });
  });

  it("a time that isn't offered is taken", () => {
    expect(offerBookFailure("offer_time_unknown")).toEqual({ error: "slot_taken", status: 409 });
  });

  it("anything else failed the booking", () => {
    expect(offerBookFailure("connection reset")).toEqual({ error: "book_failed", status: 500 });
  });
});
