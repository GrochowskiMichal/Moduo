import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { message, NOW, oneThreadEngine, row } from "../testing/reader-kit";
import { decideFromReader } from "../ui/use-reader-wiring";
import { MailReader } from "./mail-reader";
import { type MailWho, WhoCard } from "./who-card";

afterEach(cleanup);

const JONAS = { name: "Jonas Weber", email: "jonas@acme.test" };
const WHO: MailWho = {
  contactId: "c-jonas",
  name: "Jonas Weber",
  role: "Head of IT",
  company: "Acme",
  lastTouch: "Emailed today 8:12",
  openTasks: 2,
  notes: 1,
  nextMeeting: "Thu",
};

describe("who-card (specs/mail-v3.md §8, AC23)", () => {
  it("contact, unknown, screened", () => {
    const onOpenContact = rs.fn();
    const ui = render(<WhoCard sender={JONAS} who={WHO} onOpenContact={onOpenContact} />);
    const card = screen.getByRole("region", { name: "Who this is from" });
    within(card).getByText("Jonas Weber");
    within(card).getByText("Head of IT · Acme");
    within(card).getByText("Last: Emailed today 8:12");
    within(card).getByText("2 open tasks · 1 note · next meeting Thu");
    fireEvent.click(within(card).getByRole("button", { name: "Open contact" }));
    expect(onOpenContact).toHaveBeenCalledWith("c-jonas");
    expect(within(card).queryByText("Not in your contacts")).toBeNull();

    // Unknown: "Not in your contacts" and Add as contact.
    const onAddContact = rs.fn();
    ui.rerender(<WhoCard sender={JONAS} who={null} onAddContact={onAddContact} />);
    within(card).getByText("Not in your contacts");
    within(card).getByText("jonas@acme.test");
    fireEvent.click(within(card).getByRole("button", { name: "Add as contact" }));
    expect(onAddContact).toHaveBeenCalled();
    expect(within(card).queryByRole("button", { name: "Allow" })).toBeNull();

    // Screened (New senders): primary Allow `y` and ghost Block `b` replace Add as contact.
    const onAllow = rs.fn();
    const onBlock = rs.fn();
    ui.rerender(
      <WhoCard
        sender={JONAS}
        who={null}
        screened
        onAllow={onAllow}
        onBlock={onBlock}
        onAddContact={onAddContact}
      />,
    );
    expect(within(card).queryByRole("button", { name: "Add as contact" })).toBeNull();
    const allow = within(card).getByRole("button", { name: "Allow" });
    expect(allow.getAttribute("aria-keyshortcuts")).toBe("y");
    expect(
      within(card).getByRole("button", { name: "Block" }).getAttribute("aria-keyshortcuts"),
    ).toBe("b");
    fireEvent.click(allow);
    fireEvent.click(within(card).getByRole("button", { name: "Block" }));
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onBlock).toHaveBeenCalledTimes(1);
  });

  it("the reader looks the sender up and hands Allow its thread and sender", async () => {
    const lookup = rs.fn(async () => null);
    const onDecide = rs.fn();
    const engine = oneThreadEngine(() => ({
      row: row(),
      messages: [
        message({ id: "m0", from: { name: "Robin Hale", email: "robin@me.test" } }),
        message({ id: "m1", dateMs: NOW }),
      ],
    }));
    render(
      <TooltipProvider>
        <MailReader
          engine={engine}
          threadId="t1"
          version={0}
          behavior={{ remoteImages: "block", trackerBlocking: true }}
          selfAddresses={["robin@me.test"]}
          now={() => NOW}
          who={{ lookup, screened: true, onDecide }}
        />
      </TooltipProvider>,
    );
    await act(async () => await new Promise((r) => setTimeout(r, 0)));
    await act(async () => await new Promise((r) => setTimeout(r, 0)));
    // The newest sender who isn't you.
    expect(lookup).toHaveBeenCalledWith("jonas@acme.test");
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onDecide).toHaveBeenCalledWith("t1", JONAS, "allow");
  });

  it("Allow and Block act as the New senders panel does", async () => {
    const screenedRow = (threadId: string, email: string): MailThreadRow =>
      row({ threadId, senders: [{ name: "Jonas", email }] });
    const listThreads = rs.fn(async () => ({
      rows: [
        screenedRow("t1", "Jonas@acme.test"),
        screenedRow("t2", "jonas@acme.test"),
        screenedRow("t3", "someone@else.test"),
      ],
      next: null,
    }));
    const releaseNewSenders = rs.fn(async () => {});
    const save = rs.fn(async () => ({}));
    await decideFromReader(
      { engine: { listThreads }, commands: { releaseNewSenders }, save },
      "t1",
      JONAS,
      "allow",
    );
    expect(listThreads).toHaveBeenCalledWith({ view: { kind: "new_senders" }, limit: 500 });
    expect(save).toHaveBeenCalledWith("screener_decision", {
      address: "jonas@acme.test",
      decision: "allow",
    });
    expect(releaseNewSenders).toHaveBeenCalledWith(["t1", "t2"]);

    await decideFromReader(
      { engine: { listThreads }, commands: { releaseNewSenders }, save },
      "t3",
      { name: "", email: "someone@else.test" },
      "block",
    );
    expect(save).toHaveBeenLastCalledWith("blocked_sender", { address: "someone@else.test" });
    expect(releaseNewSenders).toHaveBeenLastCalledWith(["t3"]);
  });
});

// specs/mail-improve.md MI-0, AC24: a sender waiting in the Screener is decided in the
// reader's sender header first; until then the triage toolbar is dimmed and inert.
describe("screener disables triage (AC24)", () => {
  it("Allow/Block sit in the header and the toolbar is aria-disabled until screened", async () => {
    const onAction = rs.fn();
    const thread = { row: row(), messages: [message()] };
    render(
      <TooltipProvider>
        <MailReader
          engine={oneThreadEngine(() => thread)}
          threadId="t1"
          version={0}
          behavior={{ remoteImages: "block", trackerBlocking: true }}
          now={() => NOW}
          selfAddresses={["robin@me.test"]}
          onAction={onAction}
          who={{ lookup: async () => null, screened: true }}
        />
      </TooltipProvider>,
    );
    await act(async () => await new Promise((r) => setTimeout(r, 0)));
    const card = screen.getByRole("region", { name: "Who this is from" });
    within(card).getByRole("button", { name: "Allow" });
    within(card).getByRole("button", { name: "Block" });
    const toolbar = screen.getByRole("toolbar", { name: "Conversation actions" });
    expect(toolbar.getAttribute("aria-disabled")).toBe("true");
    const done = within(toolbar).getByRole("button", { name: /^Done/ });
    expect(done.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(done);
    expect(onAction).not.toHaveBeenCalled();
  });
});
