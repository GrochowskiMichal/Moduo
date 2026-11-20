// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field: `timeAgo` prints an old
// touch as `on ${iso.slice(0, 10)}`, the instant's UTC day, not the day it was on this
// device (Last touch line, contact activity trail, event detail panel).
// Fails until the fix lands. Needs a zone east of UTC: run with TZ=Pacific/Auckland.
// Run: MODUO_HUNT=1 TZ=Pacific/Auckland bun run --cwd apps/app test src/features/contacts/rollup.509-4.variant.test.ts

import { describe, expect, it } from "@rstest/core";

import { timeAgo } from "./rollup";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 509-4: an old touch shows its UTC day", () => {
  it("a touch at 00:30 on Aug 2 (local) reads 'on 2026-08-02'", () => {
    // Only a zone east of UTC shows the bug; in UTC this would pass and read as "fixed".
    expect(
      new Date(2026, 7, 2, 0, 30).getTimezoneOffset(),
      "run with TZ=Pacific/Auckland",
    ).toBeLessThan(0);
    const touched = new Date(2026, 7, 2, 0, 30).toISOString(); // as the server returns it
    const now = new Date(2026, 9, 23, 12, 0);
    expect(timeAgo(touched, now)).toBe("on 2026-08-02");
  });
});
