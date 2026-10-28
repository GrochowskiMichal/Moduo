// CALR-8: the web runtime's Google-first edit. Google takes start and end
// together, so a one-edge move sends both; a place the edit cleared reaches
// the mirror as empty (the sync mapper leaves an absent place out); the saved
// event keeps the server's stamp, not this device's clock.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import type { CalendarAccountModel, CalendarEventModel } from "../features/calendar/events";
import { webCalendar } from "./runtime.web.calendar";

const h = rs.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  answer: {} as Record<string, unknown>,
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
}));

rs.mock("../features/calendar/google-web", () => ({
  updateGoogleWebEvent: async (input: Record<string, unknown>) => {
    h.sent.push(input);
    return { ...h.answer };
  },
  removeGoogleWebEvent: async () => {},
}));

rs.mock("./runtime.web.client", () => ({
  supabaseClient: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcs.push({ fn, args });
      return Promise.resolve({ data: { upserted: 1, removed: 0 }, error: null });
    },
  },
}));

const EVENT: CalendarEventModel = {
  id: "row-1",
  workspaceId: "w1",
  ownerId: "u1",
  sourceAccountId: "acc-g",
  externalEventId: "g1",
  calendarId: "google:me@x.com:primary",
  title: "Board",
  description: "",
  startsAt: "2026-11-05T09:00:00.000Z",
  endsAt: "2026-11-05T10:00:00.000Z",
  allDay: false,
  rrule: null,
  status: "confirmed",
  location: "Room 4",
  color: null,
  createdAt: "2026-10-28T08:00:00Z",
  updatedAt: "2026-10-28T08:00:00Z",
  deletedAt: null,
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

beforeEach(() => {
  h.sent.length = 0;
  h.rpcs.length = 0;
  h.answer = {
    externalEventId: "g1",
    title: "Board",
    startsAt: "2026-11-05T09:00:00.000Z",
    endsAt: "2026-11-05T11:00:00.000Z",
    allDay: false,
    calendarId: "google:me@x.com:primary",
  };
});

describe("webCalendar.updateGoogleEvent", () => {
  it("a one-edge move sends both edges and the event's all-day-ness", async () => {
    await webCalendar.updateGoogleEvent({
      workspaceId: "w1",
      event: EVENT,
      account: ACCOUNT,
      patch: { endsAt: "2026-11-05T11:00:00.000Z" },
    });
    expect(h.sent[0]?.patch).toEqual({
      startsAt: EVENT.startsAt,
      endsAt: "2026-11-05T11:00:00.000Z",
      allDay: false,
    });
  });

  it("a title edit sends no times", async () => {
    await webCalendar.updateGoogleEvent({
      workspaceId: "w1",
      event: EVENT,
      account: ACCOUNT,
      patch: { title: "Board (moved)" },
    });
    expect(h.sent[0]?.patch).toEqual({ title: "Board (moved)" });
  });

  it("a cleared place reaches the mirror as empty, and the result has none", async () => {
    const saved = await webCalendar.updateGoogleEvent({
      workspaceId: "w1",
      event: EVENT,
      account: ACCOUNT,
      patch: { location: null },
    });
    const mirror = h.rpcs.find((r) => r.fn === "calendar_op_mirror_events");
    const sentEvents = (mirror?.args.p_events ?? []) as { location?: string }[];
    expect(sentEvents[0]?.location).toBe("");
    expect(saved.location).toBeNull();
  });

  it("keeps the server's stamp on the saved event", async () => {
    const saved = await webCalendar.updateGoogleEvent({
      workspaceId: "w1",
      event: EVENT,
      account: ACCOUNT,
      patch: { title: "x" },
    });
    expect(saved.updatedAt).toBe(EVENT.updatedAt);
    expect(saved.endsAt).toBe("2026-11-05T11:00:00.000Z");
  });
});
