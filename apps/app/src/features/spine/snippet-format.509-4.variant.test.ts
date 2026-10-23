// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field: `relativeTimeAgo` prints an
// old instant as `on ${iso.slice(0, 10)}`, its UTC day, not the day on this device (note
// snippets "Edited on …", email "Received on …", note meta).
// Fails until the fix lands. Needs a zone east of UTC: run with TZ=Pacific/Auckland.
// Run: MODUO_HUNT=1 TZ=Pacific/Auckland bun run --cwd apps/app test src/features/spine/snippet-format.509-4.variant.test.ts

import { describe, expect, it } from "@rstest/core";

import { formatNoteSnippet } from "./snippet-format";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 509-4: an old edit shows its UTC day", () => {
  it("a note edited at 00:30 on Aug 2 (local) reads 'Edited on 2026-08-02'", () => {
    // Only a zone east of UTC shows the bug; in UTC this would pass and read as "fixed".
    expect(
      new Date(2026, 7, 2, 0, 30).getTimezoneOffset(),
      "run with TZ=Pacific/Auckland",
    ).toBeLessThan(0);
    const edited = new Date(2026, 7, 2, 0, 30).toISOString();
    const now = new Date(2026, 9, 23, 12, 0);
    expect(
      formatNoteSnippet({ updatedAt: edited, isPinned: false, isArchived: false } as never, now),
    ).toBe("Edited on 2026-08-02");
  });
});
