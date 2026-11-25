// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field (fixed): `relativeTimeAgo`
// printed an old instant as `on ${iso.slice(0, 10)}`, its UTC day, not the day on this
// device (note snippets "Edited on …", email "Received on …", note meta). It now reads
// `localDayOf` (lib/task-rows.ts). Any zone: 00:30 local moves a UTC-day reading east of
// UTC and 23:30 local moves it west of UTC (in UTC itself both readings agree).
// Run: TZ=Pacific/Auckland bun run --cwd apps/app test src/features/spine/snippet-format.509-4.test.ts

import { describe, expect, it } from "@rstest/core";

import { formatNoteSnippet, relativeTimeAgo } from "./snippet-format";

const now = new Date(2026, 9, 23, 12, 0);
/** Aug 2's local wall clock at h:m, as an instant. */
const aug2At = (h: number, m: number) => new Date(2026, 7, 2, h, m).toISOString();

describe("HV-15 variant 509-4: an old edit shows its local day", () => {
  it("a note edited at 00:30 on Aug 2 (local) reads 'Edited on 2026-08-02'", () => {
    expect(formatNoteSnippet({ updatedAt: aug2At(0, 30), isArchived: false } as never, now)).toBe(
      "Edited on 2026-08-02",
    );
  });

  // Hardening: a fix that only shifts one way, misses the future side, or reads `now`.

  it("an edit at 23:30 on Aug 2 (local) reads 'Edited on 2026-08-02' too", () => {
    expect(formatNoteSnippet({ updatedAt: aug2At(23, 30), isArchived: false } as never, now)).toBe(
      "Edited on 2026-08-02",
    );
  });

  it("a far-future instant reads its own local day", () => {
    const at = new Date(2027, 1, 14, 23, 30).toISOString();
    expect(relativeTimeAgo(at, now)).toBe("on 2027-02-14");
    const early = new Date(2027, 1, 14, 0, 30).toISOString();
    expect(relativeTimeAgo(early, now)).toBe("on 2027-02-14");
  });

  it("recent edits keep their relative phrase; unreadable ones read empty", () => {
    expect(relativeTimeAgo(new Date(2026, 9, 20, 12, 0).toISOString(), now)).toBe("3 days ago");
    expect(relativeTimeAgo("not a date", now)).toBe("");
  });
});
