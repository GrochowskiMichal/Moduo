// Booking availability and focus time (CALR-14, specs/calendar-rethink.md AC23):
// a booking link's busy list decides which of the host's events hide times.
// Focus time is free for links by default; a link that ticks "Focus time"
// (the busy list's "focus" pseudo-calendar) counts it as busy.

import { describe, expect, it } from "@rstest/core";

import {
  DEFAULT_BUSY_IDS,
  FOCUS_BUSY_ID as APP_FOCUS_BUSY_ID,
} from "../../../apps/app/src/features/calendar/booking/model.ts";
import { busyFromHostEvents, FOCUS_BUSY_ID, type HostEventRow } from "./booking-busy.ts";

function row(over: Partial<HostEventRow> = {}): HostEventRow {
  return {
    start_time: "2030-03-05T13:00:00Z",
    end_time: "2030-03-05T15:00:00Z",
    source_account_id: null,
    calendar_id: "moduo",
    kind: "event",
    ...over,
  };
}

const focus = row({ kind: "focus", start_time: "2030-03-05T09:00:00Z", end_time: "2030-03-05T11:00:00Z" });
const meeting = row();
const google = row({ source_account_id: "acct-1", calendar_id: "primary", start_time: "2030-03-06T10:00:00Z", end_time: "2030-03-06T11:00:00Z" });

const starts = (ids: readonly string[], rows: HostEventRow[]) =>
  busyFromHostEvents(rows, ids).map((i) => i.start.toISOString());

describe("booking-busy · focus is free for links unless ticked (AC23)", () => {
  it("the busy list's focus id is the app's, and a new link's default list leaves it out", () => {
    expect(FOCUS_BUSY_ID).toBe("focus");
    expect(APP_FOCUS_BUSY_ID).toBe(FOCUS_BUSY_ID);
    expect(DEFAULT_BUSY_IDS).not.toContain(FOCUS_BUSY_ID);
  });

  it("with Moduo busy and focus not ticked, a meeting hides its time and focus time doesn't", () => {
    expect(starts(["moduo", "tasks"], [focus, meeting])).toEqual(["2030-03-05T13:00:00.000Z"]);
  });

  it("ticking Focus time makes focus time busy", () => {
    expect(starts(["moduo", FOCUS_BUSY_ID], [focus, meeting])).toEqual([
      "2030-03-05T09:00:00.000Z",
      "2030-03-05T13:00:00.000Z",
    ]);
  });

  it("Focus time ticked alone counts focus but not the Moduo calendar's meetings", () => {
    expect(starts([FOCUS_BUSY_ID], [focus, meeting])).toEqual(["2030-03-05T09:00:00.000Z"]);
  });

  it("a connected account's events follow its own tick, as before", () => {
    expect(starts(["moduo", "acct-1"], [google, meeting])).toEqual([
      "2030-03-05T13:00:00.000Z",
      "2030-03-06T10:00:00.000Z",
    ]);
    expect(starts(["moduo"], [google])).toEqual([]);
  });

  it("a row without a kind (a database before the kind column) is an ordinary event", () => {
    const old = row({ kind: undefined });
    expect(starts(["moduo"], [old])).toEqual(["2030-03-05T13:00:00.000Z"]);
  });

  it("keeps each event's start and end", () => {
    const [only] = busyFromHostEvents([focus], [FOCUS_BUSY_ID]);
    expect(only.start.toISOString()).toBe("2030-03-05T09:00:00.000Z");
    expect(only.end.toISOString()).toBe("2030-03-05T11:00:00.000Z");
  });
});
