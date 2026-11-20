// Offer holds are busy for every link (CALR-19, specs/calendar-rethink.md
// AC34): a held time hides itself from every booking link, whatever the link's
// busy list ticks, so two guests can't take the same hour while an offer waits.

import { describe, expect, it } from "@rstest/core";

import { busyFromHostEvents, FOCUS_BUSY_ID, type HostEventRow } from "./booking-busy.ts";

function row(over: Partial<HostEventRow> = {}): HostEventRow {
  return {
    start_time: "2030-03-05T13:00:00Z",
    end_time: "2030-03-05T13:30:00Z",
    source_account_id: null,
    calendar_id: "moduo",
    kind: "hold",
    ...over,
  };
}

const starts = (ids: readonly string[], rows: HostEventRow[]) =>
  busyFromHostEvents(rows, ids).map((i) => i.start.toISOString());

describe("held times are busy for every link (AC34)", () => {
  it("counts a hold even when the link doesn't tick Your calendar · Moduo", () => {
    expect(starts([], [row()])).toEqual(["2030-03-05T13:00:00.000Z"]);
    expect(starts(["acct-1"], [row()])).toEqual(["2030-03-05T13:00:00.000Z"]);
    expect(starts([FOCUS_BUSY_ID], [row()])).toEqual(["2030-03-05T13:00:00.000Z"]);
  });

  it("counts it once when Moduo is ticked too", () => {
    expect(starts(["moduo"], [row()])).toHaveLength(1);
  });

  it("leaves the other kinds to the busy list", () => {
    expect(starts([], [row({ kind: "event" }), row({ kind: "focus" })])).toEqual([]);
  });
});
