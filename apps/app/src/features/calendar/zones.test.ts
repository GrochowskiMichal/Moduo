// AC15 (CALR-13): Z adds a second zone; the event shows its time there; a clock
// change (yours, or the second zone's) is labelled on its day. Tests run on
// Europe/Warsaw time (pinned below): Europe goes back on Sun 25 Oct 2026,
// the US on Sun 1 Nov 2026, so the week of 26 Oct is the two-zone week.

// Pin TZ before any Date math (CI runs in UTC); rstest isolates each file.
process.env.TZ = "Europe/Warsaw";

import { beforeEach, describe, expect, it } from "@rstest/core";

import {
  clockChangeBetween,
  dayZoneNote,
  formatZoneRange,
  readSecondZone,
  sanitizeSecondZone,
  secondZoneLabel,
  toggleSecondZone,
  writeSecondZone,
  zoneHourLabel,
  zoneOffsetMinutes,
  zoneOffsetsByDay,
} from "./zones";

const PT = "America/Los_Angeles";
const local = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

beforeEach(() => {
  window.localStorage.clear();
});

describe("PT offsets per day", () => {
  it("is seven hours behind UTC until the US Sunday, then eight", () => {
    expect(zoneOffsetMinutes(PT, Date.UTC(2026, 9, 27, 12))).toBe(-420);
    expect(zoneOffsetMinutes(PT, Date.UTC(2026, 10, 2, 12))).toBe(-480);
    expect(zoneOffsetMinutes("Europe/Warsaw", Date.UTC(2026, 9, 27, 12))).toBe(60);
  });

  it("reads each day of the two-zone week at its own offset", () => {
    const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 26 + i));
    expect(zoneOffsetsByDay(week, PT)).toEqual([-420, -420, -420, -420, -420, -420, -480]);
  });
});

describe("the clock change, labelled on its day", () => {
  it("finds the US change inside the local Sunday", () => {
    const change = clockChangeBetween(PT, local(2026, 11, 1), local(2026, 11, 2));
    expect(change?.direction).toBe("back");
    expect(change?.atMs).toBe(Date.UTC(2026, 10, 1, 9));
    expect(clockChangeBetween(PT, local(2026, 10, 27), local(2026, 10, 28))).toBeNull();
  });

  it("finds Europe's change in the local zone, both ways", () => {
    expect(clockChangeBetween(undefined, local(2026, 10, 25), local(2026, 10, 26))?.direction).toBe(
      "back",
    );
    expect(clockChangeBetween(undefined, local(2026, 3, 29), local(2026, 3, 30))?.direction).toBe(
      "forward",
    );
  });

  it("says which clocks change under the date", () => {
    expect(dayZoneNote(new Date(2026, 10, 1), PT)).toBe("PT clocks go back");
    expect(dayZoneNote(new Date(2026, 9, 25), null)).toBe("Clocks go back");
    expect(dayZoneNote(new Date(2026, 2, 29), PT)).toBe("Clocks go forward");
    expect(dayZoneNote(new Date(2026, 9, 27), PT)).toBeNull();
    // A zone whose clocks change with yours needs no second note.
    expect(dayZoneNote(new Date(2026, 9, 25), "Europe/London")).toBe("Clocks go back");
  });
});

describe("the second zone's name and hours", () => {
  it("names a zone short: PT, CET, else its city", () => {
    const at = new Date(Date.UTC(2026, 9, 27, 12));
    expect(secondZoneLabel(PT, at)).toBe("PT");
    expect(secondZoneLabel("Europe/Berlin", at)).toBe("CET");
    expect(secondZoneLabel("Asia/Tokyo", at)).toBe("Tokyo");
  });

  it("labels the gutter's hours on the second zone's clock", () => {
    // 18:00 in Warsaw on Tue 27 Oct is 10 AM in PT.
    expect(zoneHourLabel(local(2026, 10, 27, 18), PT, { hour12: true, locale: "en-US" })).toBe(
      "10 AM",
    );
    expect(zoneHourLabel(local(2026, 10, 27, 18), PT, { hour12: false, locale: "en-US" })).toBe(
      "10",
    );
    expect(
      zoneHourLabel(local(2026, 10, 27, 18), "Asia/Kolkata", { hour12: false, locale: "en-US" }),
    ).toBe("22:30");
  });
});

describe("the event's time in the second zone", () => {
  const opts = { hour12: true, locale: "en-US", localZone: "Europe/Warsaw" };

  it("reads an hour meeting as one range with the zone", () => {
    expect(formatZoneRange(Date.UTC(2026, 9, 27, 16), Date.UTC(2026, 9, 27, 17), PT, opts)).toBe(
      "9–10 AM PT",
    );
  });

  it("keeps both day periods when the range crosses noon", () => {
    expect(
      formatZoneRange(Date.UTC(2026, 9, 27, 18, 30), Date.UTC(2026, 9, 27, 20), PT, opts),
    ).toBe("11:30 AM–1 PM PT");
  });

  it("says the day when it isn't yours", () => {
    // 07:00 Wed in Warsaw is 11 PM Tuesday in PT.
    expect(formatZoneRange(Date.UTC(2026, 9, 28, 6), Date.UTC(2026, 9, 28, 7), PT, opts)).toBe(
      "11 PM–12 AM PT (Tue)",
    );
  });

  it("uses the 24-hour clock when that is yours", () => {
    expect(
      formatZoneRange(Date.UTC(2026, 9, 27, 16), Date.UTC(2026, 9, 27, 17), PT, {
        ...opts,
        hour12: false,
      }),
    ).toBe("09:00–10:00 PT");
  });
});

describe("the second zone setting (Z)", () => {
  it("starts with no zone, hidden", () => {
    expect(readSecondZone()).toEqual({ zone: null, shown: false });
  });

  it("keeps a picked zone and Z shows or hides it", () => {
    writeSecondZone({ zone: PT, shown: true });
    expect(readSecondZone()).toEqual({ zone: PT, shown: true });
    expect(toggleSecondZone(readSecondZone())).toEqual({ zone: PT, shown: false });
    // Without a zone Z has nothing to show.
    expect(toggleSecondZone({ zone: null, shown: false })).toEqual({ zone: null, shown: false });
  });

  it("drops a zone the platform doesn't know", () => {
    expect(sanitizeSecondZone({ zone: "Mars/Olympus", shown: true })).toEqual({
      zone: null,
      shown: false,
    });
    expect(sanitizeSecondZone("nope")).toEqual({ zone: null, shown: false });
  });
});
