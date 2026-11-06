import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { MailMessage } from "@/lib/runtime.types.mail-engine";

import { message, NOW, oneThreadEngine, row } from "../testing/reader-kit";
import { MailReader, type MailReaderApi } from "./mail-reader";
import { MessageCard } from "./message-card";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

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

  it("shows the raw source when the ⋯ menu asks for it", async () => {
    const loadOriginal = rs.fn(
      async () => "Message-ID: <m1@x.com>\r\nSubject: Quote\r\n\r\nSee below",
    );
    render(<MessageCard message={msg} expanded showOriginal loadOriginal={loadOriginal} />);
    await tick();
    expect(loadOriginal).toHaveBeenCalledWith("m1");
    const raw = screen.getByLabelText("Original message");
    expect(raw.textContent).toContain("Message-ID: <m1@x.com>");
  });

  it("no Show original on the card itself (it moved into ⋯)", () => {
    render(<MessageCard message={msg} expanded loadOriginal={async () => ""} />);
    expect(screen.queryByRole("button", { name: "Show original" })).toBeNull();
    expect(screen.queryByLabelText("Original message")).toBeNull();
  });
});

const PEOPLE = [
  { name: "Jonas Weber", email: "jonas@acme.test" },
  { name: "Robin Hale", email: "robin@me.test" },
  { name: "Dana Ito", email: "dana@northzone.test" },
];

/** Seven messages alternating Jonas and Robin, each to the other two. */
function longThread(): MailMessage[] {
  return Array.from({ length: 7 }, (_, i) => {
    const from = PEOPLE[i % 2]!;
    return message({
      id: `m${i}`,
      messageId: `<m${i}@acme.test>`,
      from,
      to: PEOPLE.filter((p) => p.email !== from.email),
      dateMs: NOW - (7 - i) * 3_600_000,
      snippet: `Message number ${i}`,
      text: `Message number ${i}`,
    });
  });
}

describe("conversation stack (specs/mail-v3.md §8, AC24)", () => {
  it("fold past five, to-line, per-message actions", async () => {
    const onAction = rs.fn();
    const apiRef: { current: MailReaderApi | null } = { current: null };
    const engine = oneThreadEngine(() => ({
      row: row({ messageCount: 7 }),
      messages: longThread(),
    }));
    const ui = render(
      <TooltipProvider>
        <MailReader
          engine={engine}
          threadId="t1"
          version={0}
          behavior={{ remoteImages: "block", trackerBlocking: true }}
          selfAddresses={["robin@me.test"]}
          onAction={onAction}
          apiRef={apiRef}
        />
      </TooltipProvider>,
    );
    await tick();
    const articles = () => ui.container.querySelectorAll("article[data-message-id]");
    // First, the fold, then the newest two.
    expect([...articles()].map((a) => a.getAttribute("data-message-id"))).toEqual([
      "m0",
      "m5",
      "m6",
    ]);
    const fold = screen.getByRole("button", { name: "4 earlier messages" });

    // The newest (from Jonas) is open with its to-line: you first, then first names.
    const newest = ui.container.querySelector('article[data-message-id="m6"]') as HTMLElement;
    expect(newest.querySelector("[data-to-line]")?.textContent).toBe("to you, Dana");
    fireEvent.click(within(newest).getByRole("button", { name: "Show addresses" }));
    expect(newest.querySelector("[data-to-line]")?.textContent).toBe(
      "to Robin Hale <robin@me.test>, Dana Ito <dana@northzone.test>",
    );
    within(newest).getByRole("button", { name: "Hide addresses" });

    // Per-message actions name the message they act on.
    fireEvent.click(within(newest).getByRole("button", { name: "Reply to this message" }));
    expect(onAction).toHaveBeenCalledWith("reply", "t1", "m6");
    fireEvent.click(within(newest).getByRole("button", { name: "Reply all to this message" }));
    expect(onAction).toHaveBeenLastCalledWith("reply-all", "t1", "m6");
    fireEvent.click(within(newest).getByRole("button", { name: "Forward this message" }));
    expect(onAction).toHaveBeenLastCalledWith("forward", "t1", "m6");

    // A click on the fold shows all seven; older ones stay one-line headers.
    fireEvent.click(fold);
    expect(articles().length).toBe(7);
    expect(screen.queryByRole("button", { name: /earlier messages/ })).toBeNull();
    const m1 = ui.container.querySelector('article[data-message-id="m1"]') as HTMLElement;
    expect(m1.querySelector("[data-to-line]")).toBeNull();

    // `o` (the reader's expandAll) opens every message.
    act(() => {
      apiRef.current!.expandAll();
    });
    expect(ui.container.querySelectorAll("[data-to-line]").length).toBe(7);
  });

  it("`o` unfolds a folded thread in one step", async () => {
    const apiRef: { current: MailReaderApi | null } = { current: null };
    const engine = oneThreadEngine(() => ({ row: row(), messages: longThread() }));
    const ui = render(
      <TooltipProvider>
        <MailReader
          engine={engine}
          threadId="t1"
          version={0}
          behavior={{ remoteImages: "block", trackerBlocking: true }}
          apiRef={apiRef}
        />
      </TooltipProvider>,
    );
    await tick();
    expect(ui.container.querySelectorAll("article[data-message-id]").length).toBe(3);
    act(() => {
      apiRef.current!.expandAll();
    });
    expect(ui.container.querySelectorAll("article[data-message-id]").length).toBe(7);
    expect(ui.container.querySelectorAll("[data-to-line]").length).toBe(7);
  });
});
