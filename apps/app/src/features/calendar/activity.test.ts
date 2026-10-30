import { describe, expect, it } from "@rstest/core";

import { calendarActivityLine, isEventTrailEntry } from "./activity";

describe("an event's trail in words", () => {
  it("says creation, changes, deletes and occurrences plainly", () => {
    expect(calendarActivityLine({ op: "calendar.event_create" })).toBe("created this");
    expect(
      calendarActivityLine({
        op: "calendar.event_update",
        payload: { keys: ["startsAt", "endsAt", "location"] },
      }),
    ).toBe("changed the time and place");
    expect(
      calendarActivityLine({
        op: "calendar.event_update",
        payload: { keys: ["title", "startsAt", "location", "isPrivate"] },
      }),
    ).toBe("changed the title, time and 2 more");
    expect(calendarActivityLine({ op: "calendar.event_update", payload: {} })).toBe("made changes");
    expect(calendarActivityLine({ op: "calendar.event_delete" })).toBe("deleted this");
    expect(calendarActivityLine({ op: "calendar.occurrence_update" })).toBe(
      "changed one occurrence",
    );
  });

  it("never shows an op's code", () => {
    expect(calendarActivityLine({ op: "calendar.something_new" })).toBe("made changes");
  });

  it("leaves comment traffic out of an event's history", () => {
    expect(isEventTrailEntry({ op: "calendar.event_update" })).toBe(true);
    expect(isEventTrailEntry({ op: "comments.add" })).toBe(false);
    expect(isEventTrailEntry({ op: "comments.delete" })).toBe(false);
  });
});
