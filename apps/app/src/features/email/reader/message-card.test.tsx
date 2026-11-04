import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { MailMessage } from "@/lib/runtime.types.mail-engine";

import { MessageCard } from "./message-card";

afterEach(cleanup);

const msg: MailMessage = {
  id: "m1",
  messageId: "<m1@x.com>",
  from: { name: "Anna", email: "anna@x.com" },
  to: [{ name: "", email: "me@x.com" }],
  cc: [],
  dateMs: Date.UTC(2026, 10, 3, 9),
  subject: "Quote",
  snippet: "See below",
  unread: false,
  bodyState: "full",
  html: null,
  text: "See below\n\nOn Mon, Bob wrote:\n> older text",
  quoteOffset: 11,
  trackerCount: 0,
  attachments: [],
  listUnsubscribe: null,
  hasInvite: false,
};

describe("message card (AC16)", () => {
  it("collapses quoted history behind a toggle", () => {
    render(<MessageCard message={msg} expanded />);
    expect(screen.getByText(/See below/)).toBeTruthy();
    expect(screen.queryByText(/older text/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show quoted text" }));
    expect(screen.getByText(/older text/)).toBeTruthy();
  });

  it("show original", async () => {
    const loadOriginal = rs.fn(
      async () => "Message-ID: <m1@x.com>\r\nSubject: Quote\r\n\r\nSee below",
    );
    render(<MessageCard message={msg} expanded loadOriginal={loadOriginal} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    });
    expect(loadOriginal).toHaveBeenCalledWith("m1");
    const raw = screen.getByLabelText("Original message");
    expect(raw.textContent).toContain("Message-ID: <m1@x.com>");
  });

  it("hides Show original when the engine can't fetch it", () => {
    render(<MessageCard message={msg} expanded />);
    expect(screen.queryByRole("button", { name: "Show original" })).toBeNull();
  });
});
