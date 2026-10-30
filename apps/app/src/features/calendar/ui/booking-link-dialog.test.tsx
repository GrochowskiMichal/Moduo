import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { applyTimeRegion, EMPTY_TIME_REGION, resetTimeRegionForTests } from "@/lib/time-region";

import { normalizeWeeklyHours } from "../booking/slots";
import {
  BookingLinkDialog,
  DEFAULT_GUEST_REMINDER_MINUTES,
  type LinkDraft,
  reminderFromOption,
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

function Editor({ start, onChange }: { start: LinkDraft; onChange?: (d: LinkDraft) => void }) {
  const [current, setCurrent] = useState(start);
  return (
    <BookingLinkDialog
      draft={current}
      accounts={[]}
      googleOn
      zoom={{ configured: false, connected: false }}
      busy={false}
      error={null}
      onOpenChange={noop}
      onChange={(next) => {
        setCurrent(next);
        onChange?.(next);
      }}
      onConnect={noop}
      onConnectZoom={noop}
      onDisconnectZoom={noop}
      onSave={noop}
      onDelete={noop}
    />
  );
}

/** Opens the editor with live state; returns the drafts it reported, in order. */
function edit(d: LinkDraft): LinkDraft[] {
  const seen: LinkDraft[] = [];
  render(<Editor start={d} onChange={(next) => seen.push(next)} />);
  return seen;
}

const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed");
const row = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });

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
  it("shows the link's reminder in its row, 24 hours by default", () => {
    open(draft());
    const reminder = row("Reminder");
    expect(reminder.textContent).toContain("24 hours before");
    fireEvent.click(reminder);
    expect(pressed(screen.getByRole("button", { name: "24 hours before" }))).toBe("true");
    expect(pressed(screen.getByRole("button", { name: "Off" }))).toBe("false");
  });

  it("shows Off when the link sends no reminder", () => {
    open(draft({ guestReminderMinutes: null }));
    expect(row("Reminder").textContent).toContain("Off");
    fireEvent.click(row("Reminder"));
    expect(pressed(screen.getByRole("button", { name: "Off" }))).toBe("true");
  });

  it("saves Off as null, and 1 hour / 24 hours as 60 / 1440", () => {
    expect(reminderFromOption("off")).toBeNull();
    expect(reminderFromOption("60")).toBe(60);
    expect(reminderFromOption("1440")).toBe(1440);
    expect(reminderFromOption("30")).toBeNull();
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

describe("booking link editor · layout", () => {
  it("names a new link Create link and an existing one Save link", () => {
    open(draft({ id: null, slug: null }));
    screen.getByRole("button", { name: "Create link" });
    screen.getByRole("dialog", { name: "New booking link" });
    cleanup();
    open(draft());
    screen.getByRole("button", { name: "Save link" });
    screen.getByRole("dialog", { name: "Edit booking link" });
    screen.getByText(/\/book\/intro$/);
  });

  it("edits the name in the header", () => {
    const seen = edit(draft());
    fireEvent.change(screen.getByRole("textbox", { name: "Meeting name" }), {
      target: { value: "Pairing" },
    });
    expect(seen.at(-1)!.name).toBe("Pairing");
  });
});

describe("booking link editor · Length chips", () => {
  it("presses the link's length and switches to another", () => {
    const seen = edit(draft());
    expect(pressed(screen.getByRole("button", { name: "30 min" }))).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "45 min" }));
    expect(seen.at(-1)!.durationMinutes).toBe(45);
    expect(pressed(screen.getByRole("button", { name: "45 min" }))).toBe("true");
    expect(pressed(screen.getByRole("button", { name: "30 min" }))).toBe("false");
    expect(screen.queryByRole("textbox", { name: "Custom length in minutes" })).toBeNull();
  });

  it("Custom reveals a minutes field and keeps a custom length", () => {
    const seen = edit(draft());
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(seen.at(-1)!.durationMinutes).toBe(20);
    expect(pressed(screen.getByRole("button", { name: "Custom" }))).toBe("true");
    const field = screen.getByRole("textbox", { name: "Custom length in minutes" });
    fireEvent.change(field, { target: { value: "50" } });
    fireEvent.blur(field);
    expect(seen.at(-1)!.durationMinutes).toBe(50);
  });
});

