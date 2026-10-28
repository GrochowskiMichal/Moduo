// The Booking link view in the right panel (CALR-17, specs/calendar-rethink.md
// AC31, AC32): its settings at a glance (Where: Google Meet, Zoom or Their
// choice), Copy (and ⌘C when no event is selected), Taking bookings, Length,
// Busy from with Focus time, Hosts (only times you're all free; paused until a
// co-host accepts), Booked, and This week's count of open times.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { OpenTimes } from "../booking/availability";
import { type BookingLink, FOCUS_BUSY_ID } from "../booking/model";
import { normalizeWeeklyHours } from "../booking/slots";
import { BookingLinkPanel, type BookingLinkPanelProps } from "./booking-link-panel";

const URL_TEXT = "https://moduo.app/book/intro-ab12";

function link(over: Partial<BookingLink> = {}): BookingLink {
  return {
    id: "l1",
    slotId: "s1",
    slug: "intro-ab12",
    name: "Intro call",
    description: "",
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 10,
    horizonDays: 14,
    minNoticeMinutes: 240,
    hostTimeZone: "Europe/Warsaw",
    weeklyHours: normalizeWeeklyHours(undefined),
    busyCalendarIds: ["moduo", "tasks"],
    noteEnabled: true,
    guestsEnabled: true,
    questions: [],
    paused: false,
    videoProvider: "google_meet",
    ...over,
  };
}

const OPEN_3: OpenTimes = {
  state: "open",
  times: [0, 1, 2].map((i) => ({
    startMs: Date.UTC(2030, 2, 4, 9 + i),
    endMs: Date.UTC(2030, 2, 4, 9 + i, 30),
  })),
};

function props(over: Partial<BookingLinkPanelProps> = {}): BookingLinkPanelProps {
  return {
    link: link(),
    url: URL_TEXT,
    hosts: [],
    bookings: [],
    open: OPEN_3,
    accounts: [],
    landsIn: "Your calendar · Moduo",
    hasSelection: false,
    onPatch: () => {},
    onEdit: () => {},
    onGuestView: () => {},
    ...over,
  };
}

let writeText: ReturnType<typeof rs.fn>;

