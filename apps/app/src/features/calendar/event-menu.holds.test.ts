// An offer's hold in the event menu (CALR-19, AC34): it goes with its offer,
// so it offers Copy and Release holds, never a move, a duplicate or a delete
// that would leave its offered time bookable but unheld.

import { describe, expect, it } from "@rstest/core";

import { eventMenuItems } from "./event-menu";
import type { CalendarEventModel } from "./events";

const hold: CalendarEventModel = {
  id: "h1",
  workspaceId: "ws-1",
  ownerId: "u-me",
  sourceAccountId: null,
  externalEventId: null,
  calendarId: "moduo",
  title: "Held · Investor meeting",
  description: "",
  startsAt: "2026-11-03T10:00:00.000Z",
  endsAt: "2026-11-03T10:30:00.000Z",
  allDay: false,
  rrule: null,
  status: "confirmed",
  color: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  deletedAt: null,
  kind: "hold",
  offerId: "offer-1",
};

const ids = (event: CalendarEventModel, canEdit = true) =>
  eventMenuItems({
    event,
    writer: canEdit ? "moduo" : null,
    canEdit,
    currentUserId: "u-me",
    targets: [{ id: "acc-work", label: "Work" }],
    surface: "grid",
  }).map((i) => i.id);

describe("a hold's menu", () => {
  it("opens, copies and releases its offer's holds, nothing else", () => {
    expect(ids(hold)).toEqual(["open", "copy", "release"]);
  });

  it("without the right to write, it only opens and copies", () => {
    expect(ids(hold, false)).toEqual(["open", "copy"]);
  });
});
