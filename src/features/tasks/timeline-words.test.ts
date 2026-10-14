// TV-TL1 · the Timeline's words (REPLAN 68a): tasks are due, sections end
// (or run from–to), projects have a target; ranges say a shared month or year
// once.

import { afterEach, describe, expect, it } from "@rstest/core";

import { applyTimeRegion, EMPTY_TIME_REGION, resetTimeRegionForTests } from "../../lib/time-region";
import { dayNumOf } from "./timeline-scale";
import {
  barWords,
  milestoneWords,
  pointWords,
  sectionDateWords,
  spanWords,
} from "./timeline-words";

const NOW = new Date(2026, 9, 13, 10);

afterEach(() => resetTimeRegionForTests());

describe("Timeline words", () => {
  it("says a shared month or year once", () => {
    applyTimeRegion({ ...EMPTY_TIME_REGION, dateOrder: "month_day" }, "u1");
    expect(spanWords(dayNumOf(2026, 9, 13), dayNumOf(2026, 9, 24), NOW)).toBe("Oct 13–24");
    expect(spanWords(dayNumOf(2026, 9, 30), dayNumOf(2026, 10, 4), NOW)).toBe("Oct 30 – Nov 4");
    expect(spanWords(dayNumOf(2027, 0, 11), dayNumOf(2027, 1, 14), NOW)).toBe(
      "Jan 11 – Feb 14, 2027",
    );
  });

  it("follows the person's date order", () => {
    applyTimeRegion({ ...EMPTY_TIME_REGION, dateOrder: "day_month" }, "u1");
    expect(spanWords(dayNumOf(2026, 9, 13), dayNumOf(2026, 9, 24), NOW)).toBe("13–24 Oct");
  });

  it("names each kind of date its own way", () => {
    applyTimeRegion({ ...EMPTY_TIME_REGION, dateOrder: "month_day" }, "u1");
    expect(sectionDateWords(null, dayNumOf(2026, 10, 7), NOW)).toBe("by Nov 7");
    expect(milestoneWords("Build", dayNumOf(2026, 10, 7), NOW)).toBe("Build ends Nov 7");
    expect(
      pointWords(
        { day: dayNumOf(2026, 9, 9), kind: "due", late: true, closed: false, repeat: false },
        NOW,
      ),
    ).toMatch(/^Due .*Oct 9 · late$/);
    expect(
      pointWords(
        { day: dayNumOf(2026, 9, 15), kind: "session", late: false, closed: false, repeat: true },
        NOW,
      ),
    ).toMatch(/^Next session .*Oct 15 · repeats$/);
    expect(
      barWords(
        { start: dayNumOf(2026, 9, 1), end: dayNumOf(2026, 10, 7), solid: false },
        { done: 5, total: 12 },
        NOW,
      ),
    ).toBe("Oct 1 – Nov 7 · worked out from its work · 5 of 12 done");
  });
});
