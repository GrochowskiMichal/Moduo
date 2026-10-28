// The web runtime's offer calls (CALR-19, specs/calendar-rethink.md AC34):
// making an offer (its times, held or not) and releasing its holds, each one
// RPC. The link's title, length and video ride along only when set, so the
// offer takes the link's own otherwise.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import { webCalendar } from "./runtime.web.calendar";

type Reply = { data: unknown; error: { message: string; code?: string } | null };

const h = rs.hoisted(() => ({
  reply: { data: null, error: null } as Reply,
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
}));

rs.mock("./runtime.web.client", () => ({
  supabaseClient: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcs.push({ fn, args });
      return Promise.resolve(h.reply);
    },
  },
}));

beforeEach(() => {
  h.reply = { data: null, error: null };
  h.rpcs.length = 0;
});

const TIMES = ["2026-11-03T08:00:00.000Z", "2026-11-04T09:00:00.000Z"];

describe("webCalendar.createOffer", () => {
  it("sends the link, the times and whether to hold them, nothing unset", async () => {
    h.reply = {
      data: {
        id: "offer-1",
        slug: "intro-4kq7xzt2",
        status: "open",
        expires_at: "2026-11-02T12:00:00+00:00",
        hold_event_ids: ["e1", "e2"],
      },
      error: null,
    };
    const offer = await webCalendar.createOffer!({
      workspaceId: "w1",
      linkId: "l1",
      startsAt: TIMES,
      hold: true,
    });
    expect(h.rpcs).toEqual([
      {
        fn: "calendar_op_offer_create",
        args: { p_workspace_id: "w1", p_link_id: "l1", p_starts_at: TIMES, p_hold: true },
      },
    ]);
    expect(offer).toEqual({
      id: "offer-1",
      slug: "intro-4kq7xzt2",
      status: "open",
      expiresAt: "2026-11-02T12:00:00+00:00",
      holdEventIds: ["e1", "e2"],
    });
  });

  it("sends a title, length and video only when the offer sets them", async () => {
    h.reply = {
      data: { id: "o2", slug: "intro-x", status: "open", expires_at: "2026-11-02T12:00:00+00:00", hold_event_ids: [] },
      error: null,
    };
    const offer = await webCalendar.createOffer!({
      workspaceId: "w1",
      linkId: "l1",
      startsAt: TIMES.slice(0, 1),
      hold: false,
      title: "Investor meeting",
      durationMinutes: 45,
      videoProvider: "zoom",
    });
    expect(h.rpcs[0]?.args).toEqual({
      p_workspace_id: "w1",
      p_link_id: "l1",
      p_starts_at: TIMES.slice(0, 1),
      p_hold: false,
      p_title: "Investor meeting",
      p_duration_minutes: 45,
      p_video_provider: "zoom",
    });
    expect(offer.holdEventIds).toEqual([]);
  });

  it("throws what the database refused", async () => {
    h.reply = { data: null, error: { message: "Booking link not found.", code: "P0001" } };
    await expect(
      webCalendar.createOffer!({ workspaceId: "w1", linkId: "nope", startsAt: TIMES, hold: true }),
    ).rejects.toThrow("Booking link not found.");
  });
});

describe("webCalendar.releaseOffer", () => {
  it("releases by the offer and answers its status after", async () => {
    h.reply = { data: "released", error: null };
    const status = await webCalendar.releaseOffer!({ workspaceId: "w1", offerId: "offer-1" });
    expect(h.rpcs).toEqual([
      { fn: "calendar_op_offer_release", args: { p_workspace_id: "w1", p_offer_id: "offer-1" } },
    ]);
    expect(status).toBe("released");
  });

  it("throws what the database refused", async () => {
    h.reply = { data: null, error: { message: "Offer not found." } };
    await expect(webCalendar.releaseOffer!({ workspaceId: "w1", offerId: "x" })).rejects.toThrow("Offer not found.");
  });
});
