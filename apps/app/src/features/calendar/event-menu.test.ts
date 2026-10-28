// AC26 (CALR-4b): right-click (or ⌃↵) opens a short event menu without
// shortcuts; ⋯ in the Event panel shows the same items with their keys. Here,
// which items an event gets, their keys, and where "Move to another calendar"
// may take it (one event, never two: only moves Moduo can undo whole).

import { describe, expect, it } from "@rstest/core";

import { eventMenuItems, menuShortcut, moveTargets } from "./event-menu";
import type { CalendarAccountModel, CalendarEventModel } from "./events";

const ME = "u-me";

function event(over: Partial<CalendarEventModel> = {}): CalendarEventModel {
  return {
    id: "ev-a",
    workspaceId: "ws-1",
    ownerId: ME,
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Design review",
    description: "",
    startsAt: "2026-11-03T10:00:00.000Z",
    endsAt: "2026-11-03T11:00:00.000Z",
    allDay: false,
    rrule: null,
    status: "confirmed",
    location: null,
    color: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    deletedAt: null,
    attendees: [],
    isPrivate: false,
    ...over,
  };
}

function account(over: Partial<CalendarAccountModel> & { id: string }): CalendarAccountModel {
  return {
    workspaceId: "ws-1",
    ownerId: ME,
    provider: "google",
    externalId: `${over.id}@group.calendar.google.com`,
    displayLabel: "Work",
    isDefaultTarget: false,
    color: null,
    lastSyncAt: null,
    status: "active",
    syncToken: null,
    deletedAt: null,
    readOnly: false,
    ...over,
  };
}

const WORK = account({ id: "acc-work", displayLabel: "Work" });
const TARGETS = [{ id: "acc-work", label: "Work" }];

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("eventMenuItems", () => {
  it("your own Moduo event: the whole menu, in the spec's order, without a Meet link", () => {
    const items = eventMenuItems({
      event: event(),
      writer: "moduo",
      canEdit: true,
      currentUserId: ME,
      targets: TARGETS,
      surface: "grid",
    });
    expect(ids(items)).toEqual(["open", "copy", "duplicate", "private", "move", "link", "delete"]);
    expect(items.map((i) => i.label)).toEqual([
      "Open",
      "Copy",
      "Duplicate",
      "Make private",
      "Move to another calendar",
      "Link a person, note or task",
      "Delete",
    ]);
    expect(items.find((i) => i.id === "delete")?.destructive).toBe(true);
  });

  it("a Google event you can write: Add a Meet link while it has none", () => {
    const google = event({ sourceAccountId: "acc-work", externalEventId: "g-1" });
    const items = eventMenuItems({
      event: google,
      writer: "google",
      canEdit: true,
      currentUserId: ME,
      targets: [],
      surface: "grid",
    });
    expect(ids(items)).toEqual(["open", "copy", "duplicate", "meet", "private", "link", "delete"]);
    expect(items.find((i) => i.id === "meet")?.label).toBe("Add a Meet link");

    const withLink = eventMenuItems({
      event: { ...google, conferenceUrl: "https://meet.google.com/abc-defg-hij" },
      writer: "google",
      canEdit: true,
      currentUserId: ME,
      targets: [],
      surface: "grid",
    });
    expect(ids(withLink)).not.toContain("meet");
  });

  it("a private event says Make public", () => {
    const items = eventMenuItems({
      event: event({ isPrivate: true }),
      writer: "moduo",
      canEdit: true,
      currentUserId: ME,
      targets: [],
      surface: "grid",
    });
    expect(items.find((i) => i.id === "private")?.label).toBe("Make public");
  });

  it("an event you can't change: open, copy, duplicate (onto Your calendar) and link", () => {
    const items = eventMenuItems({
      event: event({ sourceAccountId: "acc-holidays", externalEventId: "h-1" }),
      writer: null,
      canEdit: true,
      currentUserId: ME,
      targets: TARGETS,
      surface: "grid",
    });
    expect(ids(items)).toEqual(["open", "copy", "duplicate", "link"]);
  });

  it("a teammate's event you may edit offers no Private: privacy is the owner's", () => {
    const items = eventMenuItems({
      event: event({ ownerId: "u-kai" }),
      writer: "moduo",
      canEdit: true,
      currentUserId: ME,
      targets: [],
      surface: "grid",
    });
    expect(ids(items)).not.toContain("private");
    expect(ids(items)).toContain("delete");
  });

  it("view-only access to Calendar: open and copy only", () => {
    const items = eventMenuItems({
      event: event(),
      writer: "moduo",
      canEdit: false,
      currentUserId: ME,
      targets: TARGETS,
      surface: "grid",
    });
    expect(ids(items)).toEqual(["open", "copy"]);
  });

  it("a teammate's masked private event (Busy) only opens", () => {
    const items = eventMenuItems({
      event: event({ id: "busy-1", ownerId: "u-kai", title: "Busy" }),
      writer: null,
      canEdit: true,
      currentUserId: ME,
      targets: [],
      surface: "grid",
    });
    expect(ids(items)).toEqual(["open"]);
  });

  it("no target to move to: no Move item", () => {
    const items = eventMenuItems({
      event: event(),
      writer: "moduo",
      canEdit: true,
      currentUserId: ME,
      targets: [],
      surface: "grid",
    });
    expect(ids(items)).not.toContain("move");
  });

  it("the Event panel's ⋯ has the same items but Open (you are in it), each with its key", () => {
    const grid = eventMenuItems({
      event: event(),
      writer: "moduo",
      canEdit: true,
      currentUserId: ME,
      targets: TARGETS,
      surface: "grid",
    });
    const panel = eventMenuItems({
      event: event(),
      writer: "moduo",
      canEdit: true,
      currentUserId: ME,
      targets: TARGETS,
      surface: "panel",
    });
    expect(ids(panel)).toEqual(ids(grid).filter((id) => id !== "open"));
    expect(Object.fromEntries(panel.map((i) => [i.id, i.hotkey]))).toEqual({
      copy: "calendar.copy",
      duplicate: "calendar.duplicate",
      private: "calendar.private",
      move: null,
      link: "calendar.link",
      delete: "calendar.delete",
    });
  });
});

