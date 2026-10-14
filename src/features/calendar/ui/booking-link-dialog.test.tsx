import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { normalizeWeeklyHours } from "../booking/slots";
import {
  BookingLinkDialog,
  DEFAULT_GUEST_REMINDER_MINUTES,
  type LinkDraft,
} from "./booking-link-dialog";
import { isMissingReminderColumn, reminderFromRow } from "./booking-links";

const noop = () => {};

afterEach(cleanup);

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
    busyCalendarIds: ["moduo"],
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

function open(d: LinkDraft) {
  render(
    <BookingLinkDialog
      draft={d}
      accounts={[]}
      googleOn
      zoom={{ configured: false, connected: false }}
      busy={false}
      error={null}
      onOpenChange={noop}
      onChange={noop}
      onConnect={noop}
      onConnectZoom={noop}
      onDisconnectZoom={noop}
      onSave={noop}
      onDelete={noop}
    />,
  );
}

describe("booking link editor · Remind guests (AC31)", () => {
  it("shows the link's reminder under Limits, 24 hours by default", () => {
    open(draft());
    expect(screen.getByRole("combobox", { name: "Remind guests" }).textContent).toContain(
      "24 hours before",
    );
  });

  it("shows Off when the link sends no reminder", () => {
    open(draft({ guestReminderMinutes: null }));
    expect(screen.getByRole("combobox", { name: "Remind guests" }).textContent).toContain("Off");
  });

  it("reads a saved reminder, and an absent column as the default", () => {
    expect(reminderFromRow(60)).toBe(60);
    expect(reminderFromRow(1440)).toBe(1440);
    expect(reminderFromRow(null)).toBeNull();
    expect(reminderFromRow(undefined)).toBe(1440);
    expect(reminderFromRow(30)).toBe(1440);
  });

  it("recognises a database without the column, so the link still saves", () => {
    expect(
      isMissingReminderColumn({
        code: "PGRST204",
        message:
          "Could not find the 'guest_reminder_minutes' column of 'exposed_slot_links' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingReminderColumn({ code: "PGRST204", message: "Could not find the 'other' column" }),
    ).toBe(false);
    expect(isMissingReminderColumn(null)).toBe(false);
  });
});
