import { describe, expect, it } from "@rstest/core";
import { fireEvent, render } from "@testing-library/react";

import { todayEvents } from "./today-events";
import { TodayPanel } from "./today-panel";

const NOW = new Date(2026, 10, 4, 9, 0).getTime();
const iso = (h: number, day = 4) => new Date(2026, 10, day, h, 0).toISOString();

describe("todayEvents (MR-14)", () => {
  it("keeps today's events, expands a recurring series, sorts all-day first", () => {
    const out = todayEvents(
      [
        {
          id: "a",
          title: "Standup",
          startsAt: iso(10, 1),
          endsAt: iso(11, 1),
          allDay: false,
          rrule: "FREQ=DAILY",
        },
        {
          id: "b",
          title: "Yesterday",
          startsAt: iso(8, 3),
          endsAt: iso(9, 3),
          allDay: false,
          rrule: null,
        },
        { id: "c", title: "Review", startsAt: iso(8), endsAt: iso(9), allDay: false, rrule: null },
        {
          id: "d",
          title: "Offsite",
          startsAt: iso(0),
          endsAt: iso(0, 5),
          allDay: true,
          rrule: null,
        },
      ],
      NOW,
    );
    expect(out.map((e) => e.title)).toEqual(["Offsite", "Review", "Standup"]);
    expect(out[2]!.startMs).toBe(new Date(2026, 10, 4, 10, 0).getTime());
  });
});

describe("TodayPanel", () => {
  it("shows today's events beside the tasks and creates an event from the email", () => {
    let created = 0;
    const view = render(
      <TodayPanel
        tasks={[{ id: "t1", title: "Send contract" }]}
        events={todayEvents(
          [
            {
              id: "c",
              title: "Review",
              startsAt: iso(8),
              endsAt: iso(9),
              allDay: false,
              rrule: null,
            },
          ],
          NOW,
        )}
        date="2026-11-04"
        onDropThread={() => {}}
        onCreateEvent={() => created++}
      />,
    );
    expect(view.getByText("Send contract")).toBeTruthy();
    expect(view.getByRole("list", { name: "Today's events" }).textContent).toContain("Review");
    fireEvent.click(view.getByRole("button", { name: /Create event from this email/ }));
    expect(created).toBe(1);
  });
});