describe("menuShortcut", () => {
  it("says each key as the keys sheet does", () => {
    expect(menuShortcut("calendar.copy", true)).toBe("⌘C");
    expect(menuShortcut("calendar.duplicate", true)).toBe("⌘D");
    expect(menuShortcut("calendar.add-meet", true)).toBe("V");
    expect(menuShortcut("calendar.private", true)).toBe("P");
    expect(menuShortcut("calendar.link", true)).toBe("L");
    expect(menuShortcut("calendar.delete", true)).toBe("⌫");
    expect(menuShortcut("calendar.menu", true)).toBe("⌃↵");
    expect(menuShortcut("calendar.copy", false)).toBe("Ctrl C");
  });
});

describe("moveTargets", () => {
  it("a one-off Moduo event can go to a Google calendar you can write", () => {
    const accounts = [
      WORK,
      account({ id: "acc-family", displayLabel: "Family" }),
      account({ id: "acc-holidays", displayLabel: "Holidays", readOnly: true }),
      account({ id: "acc-gone", displayLabel: "Old", deletedAt: "2026-10-01T00:00:00Z" }),
      account({ id: "acc-kai", displayLabel: "Kai's", ownerId: "u-kai" }),
      account({ id: "acc-outlook", displayLabel: "Outlook", provider: "microsoft" }),
    ];
    expect(moveTargets(event(), accounts, ME)).toEqual([
      { id: "acc-work", label: "Work" },
      { id: "acc-family", label: "Family" },
    ]);
  });

  it("never offers a move Moduo can't make whole: repeats, people, places, links, privacy, focus", () => {
    const cases: Partial<CalendarEventModel>[] = [
      { rrule: "FREQ=WEEKLY" },
      { seriesId: "series-1", originalStart: "2026-11-03T10:00:00.000Z" },
      { attendees: [{ email: "priya@example.com", name: "Priya", status: "accepted" }] },
      { location: "Hale & Co, 2nd floor" },
      { conferenceUrl: "https://zoom.us/j/123" },
      { isPrivate: true },
      { kind: "focus" },
    ];
    for (const over of cases) expect(moveTargets(event(over), [WORK], ME)).toEqual([]);
  });

  it("a Google event isn't moved from here yet", () => {
    const google = event({ sourceAccountId: "acc-family", externalEventId: "g-1" });
    expect(moveTargets(google, [WORK, account({ id: "acc-family" })], ME)).toEqual([]);
  });

  it("nobody signed in: nowhere to go", () => {
    expect(moveTargets(event(), [WORK], null)).toEqual([]);
  });
});
