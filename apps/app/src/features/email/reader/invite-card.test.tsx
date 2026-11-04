import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { InviteCard, type MailInvite } from "./invite-card";

afterEach(cleanup);

const invite: MailInvite = {
  uid: "evt-1@example.com",
  method: "REQUEST",
  summary: "Board prep",
  startMs: Date.UTC(2026, 10, 5, 14, 0),
  endMs: Date.UTC(2026, 10, 5, 15, 0),
  location: "Zoom",
  organizer: { name: "Anna", email: "anna@x.com" },
  myStatus: null,
};

describe("invite card (AC18)", () => {
  it("shows the event and sends the RSVP's PARTSTAT", () => {
    const onRsvp = rs.fn(async () => {});
    render(<InviteCard invite={invite} onRsvp={onRsvp} />);
    expect(screen.getByText("Board prep")).toBeTruthy();
    expect(screen.getByText(/Anna/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onRsvp).toHaveBeenCalledWith("ACCEPTED");
    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    expect(onRsvp).toHaveBeenCalledWith("TENTATIVE");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onRsvp).toHaveBeenCalledWith("DECLINED");
  });

  it("marks the current answer and offers Add to calendar", () => {
    const onAdd = rs.fn();
    render(
      <InviteCard
        invite={{ ...invite, myStatus: "ACCEPTED" }}
        onRsvp={() => {}}
        onAddToCalendar={onAdd}
      />,
    );
    expect(screen.getByRole("button", { name: "Accept" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(onAdd).toHaveBeenCalledWith(invite.uid);
  });

  it("a cancellation says so and offers no RSVP", () => {
    render(<InviteCard invite={{ ...invite, method: "CANCEL" }} onRsvp={() => {}} />);
    expect(screen.getByText(/cancelled/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });
});