describe("booking link editor · When", () => {
  // A 24-hour clock with Monday first, whatever the machine's; cases that need
  // another set it.
  beforeEach(() => applyTimeRegion({ ...EMPTY_TIME_REGION, hourCycle: "h23", weekStart: 1 }, null));
  afterEach(() => resetTimeRegionForTests());

  it("the summary and the fields read on the person's clock", () => {
    edit(draft());
    expect(screen.getByText(/^Weekdays, 09:00–17:00/)).toBeTruthy();
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("09:00");
    cleanup();
    applyTimeRegion({ ...EMPTY_TIME_REGION, hourCycle: "h12", weekStart: 1 }, null);
    edit(draft());
    expect(screen.getByText(/^Weekdays, 9:00 AM–5:00 PM/)).toBeTruthy();
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("9:00 AM");
  });

  it("the day toggles start on the week start from Time & region", () => {
    applyTimeRegion({ ...EMPTY_TIME_REGION, hourCycle: "h23", weekStart: 0 }, null);
    edit(draft());
    const days = screen.getByRole("group", { name: "Days" });
    const names = [...days.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names[0]).toBe("Sunday");
    expect(names[6]).toBe("Saturday");
  });

  it("shows one range and a summary while every open day shares its hours", () => {
    const seen = edit(draft());
    screen.getByLabelText("From");
    expect(screen.getByText(/^Weekdays, /)).toBeTruthy();
    expect(screen.queryByLabelText("Monday start")).toBeNull();
    const saturday = screen.getByRole("button", { name: "Saturday" });
    expect(pressed(saturday)).toBe("false");
    fireEvent.click(saturday);
    expect(seen.at(-1)!.weeklyHours.sat).toEqual([{ start: "09:00", end: "17:00" }]);
  });

  it("changing the range changes every open day, and only those", () => {
    const seen = edit(draft());
    const from = screen.getByLabelText("From");
    fireEvent.change(from, { target: { value: "10:00" } });
    fireEvent.blur(from);
    const hours = seen.at(-1)!.weeklyHours;
    for (const day of ["mon", "tue", "wed", "thu", "fri"] as const) {
      expect(hours[day]).toEqual([{ start: "10:00", end: "17:00" }]);
    }
    expect(hours.sat).toEqual([]);
    expect(hours.sun).toEqual([]);
  });

  it("Different hours per day opens the per-day editor", () => {
    edit(draft());
    fireEvent.click(screen.getByRole("button", { name: "Different hours per day" }));
    screen.getByLabelText("Monday start");
    expect(screen.queryByLabelText("From")).toBeNull();
  });

  it("opens in the per-day editor when the days' hours already differ", () => {
    const weeklyHours = normalizeWeeklyHours({
      mon: [{ start: "09:00", end: "17:00" }],
      tue: [{ start: "12:00", end: "18:00" }],
    });
    const seen = edit(draft({ weeklyHours }));
    expect((screen.getByLabelText("Tuesday start") as HTMLInputElement).value).toBe("12:00");
    const tuesdayEnd = screen.getByLabelText("Tuesday end");
    fireEvent.change(tuesdayEnd, { target: { value: "19:00" } });
    fireEvent.blur(tuesdayEnd);
    expect(seen.at(-1)!.weeklyHours.tue).toEqual([{ start: "12:00", end: "19:00" }]);
    expect(seen.at(-1)!.weeklyHours.mon).toEqual([{ start: "09:00", end: "17:00" }]);
  });
});

describe("booking link editor · More options", () => {
  it("each row shows its summary and opens in place, one at a time", () => {
    edit(draft());
    const window = row("Booking window");
    expect(window.getAttribute("aria-expanded")).toBe("false");
    expect(window.textContent).toContain("Up to 2 weeks ahead · 4 hours notice");
    expect(screen.queryByRole("button", { name: "90 days" })).toBeNull();
    fireEvent.click(window);
    expect(window.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "90 days" }));
    expect(row("Booking window").textContent).toContain("Up to 90 days ahead");
    fireEvent.click(row("Breathing room"));
    expect(row("Booking window").getAttribute("aria-expanded")).toBe("false");
    expect(row("Breathing room").getAttribute("aria-expanded")).toBe("true");
  });

  it("the guest form row sums up what guests are asked", () => {
    edit(draft({ guestsEnabled: false }));
    expect(row("Guest form").textContent).toContain("Name, email, short note");
    fireEvent.click(row("Guest form"));
    fireEvent.click(screen.getByRole("button", { name: "Add a question" }));
    expect(row("Guest form").textContent).toContain("1 question");
  });
});

describe("after Create link", () => {
  const ready = (created: Parameters<typeof BookingLinkDialog>[0]["created"], onEdit = noop) =>
    render(
      <BookingLinkDialog
        draft={null}
        created={created}
        onEditCreated={onEdit}
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

  it("shows the new link ready to share, with Copy and a way back to the editor", () => {
    let edited = false;
    ready(
      {
        name: "Intro call",
        url: "https://moduo.app/book/intro-x1y2",
        summary: "30 min · Google Meet",
        blocker: null,
      },
      () => {
        edited = true;
      },
    );
    screen.getByRole("dialog", { name: "Intro call is ready to share" });
    screen.getByText("moduo.app/book/intro-x1y2");
    const copy = screen.getByRole("button", { name: "Copy link" }) as HTMLButtonElement;
    expect(copy.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    expect(edited).toBe(true);
  });

  it("says what stops guests booking and holds Copy back until then", () => {
    ready({
      name: "Intro call",
      url: "https://moduo.app/book/intro-x1y2",
      summary: "30 min · Zoom",
      blocker: "Connect Zoom before guests can book.",
    });
    screen.getByText("Connect Zoom before guests can book.");
    expect((screen.getByRole("button", { name: "Copy link" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("a link's video needs its login", () => {
  const editor = (googleOn: boolean, zoom = { configured: true, connected: false }) =>
    render(
      <BookingLinkDialog
        draft={draft({ id: null, slug: null })}
        accounts={[]}
        googleOn={googleOn}
        zoom={zoom}
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

  it("holds Create link back and offers Connect Google while Google isn't connected", () => {
    editor(false);
    screen.getByText("Connect Google to use Google Meet.");
    screen.getByRole("button", { name: "Connect Google" });
    expect(
      (screen.getByRole("button", { name: "Create link" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("lets Create link go once the login is there, and offers no Moduo video", () => {
    editor(true);
    expect(
      (screen.getByRole("button", { name: "Create link" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText("Moduo video")).toBeNull();
  });
});
