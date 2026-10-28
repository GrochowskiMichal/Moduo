// AC15 + AC45 (CALR-13), the screen side: the gutter corner names both zones
// and Z shows or hides the second one; the Event view says the event's time in
// the second zone; the Working hours sheet sets start, end, weekends and the
// week start.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { HotkeyScope } from "../../../lib/hotkeys";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { EventContext } from "../event-view";
import type { CalendarEventModel } from "../events";
import { DEFAULT_CALENDAR_PREFS } from "../prefs";
import { readSecondZone, writeSecondZone } from "../zones";
import { ZoneCorner } from "./day-header";
import { EventDetailPanel } from "./event-detail-panel";
import { WorkingHoursSheet } from "./working-hours-sheet";

const setTimeRegion = rs.hoisted(() => rs.fn(async (patch: object) => patch));
rs.mock("../../../lib/runtime", () => ({
  getRuntime: () => ({
    preferences: {
      setTimeRegion: async (patch: object) => {
        await setTimeRegion(patch);
        return {
          timeZone: null,
          timeZoneManual: false,
          weekStart: 0,
          hourCycle: null,
          dateOrder: null,
          shareTimeWithOwner: false,
          quietHours: { on: false, from: null, to: null },
        };
      },
    },
  }),
}));

const PT = "America/Los_Angeles";

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

function pressZ() {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", code: "KeyZ", bubbles: true, cancelable: true }),
    );
  });
}

function corner() {
  return render(
    <TooltipProvider>
      <HotkeyScope scope="calendar">
        <ZoneCorner at={new Date(2026, 9, 27, 12)} />
      </HotkeyScope>
    </TooltipProvider>,
  );
}

describe("the zone corner", () => {
  it("names the grid's zone, and the second one beside it when it shows", () => {
    writeSecondZone({ zone: PT, shown: true });
    corner();
    const box = document.querySelector("[data-zone-corner]");
    expect(box?.textContent).toContain("CET");
    expect(box?.textContent).toContain("PT");
  });

  it("Z hides and shows the second zone", () => {
    writeSecondZone({ zone: PT, shown: true });
    corner();
    pressZ();
    expect(readSecondZone()).toEqual({ zone: PT, shown: false });
    expect(document.querySelector("[data-zone-corner]")?.textContent).not.toContain("PT");
    pressZ();
    expect(readSecondZone()).toEqual({ zone: PT, shown: true });
  });

  it("Z with no zone picked opens the zone picker", () => {
    corner();
    pressZ();
    expect(screen.getByPlaceholderText("Find a time zone")).toBeTruthy();
  });
});

const runtime = {
  spine: { listLinks: async () => [], getEntities: async () => [] },
  tasks: { listActivity: async () => [] },
} as unknown as ModuoRuntime;

const context: EventContext = {
  calendarName: "Your calendar",
  calendarOwnerId: "u-me",
  share: { workspaceLevel: "view", people: [] },
  bookedThrough: null,
};

function event(): CalendarEventModel {
  return {
    id: "ev-a",
    workspaceId: "ws-1",
    ownerId: "u-me",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    calendarRef: "cal-1",
    title: "Sync with Priya",
    description: "",
    // Tue 27 Oct, 9–10 AM in PT.
    startsAt: "2026-10-27T16:00:00.000Z",
    endsAt: "2026-10-27T17:00:00.000Z",
    allDay: false,
    rrule: null,
    status: "confirmed",
    location: null,
    color: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    deletedAt: null,
    attendees: [],
  };
}

function eventPanel() {
  return render(
    <TooltipProvider>
      <HotkeyScope scope="calendar">
        <EventDetailPanel
          runtime={runtime}
          workspaceId="ws-1"
          currentUserId="u-me"
          event={event()}
          accounts={[]}
          members={[]}
          canEdit
          writable
          loadContext={async () => context}
          onPatch={() => {}}
          onDeleteRequest={() => {}}
          onClose={() => {}}
        />
      </HotkeyScope>
    </TooltipProvider>,
  );
}

describe("the event in the second zone", () => {
  it("says the event's time on the second zone's clock", async () => {
    writeSecondZone({ zone: PT, shown: true });
    eventPanel();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.querySelector("[data-second-zone-time]")?.textContent).toMatch(
      /9(:00)?\s?(AM)?–10(:00)?\s?(AM)? PT/,
    );
  });

  it("says nothing while the second zone is hidden", async () => {
    writeSecondZone({ zone: PT, shown: false });
    eventPanel();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.querySelector("[data-second-zone-time]")).toBeNull();
  });
});

describe("the Working hours sheet", () => {
  function sheet(onChange = rs.fn()) {
    render(
      <TooltipProvider>
        <WorkingHoursSheet
          open
          onOpenChange={() => {}}
          prefs={DEFAULT_CALENDAR_PREFS}
          onChange={onChange}
        />
      </TooltipProvider>,
    );
    return onChange;
  }

  it("sets the start and end of the working day", () => {
    const onChange = sheet();
    fireEvent.change(screen.getByLabelText("Working day starts"), { target: { value: "09:30" } });
    expect(onChange).toHaveBeenLastCalledWith({ workStartMinute: 570 });
    fireEvent.change(screen.getByLabelText("Working day ends"), { target: { value: "17:00" } });
    expect(onChange).toHaveBeenLastCalledWith({ workEndMinute: 1020 });
  });

  it("refuses an end before the start", () => {
    const onChange = sheet();
    fireEvent.change(screen.getByLabelText("Working day ends"), { target: { value: "07:00" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows or hides weekends", () => {
    const onChange = sheet();
    fireEvent.click(screen.getByRole("switch", { name: "Show weekends" }));
    expect(onChange).toHaveBeenLastCalledWith({ showWeekends: false });
  });

  it("sets the week start for the whole app (Time & region)", async () => {
    sheet();
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Sunday" }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(setTimeRegion).toHaveBeenCalledWith({ weekStart: 0 });
  });
});
