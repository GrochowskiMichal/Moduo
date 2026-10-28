// CALR-20b contract: the same meeting reached through two connected logins
// shows once (specs/calendar-rethink.md, Assumptions "New events go to"),
// matched on Google's iCalUID, and the copy you can edit wins. The mirror
// starts storing iCalUID in this block. The iCalUID comes from the client's
// mirror call, so it is only a hint: only copies from your own connected
// accounts, at the same start and end, ever merge, and only when exactly one of
// them is yours to edit; otherwise both show.

import { describe, expect, it } from "@rstest/core";

import type { CalendarAccountModel, CalendarEventModel } from "./events";
import { mapGoogleEvent } from "./mirror";
import { oneChipPerMeeting } from "./one-meeting";

const ME = "u-me";
const KAI = "u-kai";

function account(over: Partial<CalendarAccountModel> & { id: string }): CalendarAccountModel {
  return {
    workspaceId: "w1",
    ownerId: ME,
    provider: "google",
    externalId: `google:x:${over.id}`,
    displayLabel: over.id,
    isDefaultTarget: false,
    color: null,
    lastSyncAt: null,
    status: "ok",
    syncToken: null,
    deletedAt: null,
    readOnly: false,
    busyDefault: true,
    lastError: null,
    ...over,
  };
}

const WORK = account({ id: "acc-work" });
const GUEST = account({ id: "acc-guest", readOnly: true });
const KAIS = account({ id: "acc-kai", ownerId: KAI });
const ICS = account({ id: "acc-ics", provider: "ics" });
const ACCOUNTS = [WORK, GUEST, KAIS, ICS];

