// Offer specific times (CALR-19, specs/calendar-rethink.md AC34): O starts at
// the first open time after the link's notice; ↵ adds a time and hops to the
// next day; ⇥ steps to the next open time; ←→ a day; ⌫ removes the last pick.
// The card copies the link (⌘C) or the times as text (⇧⌘C). Pure rules only.
process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import type { OpenTimesInput } from "./availability";
import { TASKS_BUSY_ID } from "./model";
import {
  OFFER_HOLD_HOURS,
  OFFER_MAX_TIMES,
  type OfferDraft,
  offerKey,
  offerSlots,
  offerText,
  offerUrl,
  startOfferDraft,
} from "./offer";
import { DEFAULT_WEEKLY_HOURS, type WeeklyHours } from "./slots";

const ZONE = "Europe/Warsaw";
const at = (iso: string) => new Date(iso).getTime();

// Warsaw is UTC+1 in November: 09:00 local is 08:00Z.
const TUE_0900 = at("2026-11-03T08:00:00.000Z");
const TUE_0930 = at("2026-11-03T08:30:00.000Z");
const TUE_1400 = at("2026-11-03T13:00:00.000Z");
const WED_1000 = at("2026-11-04T09:00:00.000Z");
const WED_1100 = at("2026-11-04T10:00:00.000Z");
const FRI_0900 = at("2026-11-06T08:00:00.000Z");
// Wednesday 00:30 in Warsaw is Tuesday 23:30Z: the day is the host zone's, not UTC's.
const WED_0030 = at("2026-11-03T23:30:00.000Z");

const SLOTS = [TUE_0900, TUE_0930, TUE_1400, WED_0030, WED_1000, WED_1100, FRI_0900];

function press(draft: OfferDraft, ...keys: Parameters<typeof offerKey>[1][]): OfferDraft {
  return keys.reduce((d, key) => offerKey(d, key, SLOTS, ZONE), draft);
}

describe("O starts at the first open time", () => {
  it("puts the cursor on the first slot, with nothing picked", () => {
    expect(startOfferDraft(SLOTS)).toEqual({ picks: [], cursorMs: TUE_0900 });
  });

  it("reads unsorted slots in time order", () => {
    expect(startOfferDraft([WED_1000, TUE_1400, TUE_0930]).cursorMs).toBe(TUE_0930);
  });

  it("has no cursor when the link has no open time", () => {
    expect(startOfferDraft([])).toEqual({ picks: [], cursorMs: null });
  });

  it("offers the link's open times from after its notice", () => {
    const monday: WeeklyHours = {
      ...DEFAULT_WEEKLY_HOURS,
      mon: [{ start: "09:00", end: "11:00" }],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
    };
    const input: OpenTimesInput = {
      link: {
        durationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        horizonDays: 14,
        minNoticeMinutes: 60,
        hostTimeZone: "UTC",
        weeklyHours: monday,
        busyCalendarIds: ["moduo", TASKS_BUSY_ID],
        paused: false,
      },
      hostId: "me",
      events: [],
      now: new Date("2030-03-04T08:15:00.000Z"),
      from: new Date("2030-03-04T00:00:00.000Z"),
      to: new Date("2030-03-11T00:00:00.000Z"),
    };
    const slots = offerSlots(input);
    expect(slots[0]).toBe(at("2030-03-04T09:30:00.000Z"));
    expect(slots.every((ms) => ms >= at("2030-03-04T09:15:00.000Z"))).toBe(true);
    expect(offerSlots({ ...input, link: { ...input.link, paused: true } })).toEqual([]);
  });
});

