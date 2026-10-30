// Booking links and focus time (CALR-14, AC23): under Check for conflicts, "Focus
// time" is a calendar of its own, off by default, so guests can book over it
// unless the link ticks it.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FOCUS_BUSY_ID } from "../booking/model";
import { normalizeWeeklyHours } from "../booking/slots";
import {
  BookingLinkDialog,
  DEFAULT_GUEST_REMINDER_MINUTES,
  type LinkDraft,
} from "./booking-link-dialog";

afterEach(cleanup);

const noop = () => {};

function draft(over: Partial<LinkDraft> = {}): LinkDraft {
  return {
    id: "l1",
    slotId: "s1",
    slug: "intro",
    name: "Intro call",
    description: "",
    durationMinutes: 30,
    bufferBefore: 0,
    bufferAfter: 0,
    horizonDays: 14,
    minNoticeMinutes: 240,
    hostTimeZone: "Europe/Warsaw",
    weeklyHours: normalizeWeeklyHours(undefined),
    busyCalendarIds: ["moduo", "tasks"],
    noteEnabled: true,
    guestsEnabled: true,
    questions: [],
    paused: false,
    video: "google_meet",
    guestReminderMinutes: DEFAULT_GUEST_REMINDER_MINUTES,
    cohostIds: [],
    savedCohostIds: [],
    ...over,
  };
}

function open(d: LinkDraft, onChange: (next: LinkDraft) => void = noop) {
  render(
    <BookingLinkDialog
      draft={d}
      accounts={[]}
      googleOn
      zoom={{ configured: false, connected: false }}
      busy={false}
      error={null}
      onOpenChange={noop}
      onChange={onChange}
      onConnect={noop}
      onConnectZoom={noop}
      onDisconnectZoom={noop}
      onSave={noop}
      onDelete={noop}
    />,
  );
  // The busy calendars live under "Check for conflicts", which opens in place.
  fireEvent.click(screen.getByRole("button", { name: /^Check for conflicts/ }));
}

describe("booking link editor · Focus time under Check for conflicts (AC23)", () => {
  it("is off for a link that doesn't list it", () => {
    open(draft());
    const box = screen.getByRole("checkbox", { name: "Focus time" });
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("ticking it adds focus to the busy list, keeping the rest", () => {
    let next: LinkDraft | null = null;
    open(draft(), (d) => {
      next = d;
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Focus time" }));
    expect(next!.busyCalendarIds).toEqual(["moduo", "tasks", FOCUS_BUSY_ID]);
  });

  it("a link that lists it shows it ticked, and unticking takes only it out", () => {
    let next: LinkDraft | null = null;
    open(draft({ busyCalendarIds: ["moduo", FOCUS_BUSY_ID] }), (d) => {
      next = d;
    });
    const box = screen.getByRole("checkbox", { name: "Focus time" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    expect(next!.busyCalendarIds).toEqual(["moduo"]);
  });
});