beforeEach(() => {
  writeText = rs.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(cleanup);

describe("Booking link view · the link at a glance (AC31)", () => {
  it("shows the name and its URL; Copy copies the URL", async () => {
    render(<BookingLinkPanel {...props()} />);
    screen.getByText("Intro call");
    screen.getByText(URL_TEXT);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(URL_TEXT);
    await screen.findByText(/copied/i);
  });

  it("⌘C copies the URL when no event is selected", () => {
    render(<BookingLinkPanel {...props()} />);
    fireEvent.keyDown(window, { key: "c", metaKey: true });
    expect(writeText).toHaveBeenCalledWith(URL_TEXT);
  });

  it("⌘C leaves a selected event to the week", () => {
    render(<BookingLinkPanel {...props({ hasSelection: true })} />);
    fireEvent.keyDown(window, { key: "c", metaKey: true });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("names where the meeting happens: Google Meet, Zoom or Their choice", () => {
    const { rerender } = render(<BookingLinkPanel {...props()} />);
    screen.getByText("Google Meet");
    rerender(<BookingLinkPanel {...props({ link: link({ videoProvider: "zoom" }) })} />);
    screen.getByText("Zoom");
    rerender(<BookingLinkPanel {...props({ link: link({ videoProvider: "guest_choice" }) })} />);
    screen.getByText("Their choice");
  });

  it("says where bookings land", () => {
    render(<BookingLinkPanel {...props({ landsIn: "Your main Google calendar" })} />);
    screen.getByText("Your main Google calendar");
  });

  it("Taking bookings is on for a live link and pauses it when switched off", () => {
    const onPatch = rs.fn();
    render(<BookingLinkPanel {...props({ onPatch })} />);
    const toggle = screen.getByRole("switch", { name: "Taking bookings" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(onPatch).toHaveBeenCalledWith({ paused: true });
  });

  it("a paused link says so and switches back on", () => {
    const onPatch = rs.fn();
    render(
      <BookingLinkPanel
        {...props({ link: link({ paused: true }), open: { state: "paused", times: [] }, onPatch })}
      />,
    );
    screen.getAllByText(/paused/i);
    const toggle = screen.getByRole("switch", { name: "Taking bookings" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onPatch).toHaveBeenCalledWith({ paused: false });
  });

  it("Length offers 15, 30, 45 and 60 minutes, the link's own one picked", () => {
    const onPatch = rs.fn();
    render(<BookingLinkPanel {...props({ onPatch })} />);
    for (const n of [15, 30, 45, 60]) screen.getByRole("radio", { name: `${n} min` });
    expect(screen.getByRole("radio", { name: "30 min" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "45 min" }));
    expect(onPatch).toHaveBeenCalledWith({ durationMinutes: 45 });
  });

  it("Edit… opens the full editor and Guest's view opens the guest page", () => {
    const onEdit = rs.fn();
    const onGuestView = rs.fn();
    render(<BookingLinkPanel {...props({ onEdit, onGuestView })} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /guest's view/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onGuestView).toHaveBeenCalledTimes(1);
  });
});

describe("Booking link view · Busy from and Focus time (AC31, AC23)", () => {
  it("Focus time is off by default; ticking it adds focus to the busy list", () => {
    const onPatch = rs.fn();
    render(<BookingLinkPanel {...props({ onPatch })} />);
    const box = screen.getByRole("checkbox", { name: "Focus time" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    expect(onPatch).toHaveBeenCalledWith({ busyCalendarIds: ["moduo", "tasks", FOCUS_BUSY_ID] });
  });

  it("unticking Focus time takes only it out", () => {
    const onPatch = rs.fn();
    render(
      <BookingLinkPanel
        {...props({ link: link({ busyCalendarIds: ["moduo", FOCUS_BUSY_ID, "tasks"] }), onPatch })}
      />,
    );
    const box = screen.getByRole("checkbox", { name: "Focus time" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    expect(onPatch).toHaveBeenCalledWith({ busyCalendarIds: ["moduo", "tasks"] });
  });

  it("names the connected calendars the link counts as busy", () => {
    render(
      <BookingLinkPanel
        {...props({
          link: link({ busyCalendarIds: ["moduo", "acct-g"] }),
          accounts: [
            {
              id: "acct-g",
              workspaceId: "w1",
              ownerId: "me",
              provider: "google",
              externalId: "google:robin@example.com:robin@example.com",
              displayLabel: "robin@example.com",
              isDefaultTarget: false,
              color: null,
              lastSyncAt: null,
              status: "ok",
              syncToken: null,
              deletedAt: null,
            },
          ],
        })}
      />,
    );
    screen.getByText(/robin@example\.com/);
  });
});

describe("Booking link view · Hosts (AC32)", () => {
  it("a solo link is only you", () => {
    render(<BookingLinkPanel {...props()} />);
    screen.getByText("Only you");
  });

  it("a co-host link offers only times you're all free and says who accepted", () => {
    render(
      <BookingLinkPanel
        {...props({ hosts: [{ userId: "u-kai", name: "Kai Ito", status: "accepted" }] })}
      />,
    );
    screen.getByText(/only times you're all free/i);
    screen.getByText(/Kai Ito · accepted/);
  });

  it("stays paused until the co-host accepts, and says so", () => {
    render(
      <BookingLinkPanel
        {...props({
          hosts: [{ userId: "u-kai", name: "Kai Ito", status: "pending" }],
          open: { state: "waiting", waitingOn: ["Kai Ito"], times: [] },
        })}
      />,
    );
    screen.getByText(/Kai Ito · hasn't accepted/);
    screen.getByText("Paused until Kai Ito accepts");
  });

  it("a declined co-host shows as declined", () => {
    render(
      <BookingLinkPanel
        {...props({
          hosts: [{ userId: "u-kai", name: "Kai Ito", status: "declined" }],
          open: { state: "waiting", waitingOn: ["Kai Ito"], times: [] },
        })}
      />,
    );
    screen.getByText(/Kai Ito · declined/);
  });
});

describe("Booking link view · Booked and This week (AC31)", () => {
  it("lists who booked", () => {
    render(
      <BookingLinkPanel
        {...props({
          bookings: [
            {
              id: "b1",
              name: "Robin Hale",
              email: "robin@example.com",
              startsAt: "2030-03-05T10:00:00.000Z",
            },
          ],
        })}
      />,
    );
    screen.getByText("Robin Hale");
  });

  it("says when nobody has booked yet", () => {
    render(<BookingLinkPanel {...props()} />);
    screen.getByText("No bookings yet");
  });

  it("counts this week's open times", () => {
    const { rerender } = render(<BookingLinkPanel {...props()} />);
    screen.getByText("3 open times this week");
    rerender(
      <BookingLinkPanel {...props({ open: { state: "open", times: OPEN_3.times.slice(0, 1) } })} />,
    );
    screen.getByText("1 open time this week");
    rerender(<BookingLinkPanel {...props({ open: { state: "open", times: [] } })} />);
    screen.getByText("No open times this week");
  });
});
