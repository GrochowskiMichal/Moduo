// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field (fixed): `timeAgo` printed
// an old touch as `on ${iso.slice(0, 10)}`, the instant's UTC day, not the day it was on
// this device (Last touch line, contact activity trail, event detail panel). It now reads
// `localDayOf` (lib/task-rows.ts). Any zone: 00:30 local moves a UTC-day reading east of
// UTC and 23:30 local moves it west of UTC (in UTC itself both readings agree).
// Run: TZ=Pacific/Auckland bun run --cwd apps/app test src/features/contacts/rollup.509-4.test.ts

import { describe, expect, it } from "@rstest/core";

import { timeAgo } from "./rollup";

const now = new Date(2026, 9, 23, 12, 0);
/** Aug 2's local wall clock at h:m, as the server returns it (UTC ISO). */
const aug2At = (h: number, m: number) => new Date(2026, 7, 2, h, m).toISOString();

describe("HV-15 variant 509-4: an old touch shows its local day", () => {
  it("a touch at 00:30 on Aug 2 (local) reads 'on 2026-08-02'", () => {
    expect(timeAgo(aug2At(0, 30), now)).toBe("on 2026-08-02");
  });

  // Hardening: a fix that only shifts one way, or reads `now`'s day, or reformats.

  it("a touch at 23:30 on Aug 2 (local) reads 'on 2026-08-02' too", () => {
    expect(timeAgo(aug2At(23, 30), now)).toBe("on 2026-08-02");
  });

  it("the same instant written with an offset reads the same local day", () => {
    const utc = aug2At(23, 30);
    const withOffset = utc.replace(/\.000Z$/, "+00:00");
    expect(timeAgo(withOffset, now)).toBe("on 2026-08-02");
  });

  it("recent touches keep their relative phrase; unreadable ones read empty", () => {
    expect(timeAgo(new Date(2026, 9, 20, 12, 0).toISOString(), now)).toBe("3 days ago");
    expect(timeAgo("not a date", now)).toBe("");
  });
});