describe("the keys while offering", () => {
  it("↵ adds the time and hops to the first open time of the next day", () => {
    const d = press(startOfferDraft(SLOTS), "add");
    expect(d.picks).toEqual([TUE_0900]);
    // The next day in Warsaw starts at 00:30 local (Tuesday 23:30 in UTC).
    expect(d.cursorMs).toBe(WED_0030);
  });

  it("↵ ↵ ↵ picks three days in a row, skipping a day with no open time", () => {
    const d = press(startOfferDraft(SLOTS), "add", "add", "add");
    expect(d.picks).toEqual([TUE_0900, WED_0030, FRI_0900]);
  });

  it("↵ on the last day keeps the cursor on a later open time of that day, else none", () => {
    const onFri = press(startOfferDraft(SLOTS), "add", "add", "add");
    expect(onFri.cursorMs).toBeNull();
    const add = press({ picks: [], cursorMs: WED_1000 }, "add");
    // Thursday has nothing; Friday is the next day with a time.
    expect(add.cursorMs).toBe(FRI_0900);
  });

  it("↵ does nothing without a cursor, on a time already picked, or past the cap", () => {
    expect(press({ picks: [], cursorMs: null }, "add")).toEqual({ picks: [], cursorMs: null });
    expect(press({ picks: [TUE_0900], cursorMs: TUE_0900 }, "add")).toEqual({
      picks: [TUE_0900],
      cursorMs: TUE_0900,
    });
    const full = Array.from(
      { length: OFFER_MAX_TIMES },
      (_, i) => at("2026-12-01T08:00:00.000Z") + i * 86_400_000,
    );
    expect(press({ picks: full, cursorMs: TUE_0900 }, "add").picks).toEqual(full);
  });

  it("⇥ steps to the next open time that isn't picked, and stays on the last one", () => {
    const d = press(startOfferDraft(SLOTS), "next");
    expect(d.cursorMs).toBe(TUE_0930);
    expect(press({ picks: [TUE_0930], cursorMs: TUE_0900 }, "next").cursorMs).toBe(TUE_1400);
    expect(press({ picks: [], cursorMs: FRI_0900 }, "next").cursorMs).toBe(FRI_0900);
  });

  it("→ and ← move to the first open time of the next or previous day that has one", () => {
    expect(press(startOfferDraft(SLOTS), "next-day").cursorMs).toBe(WED_0030);
    expect(press({ picks: [], cursorMs: WED_1100 }, "next-day").cursorMs).toBe(FRI_0900);
    expect(press({ picks: [], cursorMs: FRI_0900 }, "prev-day").cursorMs).toBe(WED_0030);
    expect(press({ picks: [], cursorMs: TUE_1400 }, "prev-day").cursorMs).toBe(TUE_1400);
    expect(press({ picks: [], cursorMs: FRI_0900 }, "next-day").cursorMs).toBe(FRI_0900);
  });

  it("→ skips a picked time to the first free one of that day", () => {
    expect(press({ picks: [WED_0030], cursorMs: TUE_0900 }, "next-day").cursorMs).toBe(WED_1000);
  });

  it("⌫ removes the last pick and puts the cursor back on it", () => {
    const d = press(startOfferDraft(SLOTS), "add", "add", "remove-last");
    expect(d).toEqual({ picks: [TUE_0900], cursorMs: WED_0030 });
    expect(press({ picks: [], cursorMs: TUE_0900 }, "remove-last")).toEqual({
      picks: [],
      cursorMs: TUE_0900,
    });
  });
});

describe("what the card copies", () => {
  it("the link lives under /book/r/", () => {
    expect(offerUrl("https://moduo.app", "intro-4kq7xzt2")).toBe(
      "https://moduo.app/book/r/intro-4kq7xzt2",
    );
  });

  it("the times as text, in time order, in the host's zone, ending with the link", () => {
    const text = offerText({
      picks: [WED_1000, TUE_0900, FRI_0900],
      durationMinutes: 30,
      timeZone: ZONE,
      url: "https://moduo.app/book/r/intro-4kq7xzt2",
    });
    expect(text).toBe(
      [
        "Would one of these work?",
        "Tue 3 Nov, 09:00–09:30",
        "Wed 4 Nov, 10:00–10:30",
        "Fri 6 Nov, 09:00–09:30",
        "(Warsaw time)",
        "Pick one: moduo.app/book/r/intro-4kq7xzt2",
      ].join("\n"),
    );
  });

  it("names a zone by its city, with spaces, and UTC as it is", () => {
    const one = (timeZone: string) =>
      offerText({
        picks: [TUE_0900],
        durationMinutes: 45,
        timeZone,
        url: "https://moduo.app/book/r/x",
      });
    expect(one("America/New_York")).toContain("Tue 3 Nov, 03:00–03:45\n(New York time)");
    expect(one("UTC")).toContain("Tue 3 Nov, 08:00–08:45\n(UTC time)");
  });

  it("is empty with nothing picked", () => {
    expect(
      offerText({
        picks: [],
        durationMinutes: 30,
        timeZone: ZONE,
        url: "https://moduo.app/book/r/x",
      }),
    ).toBe("");
  });

  it("holds last 48 hours", () => {
    expect(OFFER_HOLD_HOURS).toBe(48);
  });
});