function ev(over: Partial<CalendarEventModel> & { id: string }): CalendarEventModel {
  return {
    workspaceId: "w1",
    ownerId: ME,
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "primary",
    title: "Board",
    description: "",
    startsAt: "2026-11-05T10:00:00.000Z",
    endsAt: "2026-11-05T11:00:00.000Z",
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: "2026-10-28T08:00:00.000Z",
    updatedAt: "2026-10-28T08:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}

const ids = (events: CalendarEventModel[]) => events.map((e) => e.id);

describe("one chip per meeting", () => {
  it("shows a meeting two logins see once, keeping the copy you can edit", () => {
    const readOnlyCopy = ev({
      id: "e-guest",
      sourceAccountId: "acc-guest",
      externalEventId: "h1",
      icalUid: "m1@google.com",
    });
    const mine = ev({
      id: "e-work",
      sourceAccountId: "acc-work",
      externalEventId: "g1",
      icalUid: "m1@google.com",
    });
    expect(ids(oneChipPerMeeting([readOnlyCopy, mine], ACCOUNTS, ME))).toEqual(["e-work"]);
    expect(ids(oneChipPerMeeting([mine, readOnlyCopy], ACCOUNTS, ME))).toEqual(["e-work"]);
  });

  it("never merges a teammate's row, even one carrying the same iCalUID and times: both show", () => {
    const kais = ev({
      id: "e-kai",
      ownerId: KAI,
      sourceAccountId: "acc-kai",
      externalEventId: "k1",
      icalUid: "m2@google.com",
    });
    const mine = ev({
      id: "e-work",
      sourceAccountId: "acc-work",
      externalEventId: "g2",
      icalUid: "m2@google.com",
    });
    expect(ids(oneChipPerMeeting([kais, mine], ACCOUNTS, ME))).toEqual(["e-kai", "e-work"]);
    // A teammate's row that names one of your accounts still isn't yours to merge.
    const forged = ev({
      id: "e-forged",
      ownerId: KAI,
      sourceAccountId: "acc-work",
      externalEventId: "f1",
      icalUid: "m2@google.com",
    });
    expect(ids(oneChipPerMeeting([forged, mine], ACCOUNTS, ME))).toEqual(["e-forged", "e-work"]);
  });

  it("never lets another person's copy hide yours", () => {
    const theirs = ev({ id: "e-0", ownerId: KAI, icalUid: "m4@google.com" });
    const mine = ev({
      id: "e-z",
      sourceAccountId: "acc-guest",
      externalEventId: "z1",
      icalUid: "m4@google.com",
    });
    expect(ids(oneChipPerMeeting([theirs, mine], ACCOUNTS, ME))).toContain("e-z");
  });

  it("merges only copies at the same start and end", () => {
    const moved = ev({
      id: "e-guest",
      sourceAccountId: "acc-guest",
      externalEventId: "h5",
      icalUid: "m5@google.com",
      startsAt: "2026-11-05T12:00:00.000Z",
      endsAt: "2026-11-05T13:00:00.000Z",
    });
    const mine = ev({
      id: "e-work",
      sourceAccountId: "acc-work",
      externalEventId: "g5",
      icalUid: "m5@google.com",
    });
    expect(ids(oneChipPerMeeting([moved, mine], ACCOUNTS, ME))).toEqual(["e-guest", "e-work"]);
  });

  it("keeps both when no copy, or more than one, is yours to edit (never a pick by id)", () => {
    const a = ev({ id: "e-a", sourceAccountId: "acc-guest", externalEventId: "a", icalUid: "m3" });
    const b = ev({ id: "e-b", sourceAccountId: "acc-ics", externalEventId: "b", icalUid: "m3" });
    expect(ids(oneChipPerMeeting([a, b], ACCOUNTS, ME))).toEqual(["e-a", "e-b"]);
    const SIDE = account({ id: "acc-side" });
    const c = ev({ id: "e-c", sourceAccountId: "acc-work", externalEventId: "c", icalUid: "m6" });
    const d = ev({ id: "e-d", sourceAccountId: "acc-side", externalEventId: "d", icalUid: "m6" });
    expect(ids(oneChipPerMeeting([c, d], [...ACCOUNTS, SIDE], ME))).toEqual(["e-c", "e-d"]);
  });

  it("your two own logins, organizer on one and guest on the other: the organizer's copy wins", () => {
    const SIDE = account({ id: "acc-side" });
    const guest = ev({
      id: "e-guest-copy",
      sourceAccountId: "acc-side",
      externalEventId: "s8",
      icalUid: "m8@google.com",
      isOrganizer: false,
    });
    const organizer = ev({
      id: "e-organizer",
      sourceAccountId: "acc-work",
      externalEventId: "w8",
      icalUid: "m8@google.com",
      isOrganizer: true,
    });
    const all = [...ACCOUNTS, SIDE];
    expect(ids(oneChipPerMeeting([guest, organizer], all, ME))).toEqual(["e-organizer"]);
    expect(ids(oneChipPerMeeting([organizer, guest], all, ME))).toEqual(["e-organizer"]);
  });

  it("shows both when neither or both of your copies are the organizer's", () => {
    const SIDE = account({ id: "acc-side" });
    const all = [...ACCOUNTS, SIDE];
    const a = ev({ id: "e-a", sourceAccountId: "acc-work", externalEventId: "a9", icalUid: "m9" });
    const b = ev({ id: "e-b", sourceAccountId: "acc-side", externalEventId: "b9", icalUid: "m9" });
    expect(
      ids(
        oneChipPerMeeting(
          [
            { ...a, isOrganizer: true },
            { ...b, isOrganizer: true },
          ],
          all,
          ME,
        ),
      ),
    ).toEqual(["e-a", "e-b"]);
    expect(
      ids(
        oneChipPerMeeting(
          [
            { ...a, isOrganizer: false },
            { ...b, isOrganizer: null },
          ],
          all,
          ME,
        ),
      ),
    ).toEqual(["e-a", "e-b"]);
  });

  it("an organizer flag on a teammate's row never makes it win", () => {
    const kais = ev({
      id: "e-kai",
      ownerId: KAI,
      sourceAccountId: "acc-kai",
      externalEventId: "k10",
      icalUid: "m10",
      isOrganizer: true,
    });
    const mine = ev({
      id: "e-mine",
      sourceAccountId: "acc-guest",
      externalEventId: "g10",
      icalUid: "m10",
    });
    expect(ids(oneChipPerMeeting([kais, mine], ACCOUNTS, ME))).toEqual(["e-kai", "e-mine"]);
  });

  it("never merges native events, whatever they carry", () => {
    const native = ev({ id: "e-n", icalUid: "m7@google.com" });
    const mine = ev({
      id: "e-work",
      sourceAccountId: "acc-guest",
      externalEventId: "g7",
      icalUid: "m7@google.com",
    });
    expect(ids(oneChipPerMeeting([native, mine], ACCOUNTS, ME))).toEqual(["e-n", "e-work"]);
  });

  it("keeps each occurrence of a repeating meeting (instances share the iCalUID)", () => {
    const mon = ev({
      id: "e-mon",
      sourceAccountId: "acc-work",
      externalEventId: "r_20261102",
      icalUid: "r@google.com",
      externalSeriesId: "r",
      originalStart: "2026-11-02T09:00:00.000Z",
    });
    const tue = ev({
      id: "e-tue",
      sourceAccountId: "acc-work",
      externalEventId: "r_20261103",
      icalUid: "r@google.com",
      externalSeriesId: "r",
      originalStart: "2026-11-03T09:00:00.000Z",
    });
    const tueGuest = ev({
      id: "e-tue-guest",
      sourceAccountId: "acc-guest",
      externalEventId: "x_20261103",
      icalUid: "r@google.com",
      externalSeriesId: "x",
      originalStart: "2026-11-03T09:00:00.000Z",
    });
    expect(ids(oneChipPerMeeting([mon, tueGuest, tue], ACCOUNTS, ME))).toEqual(["e-mon", "e-tue"]);
  });

  it("leaves events without an iCalUID, and their order, alone", () => {
    const a = ev({ id: "e-1" });
    const b = ev({ id: "e-2", sourceAccountId: "acc-work", externalEventId: "g9" });
    const c = ev({ id: "e-3", icalUid: null });
    expect(ids(oneChipPerMeeting([c, a, b], ACCOUNTS, ME))).toEqual(["e-3", "e-1", "e-2"]);
  });

  it("returns the same list when nothing repeats", () => {
    const list = [ev({ id: "e-1", icalUid: "u1" }), ev({ id: "e-2", icalUid: "u2" })];
    expect(oneChipPerMeeting(list, ACCOUNTS, ME)).toBe(list);
  });
});

describe("the mirror carries Google's iCalUID", () => {
  it("maps iCalUID from Google's event", () => {
    const mapped = mapGoogleEvent({
      id: "g1",
      iCalUID: "g1@google.com",
      summary: "Board",
      start: { dateTime: "2026-11-05T10:00:00Z" },
      end: { dateTime: "2026-11-05T11:00:00Z" },
    });
    expect(mapped?.iCalUID).toBe("g1@google.com");
  });

  it("carries whether you organize it, only when Google names an organizer", () => {
    const base = {
      id: "g1",
      summary: "Board",
      start: { dateTime: "2026-11-05T10:00:00Z" },
      end: { dateTime: "2026-11-05T11:00:00Z" },
    };
    expect(mapGoogleEvent({ ...base, organizer: { email: "me@x", self: true } })?.isOrganizer).toBe(
      true,
    );
    expect(mapGoogleEvent({ ...base, organizer: { email: "them@x" } })?.isOrganizer).toBe(false);
    const none = mapGoogleEvent(base);
    expect(none && "isOrganizer" in none).toBe(false);
  });

  it("leaves the key out when Google sends none, so the stored one stays", () => {
    const mapped = mapGoogleEvent({
      id: "g1",
      summary: "Board",
      start: { dateTime: "2026-11-05T10:00:00Z" },
      end: { dateTime: "2026-11-05T11:00:00Z" },
    });
    expect(mapped && "iCalUID" in mapped).toBe(false);
  });
});
